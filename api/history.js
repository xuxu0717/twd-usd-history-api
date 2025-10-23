// api/history.js - 固定選取 sourceIdx=1, seriesIdx=0 的 series（若找不到則回傳 seriesSummary）
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

export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

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

    // 抓出所有 data-local
    const dlRegex = /data-local=(['"])([\s\S]*?)\1/gi;
    const dlMatches = [...html.matchAll(dlRegex)];
    if (!dlMatches.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到任何 data-local 區塊", source: url });
    }

    // 解析所有 data-local 並組成結構化陣列
    const parsedList = [];
    for (let si = 0; si < dlMatches.length; si++) {
      const raw = htmlEntityDecode(dlMatches[si][2] || "");
      let dataLocal = null;
      try {
        dataLocal = JSON.parse(raw);
      } catch (e1) {
        try {
          dataLocal = JSON.parse(fixJsonQuotes(raw));
        } catch (e2) {
          parsedList.push({ sourceIdx: si, parseError: e2.message });
          continue;
        }
      }
      parsedList.push({ sourceIdx: si, dataLocal });
    }

    // 合併每個 dataLocal 的 series，並保留 sourceIdx 與 seriesIdx
    const combined = [];
    for (const item of parsedList) {
      if (!item.dataLocal || !Array.isArray(item.dataLocal.series)) continue;
      item.dataLocal.series.forEach((s, seriesIdx) => {
        combined.push({
          sourceIdx: item.sourceIdx,
          seriesIdx,
          name: s && s.name ? String(s.name) : null,
          rawSeries: s
        });
      });
    }

    // 你指定的目標
    const TARGET_SOURCE = 1;
    const TARGET_SERIES = 0;

    // 找到目標 series
    const target = combined.find(c => c.sourceIdx === TARGET_SOURCE && c.seriesIdx === TARGET_SERIES);

    if (!target || !target.rawSeries || !Array.isArray(target.rawSeries.data)) {
      // 準備可檢查的 seriesSummary 回傳給你以便手動確認 index
      const summary = combined.map(c => {
        const vals = Array.isArray(c.rawSeries && c.rawSeries.data) ? c.rawSeries.data.map(pt => Array.isArray(pt) && pt.length>=2 ? Number(pt[1]) : null).filter(v => v!=null) : [];
        return {
          sourceIdx: c.sourceIdx,
          seriesIdx: c.seriesIdx,
          name: c.name,
          sampleCount: vals.length,
          sampleMedian: vals.length ? vals.sort((a,b)=>a-b)[Math.floor(vals.length/2)] : null
        };
      });
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "找不到指定的 sourceIdx/seriesIdx 或該 series 無資料",
        requested: { sourceIdx: TARGET_SOURCE, seriesIdx: TARGET_SERIES },
        source: url,
        totalDataLocalFound: dlMatches.length,
        seriesSummary: summary
      });
    }

    // 從 target.rawSeries.data 取出該月份的 rates
    const rates = {};
    for (const pt of target.rawSeries.data) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const date = msToDate(pt[0]);
      if (date.startsWith(month)) rates[date] = Number(pt[1]);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      meta: { sourceUrl: url, selected: { sourceIdx: TARGET_SOURCE, seriesIdx: TARGET_SERIES, name: target.name } },
      month,
      rates
    });
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message, source: url });
  }
}
