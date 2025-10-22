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

    // basic checks
    const hasTable = /<table[^>]*>/.test(html);
    const hasRows = /<tr[^>]*>/.test(html);
    const hasDateCell = /data-table="日期"/.test(html);
    const hasSightCell = /class="rate-content-sight/.test(html);

    if (!(hasTable && hasRows && hasDateCell && hasSightCell)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "頁面未包含期望的表格元素，可能為動態載入或遭到阻擋",
        checks: { hasTable, hasRows, hasDateCell, hasSightCell },
        hint: "請用 /api/debug 檢視實際 HTML，或改用替代來源"
      });
    }

    const results = {};
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr;
    while ((tr = trRegex.exec(html)) !== null) {
      const row = tr[1];

      const dateMatch = row.match(/<td[^>]*data-table="日期"[^>]*>(\d{4}\/\d{2}\/\d{2})<\/td>/);
      if (!dateMatch) continue;
      const date = dateMatch[1].replace(/\//g, "-");

      // four numbers in order: 現金買入, 現金賣出, 即期買入, 即期賣出
      const nums = [...row.matchAll(/<td[^>]*class="rate-content-sight\s+text-right\s+print_hide"[^>]*>([\d.,]+)<\/td>/g)]
        .map(m => parseFloat(m[1].replace(/,/g, "")));

      if (nums.length >= 4 && Number.isFinite(nums[3])) {
        results[date] = nums[3];
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
