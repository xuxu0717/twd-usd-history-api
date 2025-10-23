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

function pickSpotSeries(seriesArr) {
  if (!Array.isArray(seriesArr) || seriesArr.length === 0) return null;

  // 1) 優先找明確標示為「本行賣出」或包含「即期」關鍵字的 series
  const prefer = seriesArr.find(s => s && typeof s.name === 'string' &&
    (/本行賣出/.test(s.name) || /即期/.test(s.name) || /即期賣出/.test(s.name)));
  if (prefer) return prefer;

  // 2) 如果沒找到，排除掉包含「現金」關鍵字的 series，取第一個非現金的
  const nonCash = seriesArr.find(s => s && typeof s.name === 'string' && !/現金/.test(s.name));
  if (nonCash) return nonCash;

  // 3) 最後備援：回第一個 series（保守做法）
  return seriesArr[0];
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
    if (!series.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "data-local 中無 series" });
    }

    const spotSeries = pickSpotSeries(series);
    if (!spotSeries || !Array.isArray(spotSeries.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到即期（本行賣出）系列資料" });
    }

    const results = {};
    for (const point of spotSeries.data) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [ts, rate] = point;
      const date = msToDate(Number(ts));
      if (date.startsWith(month)) {
        results[date] = Number(rate);
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
