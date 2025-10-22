function htmlEntityDecode(str) {
  // 基本 HTML 實體解碼
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function msToDateYYYYMMDD(ms) {
  // 台銀資料用毫秒 timestamp；用本地或 UTC取決於頁面生成
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

    // 1) 嘗試抓 data-local='...' 或 data-local="..."
    const dlRegex = /data-local=(['"])([\s\S]*?)\1/;
    let dlMatch = dlRegex.exec(html);

    // 2) 若抓不到，嘗試從 script 內嵌 JSON（某些頁面會將配置放進腳本變數）
    if (!dlMatch) {
      const scriptRegex = /var\s+dataLocal\s*=\s*({[\s\S]*?});/; // 假設頁面有 var dataLocal = {...}
      const sMatch = scriptRegex.exec(html);
      if (sMatch) {
        dlMatch = ['', `"${sMatch[1].replace(/"/g, '\\"')}"`]; // 假裝成屬性形式處理
      }
    }

    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "找不到 data-local 資料區塊",
        hint: "請用 /api/debug 檢視 sample，確認頁面是否改版或有防爬"
      });
    }

    // 解碼 HTML 實體（例如 &quot;）
    let encoded = dlMatch[2];
    let decoded = htmlEntityDecode(encoded);

    // 某些情況會出現被多重跳脫的引號或換行，做基本修正
    decoded = decoded
      .replace(/\r?\n/g, "\\n")
      .replace(/\\'/g, "'");

    let dataLocal;
    try {
      // data-local 內容應該是合法 JSON
      dataLocal = JSON.parse(decoded);
    } catch (e) {
      // 如果仍失敗，嘗試把單引號包裹的 JSON 轉為雙引號
      const fixed = decoded
        .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3') // key 改雙引號
        .replace(/:\s*'([^']*)'/g, ': "$1"'); // value 改雙引號
      dataLocal = JSON.parse(fixed);
    }

    // 找「本行賣出」系列
    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    const sellSeries = series.find(s => s && s.name === "本行賣出");
    if (!sellSeries || !Array.isArray(sellSeries.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到本行賣出系列資料" });
    }

    const results = {};
    for (const point of sellSeries.data) {
      // point 形如 [timestampMs, rate]
      if (!Array.isArray(point) || point.length < 2) continue;
      const [ts, rate] = point;
      const date = msToDateYYYYMMDD(Number(ts));
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
