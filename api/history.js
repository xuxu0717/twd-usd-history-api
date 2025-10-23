// api/history.js - 掃描並合併 HTML 中所有 data-local 出現
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

    // 找出所有 data-local=(...) 出現（可能多個 script 或 data 屬性）
    const dlRegex = /data-local=(['"])([\s\S]*?)\1/gi;
    const dlMatches = [...html.matchAll(dlRegex)];
    if (!dlMatches.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到任何 data-local 區塊", source: url });
    }

    const combined = [];
    let sourceIdx = 0;
    for (const m of dlMatches) {
      let payload = m[2] || "";
      payload = htmlEntityDecode(payload);
      let dataLocal = null;
      try {
        dataLocal = JSON.parse(payload);
      } catch (e1) {
        try {
          const fixed = fixJsonQuotes(payload);
          dataLocal = JSON.parse(fixed);
        } catch (e2) {
          // 解析失敗：跳過此 data-local，但記錄 debug
          combined.push({ sourceIdx, parseError: e2.message, rawPreview: payload.slice(0, 200) });
          sourceIdx++;
          continue;
        }
      }

      // 若 dataLocal 有 series，將每個 series 加入 combined，並標註來源
      if (dataLocal && Array.isArray(dataLocal.series)) {
        dataLocal.series.forEach((s, seriesIdx) => {
          const name = s && s.name ? String(s.name) : null;
          const rates = {};
          if (Array.isArray(s && s.data)) {
            for (const pt of s.data) {
              if (!Array.isArray(pt) || pt.length < 2) continue;
              const date = msToDate(pt[0]);
              if (date.startsWith(month)) rates[date] = Number(pt[1]);
            }
          }
          combined.push({
            sourceIdx,
            seriesIdx,
            name,
            sampleCount: Array.isArray(s && s.data) ? s.data.length : 0,
            rates
          });
        });
      } else {
        // data-local 無 series，回報以供檢查
        combined.push({ sourceIdx, note: "no series in this data-local", rawPreview: JSON.stringify(dataLocal).slice(0,200) });
      }

      sourceIdx++;
    }

    // 回傳所有合併結果
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ source: url, month, totalDataLocalFound: dlMatches.length, series: combined });
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message, source: url });
  }
}
