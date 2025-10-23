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
  const { month, ref = null, tol = "0.03" } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

  // optional reference matches: comma-separated date:value pairs, e.g. ref=2025-08-28:30.63,2025-08-29:30.64
  const refs = [];
  if (ref) {
    for (const part of String(ref).split(",")) {
      const m = part.split(":");
      if (m.length === 2) {
        const d = m[0].trim();
        const v = Number(m[1].trim());
        if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v)) refs.push({ date: d, value: v });
      }
    }
  } else {
    // 你先前提供的樣本（預設參考），可覆蓋或用 query 傳入
    refs.push({ date: `${month}-28`, value: 30.63 });
    refs.push({ date: `${month}-29`, value: 30.64 });
    refs.push({ date: `${month}-01`, value: 30.065 });
  }

  const tolerance = Math.max(0, Number(tol) || 0.03);

  const url = `https://rate.bot.com.tw/xrt/quote/${month}`;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "zh-TW,zh;q=0.9"
      }
    });
    const htmlRaw = await resp.text();
    const html = htmlEntityDecode(htmlRaw);

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
        return res.status(500).json({ error: "JSON 解析失敗", details: err2.message });
      }
    }

    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    if (!series.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "data-local 中無 series" });
    }

    // 準備每個 series 的 month rates map
    const meta = series.map((s, idx) => {
      const name = s && s.name ? String(s.name) : null;
      const map = {};
      const vals = [];
      if (Array.isArray(s && s.data)) {
        for (const pt of s.data) {
          if (!Array.isArray(pt) || pt.length < 2) continue;
          const d = msToDate(pt[0]);
          if (d.startsWith(month)) {
            map[d] = Number(pt[1]);
            vals.push(Number(pt[1]));
          }
        }
      }
      return { index: idx, name, rates: map, median: median(vals), sampleCount: Object.keys(map).length };
    });

    // 比對每個 series 與參考 refs，看哪個 series 命中數最多（允許容差 tolerance）
    const scored = meta.map(m => {
      let hits = 0;
      for (const r of refs) {
        const v = m.rates[r.date];
        if (Number.isFinite(v) && Math.abs(v - r.value) <= tolerance) hits++;
      }
      return { index: m.index, name: m.name, hits, median: m.median, sampleCount: m.sampleCount };
    });

    // 依 hits 排序，若相同則用 sampleCount 與 median 作次排序
    scored.sort((a,b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
      if (Number.isFinite(a.median) && Number.isFinite(b.median)) return a.median - b.median;
      return 0;
    });

    const best = scored[0];

    // 若最佳匹配 hits 為 0，表示沒有 series 明確匹配任何參考，改回傳所有 series summary 讓你人工選 index
    if (!best || best.hits === 0) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json({
        note: "no series matched the provided references within tolerance; please inspect seriesSummary and pick index",
        month,
        url,
        tolerance,
        refs,
        seriesSummary: meta.map(m => ({ index: m.index, name: m.name, sampleCount: m.sampleCount, median: m.median, sampleDates: Object.keys(m.rates).slice(0,5) }))
      });
    }

    // 若有最佳 match，回傳該 series 的 rates
    const chosen = meta.find(m => m.index === best.index);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      sourceUrl: url,
      month,
      chosen: { index: chosen.index, name: chosen.name, hits: best.hits, median: chosen.median, sampleCount: chosen.sampleCount },
      refs,
      tolerance,
      rates: chosen.rates
    });
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
