// api/history.js - 固定選取 sourceIdx=1, seriesIdx=0，回傳僅有日期與匯率的物件
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

  const TARGET_SOURCE = 1;
  const TARGET_SERIES = 0;
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

    const dlRegex = /data-local=(['"])([\s\S]*?)\1/gi;
    const dlMatches = [...html.matchAll(dlRegex)];
    if (!dlMatches.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到任何 data-local 區塊" });
    }

    // 解析所有 data-local
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
          continue;
        }
      }
      parsedList.push({ sourceIdx: si, dataLocal });
    }

    // 合併 series
    const combined = [];
    for (const item of parsedList) {
      if (!item.dataLocal || !Array.isArray(item.dataLocal.series)) continue;
      item.dataLocal.series.forEach((s, seriesIdx) => {
        combined.push({ sourceIdx: item.sourceIdx, seriesIdx, rawSeries: s });
      });
    }

    const target = combined.find(c => c.sourceIdx === TARGET_SOURCE && c.seriesIdx === TARGET_SERIES);
    if (!target || !target.rawSeries || !Array.isArray(target.rawSeries.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到指定的 sourceIdx/seriesIdx 或該 series 無資料" });
    }

    const rates = {};
    for (const pt of target.rawSeries.data) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const date = msToDate(pt[0]);
      if (date.startsWith(month)) rates[date] = Number(pt[1]);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(rates);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
