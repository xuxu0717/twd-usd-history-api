export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

  const url = `https://rate.bot.com.tw/xrt/quote/${month}/USD`;

  try {
    const html = await fetch(url).then(r => r.text());

    // 抓出每一列 <tr>
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    const results = {};
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1];

      // 日期
      const dateMatch = row.match(/<td data-table="日期">([\d/]+)<\/td>/);
      // 即期賣出價（通常是第 5 個 rate-content-sight）
      const cells = [...row.matchAll(/<td class="rate-content-sight text-right print_hide"[^>]*>([\d.]+)<\/td>/g)];

      if (dateMatch && cells.length >= 2) {
        const date = dateMatch[1].replace(/\//g, "-");
        const spotSelling = parseFloat(cells[1][1]); // 第二個是「即期賣出價」
        results[date] = spotSelling;
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
