export default async function handler(req, res) {
  const { month = "2025-08" } = req.query;
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

    const html = await resp.text();
    const slice = html.slice(0, 20000);

    // quick indicators
    const indicators = {
      status: resp.status,
      length: html.length,
      hasTable: /<table[^>]*>/.test(html),
      hasTr: /<tr[^>]*>/.test(html),
      hasDateCell: /data-table="日期"/.test(html),
      hasSightCells: /rate-content-sight/.test(html),
      hasUSD: /USD/.test(html),
      isLikelySPA: /<script.+(fetch|axios|XMLHttpRequest|Vue|React)/.test(html),
      hasPlaceholderText: /loading|載入中|No Data/i.test(html)
    };

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      url,
      indicators,
      sample: slice
    });
  } catch (err) {
    res.status(500).json({ error: "fetch failed", details: err.message });
  }
}
