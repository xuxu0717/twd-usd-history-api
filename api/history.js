export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

  const url = `https://rate.bot.com.tw/xrt/quote/${month}/USD`;

  try {
    const html = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"
      }
    }).then(r => r.text());

    const results = {};

    // 逐列抓 tr 區塊
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr;
    while ((tr = trRegex.exec(html)) !== null) {
      const row = tr[1];

      // 抓日期
      const dateMatch = row.match(/<td[^>]*data-table="日期"[^>]*>(\d{4}\/\d{2}\/\d{2})<\/td>/);
      if (!dateMatch) continue;
      const date = dateMatch[1].replace(/\//g, "-");

      // 確認幣別是 USD（有些頁面仍含幣別欄位）
      const currencyMatch = row.match(/<td[^>]*data-table="幣別"[^>]*>[^<]*USD[^<]*<\/td>/i);
      // 若頁面只列 USD（沒有幣別欄位），則不強制檢查 currencyMatch
      // 但當它存在時必須為 USD
      if (currencyMatch === null) {
        // 沒有幣別欄位就略過檢查（頁面是 /USD，通常僅有 USD）
      }

      // 抓當列的四個匯率數字：現金買入、現金賣出、即期買入、即期賣出
      const nums = [...row.matchAll(/<td[^>]*class="rate-content-sight\s+text-right\s+print_hide"[^>]*>([\d.,]+)<\/td>/g)]
        .map(m => parseFloat(m[1].replace(/,/g, "")));

      if (nums.length >= 4) {
        const spotSelling = nums[3]; // 第4個是即期賣出
        if (!Number.isNaN(spotSelling)) {
          results[date] = spotSelling;
        }
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
