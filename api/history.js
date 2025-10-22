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
    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3') // key 改雙引號
    .replace(/:\s*'([^']*)'/g, ': "$1"'); // value 改雙引號
}

function msToDate(ms) {
  const d = new Date(ms);
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
    const html = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Referer": "https://rate.bot.com.tw/xrt/"
      }
    }).then(r => r.text());

    const match = html.match(/data-local=(['"])([\s\S]*?)\1/);
    if (!match) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到 data-local 區塊" });
    }

    const raw = match[2];
    const decoded = htmlEntityDecode(raw);
    let dataLocal;

    try {
      dataLocal = JSON.parse(decoded);
    } catch (e) {
      try {
        const fixed = fixJsonQuotes(decoded);
        dataLocal = JSON.parse(fixed);
      } catch (err2) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(500).json({
          error: "抓取失敗",
          details: err2.message
        });
      }
    }

    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    const sellSeries = series.find(s => s.name === "本行賣出");
    if (!sellSeries || !Array.isArray(sellSeries.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到本行賣出資料" });
    }

    const results = {};
    for (const [ts, rate] of sellSeries.data) {
      const date = msToDate(ts);
      if (date.startsWith(month)) {
        results[date] = Number(rate);
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
