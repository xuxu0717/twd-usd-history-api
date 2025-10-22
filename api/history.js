export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

  const url = `https://rate.bot.com.tw/xrt/quote/${month}/USD`;

  try {
    const html = await fetch(url).then(r => r.text());

    // 擷取表格中的日期與即期賣出價
    const regex = /(\d{4}\/\d{2}\/\d{2}).*?<td class="rate-content-sight text-right print_hide"[^>]*>([\d.]+)<\/td>/g;

    const results = {};
    let match;
    while ((match = regex.exec(html)) !== null) {
      const date = match[1].replace(/\//g, "-"); // 轉成 YYYY-MM-DD
      const spotSelling = parseFloat(match[2]);  // 即期賣出價
      results[date] = spotSelling;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
