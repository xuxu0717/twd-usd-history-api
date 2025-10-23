// api/history.js

function htmlEntityDecode(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function fixJsonQuotes(jsonStr) {
  return jsonStr
    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
}

function msToDate(ms) {
  const d = new Date(Number(ms));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function median(arr) {
  const a = arr.filter(v => Number.isFinite(v)).slice().sort((x,y)=>x-y);
  if (!a.length) return NaN;
  const mid = Math.floor(a.length/2);
  return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;
}

function normalizeName(name) {
  if (!name || typeof name !== "string") return "";
  // 去除空白、全形空白、標點與控制字元，轉小寫（雖然為中文）
  return name
    .replace(/\s+/g, "")
    .replace(/\u3000/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "") // 移除標點，但保留中英數字
    .trim();
}

export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

  const url = `https://rate.bot.com.tw/xrt/quote/${month}/USD`;

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Referer": "https://rate.bot.com.tw/xrt/"
      }
    });

    const htmlRaw = await resp.text();
    const html = htmlEntityDecode(htmlRaw);

    // 取得 data-local（解實體、嘗試修引號）
    const dlMatch = html.match(/data-local=(['"])([\s\S]*?)\1/);
    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到 data-local 區塊" });
    }

    let decoded = htmlEntityDecode(dlMatch[2]);
    let dataLocal;
    try {
      dataLocal = JSON.parse(decoded);
    } catch (e) {
      try {
        const fixed = fixJsonQuotes(decoded);
        dataLocal = JSON.parse(fixed);
      } catch (err2) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(500).json({ error: "抓取失敗", details: err2.message });
      }
    }

    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    if (!series.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "data-local 中無 series" });
    }

    // 準備每個 series 的 name 與樣本值與中位數（供 debug 與選擇）
    const metaSeries = series.map((s, idx) => {
      const name = s && s.name ? String(s.name) : null;
      const vals = Array.isArray(s && s.data) ? s.data.map(pt => Array.isArray(pt) && pt.length>=2 ? Number(pt[1]) : NaN).filter(v => Number.isFinite(v)) : [];
      return { idx, name, norm: normalizeName(name), median: median(vals), sampleCount: vals.length, sampleVals: vals.slice(0,5) };
    });

    // 嘗試以正規化名稱匹配 "本行賣出"（可抓到含不可見字元的重複）
    const targetNorm = normalizeName("本行賣出");
    const normMatches = metaSeries.filter(ms => ms.norm === targetNorm);

    let pickIndex = null;
    let pickReason = "";

    if (normMatches.length >= 2) {
      // 選第二個出現（index=1）
      pickIndex = normMatches[1].idx;
      pickReason = "normalized-name: second occurrence";
    } else if (normMatches.length === 1) {
      // 若只有一個正規名相符，仍嘗試在所有 series 中找出非現金且 median 最小者作為確認
      const nonCash = metaSeries.filter(ms => ms.name && !/現金/.test(ms.name));
      if (nonCash.length > 0) {
        nonCash.sort((a,b) => {
          if (Number.isFinite(a.median) && Number.isFinite(b.median)) return a.median - b.median;
          if (Number.isFinite(a.median)) return -1;
          if (Number.isFinite(b.median)) return 1;
          return 0;
        });
        // 如果第一名（median 最低）不是 normMatches[0]，採用 median 最低者，因為即期通常比現金高/低視情況，這裡假設中位數最小較接近即期賣出
        if (nonCash[0].idx !== normMatches[0].idx) {
          pickIndex = nonCash[0].idx;
          pickReason = "single normalized match but picked non-cash smallest-median as stronger proxy";
        } else {
          pickIndex = normMatches[0].idx;
          pickReason = "single normalized match accepted";
        }
      } else {
        pickIndex = normMatches[0].idx;
        pickReason = "single normalized match accepted (no non-cash fallback)";
      }
    } else {
      // 沒有正規化名稱完全匹配，退到 name 包含 "本行賣出"（寬鬆）找所有 candidate
      const looseMatches = metaSeries.filter(ms => ms.name && /本行賣出/.test(ms.name));
      if (looseMatches.length >= 2) {
        pickIndex = looseMatches[1].idx;
        pickReason = "loose-name: second occurrence";
      } else if (looseMatches.length === 1) {
        // 同樣以 non-cash median 最小者做備援
        const nonCash = metaSeries.filter(ms => ms.name && !/現金/.test(ms.name));
        if (nonCash.length > 0) {
          nonCash.sort((a,b) => {
            if (Number.isFinite(a.median) && Number.isFinite(b.median)) return a.median - b.median;
            if (Number.isFinite(a.median)) return -1;
            if (Number.isFinite(b.median)) return 1;
            return 0;
          });
          if (nonCash[0].idx !== looseMatches[0].idx) {
            pickIndex = nonCash[0].idx;
            pickReason = "loose single-match but picked non-cash smallest-median";
          } else {
            pickIndex = looseMatches[0].idx;
            pickReason = "loose single-match accepted";
          }
        } else {
          pickIndex = looseMatches[0].idx;
          pickReason = "loose single-match accepted (no non-cash fallback)";
        }
      } else {
        // 最後備援：挑非現金的 median 最小者；若沒有非現金則挑 median 最小的所有 series
        const nonCash = metaSeries.filter(ms => ms.name && !/現金/.test(ms.name));
        const pool = nonCash.length ? nonCash : metaSeries;
        pool.sort((a,b) => {
          if (Number.isFinite(a.median) && Number.isFinite(b.median)) return a.median - b.median;
          if (Number.isFinite(a.median)) return -1;
          if (Number.isFinite(b.median)) return 1;
          return 0;
        });
        pickIndex = pool[0].idx;
        pickReason = "fallback: chosen smallest-median from pool";
      }
    }

    const pickSeries = series[pickIndex];
    if (!pickSeries || !Array.isArray(pickSeries.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "選取 series 失敗",
        metaSeries: metaSeries
      });
    }

    // 產生結果 rates
    const results = {};
    for (const point of pickSeries.data) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [ts, rate] = point;
      const date = msToDate(ts);
      if (date.startsWith(month)) results[date] = Number(rate);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      meta: {
        sourceUrl: url,
        pick: { index: pickIndex, name: pickSeries.name, reason: pickReason },
        seriesSummary: metaSeries
      },
      rates: results
    });

  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
