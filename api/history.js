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

    const dlMatch = html.match(/data-local=(['"])([\s\S]*?)\1/);
    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到 data-local 區塊" });
    }

    let decoded = dlMatch[2];
    decoded = htmlEntityDecode(decoded);
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

    // 找出所有 name 包含 本行賣出 的 candidates（保留其 index 與 name）
    const candidates = series
      .map((s, i) => ({ s, i }))
      .filter(x => x.s && typeof x.s.name === "string" && /本行賣出/.test(x.s.name));

    let pick = null;
    let pickInfo = null;

    if (candidates.length === 0) {
      // 備援：找包含「即期」或非現金的 series
      pick = series.find(s => s && typeof s.name === "string" && /即期/.test(s.name))
        || series.find(s => s && typeof s.name === "string" && !/現金/.test(s.name))
        || series[0];
      pickInfo = { reason: "no '本行賣出' match", name: pick && pick.name ? pick.name : null };
    } else if (candidates.length === 1) {
      pick = candidates[0].s;
      pickInfo = { reason: "single candidate", index: candidates[0].i, name: pick.name };
    } else {
      // 多個 candidate：計算每個 candidate 在查詢月份的中位數，選中位數最小者（假設即期偏低）
      const scored = [];
      for (const c of candidates) {
        const vals = (Array.isArray(c.s.data) ? c.s.data : [])
          .map(pt => Array.isArray(pt) && pt.length>=2 ? Number(pt[1]) : NaN)
          .filter(v => Number.isFinite(v));
        const med = median(vals);
        scored.push({ index: c.i, name: c.s.name, median: med, sampleCount: vals.length });
      }
      scored.sort((a,b) => {
        if (Number.isFinite(a.median) && Number.isFinite(b.median)) return a.median - b.median;
        if (Number.isFinite(a.median)) return -1;
        if (Number.isFinite(b.median)) return 1;
        return 0;
      });
      const best = scored[0];
      pick = series[best.index];
      pickInfo = { reason: "multiple candidates, picked lowest median", picked: best, scored };
    }

    if (!pick || !Array.isArray(pick.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "選取 series 失敗",
        seriesNames: series.map(s => (s && s.name) ? s.name : null)
      });
    }

    const results = {};
    for (const point of pick.data) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [ts, rate] = point;
      const date = msToDate(ts);
      if (date.startsWith(month)) results[date] = Number(rate);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      meta: { sourceUrl: url, pickInfo },
      rates: results
    });
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
