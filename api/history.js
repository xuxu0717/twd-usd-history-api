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

    // 抓出 data-local='...'
    const dlMatch = html.match(/data-local='([\s\S]*?)'/);
    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到 data-local JSON" });
    }

    // 解析 JSON（頁面使用單引號包裹，內容為標準 JSON）
    let dataLocal;
    try {
      dataLocal = JSON.parse(dlMatch[1]);
    } catch (e) {
      // 有時內容含單引號或跳脫字元，嘗試修正
      const fixed = dlMatch[1]
        .replace(/\\'/g, "'")
        .replace(/\n/g, "\\n");
      dataLocal = JSON.parse(fixed);
    }

    // 找到本行賣出系列
    const sellSeries = (dataLocal.series || []).find(s => s.name === "本行賣出");
    if (!sellSeries || !Array.isArray(sellSeries.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到本行賣出資料" });
    }

    // 映射成 { YYYY-MM-DD: rate }
    const toDate = ms => {
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const results = {};
    for (const [ts, rate] of sellSeries.data) {
      const date = toDate(ts);
      // 僅保留查詢月份
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
