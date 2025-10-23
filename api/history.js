// api/history.js - 回傳 data-local 中的所有 series（含每個 series 在查詢月份的每日值）
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

    // 組合回傳：每個 series 包含 name, index, sampleCount, and rates for the requested month
    const out = series.map((s, idx) => {
      const name = s && s.name ? String(s.name) : null;
      const rates = {};
      if (Array.isArray(s && s.data)) {
        for (const point of s.data) {
          if (!Array.isArray(point) || point.length < 2) continue;
          const [ts, rate] = point;
          const date = msToDate(ts);
          if (date.startsWith(month)) rates[date] = Number(rate);
        }
      }
      return {
        index: idx,
        name,
        sampleCount: Array.isArray(s && s.data) ? s.data.length : 0,
        rates
      };
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      sourceUrl: url,
      month,
      series: out
    });
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
