export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-09" });
  }

  const results = {};
  const [year, mon] = month.split("-");
  const daysInMonth = new Date(year, mon, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const url = `https://rate.bot.com.tw/xrt/history?Lang=zh-TW&date=${date}&currency=USD`;

    try {
      const html = await fetch(url).then(r => r.text());
      const match = html.match(/即期賣出價.*?<td[^>]*>([\d.]+)<\/td>/);
      const rate = match ? parseFloat(match[1]) : null;
      results[date] = rate || null;
    } catch {
      results[date] = null;
    }
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json(results);
}
