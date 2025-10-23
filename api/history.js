// api/history.js
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
    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
}

function msToDate(ms) {
  const d = new Date(Number(ms));
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
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        "Referer": "https://rate.bot.com.tw/xrt/"
      }
    });

    const htmlRaw = await resp.text();
    const html = htmlEntityDecode(htmlRaw);

    const dlMatch = html.match(/data-local=(['"])([\s\S]*?)\1/);
    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "找不到 data-local 區塊" });
    }

    let decoded = dlMatch[2];
    decoded = htmlEntityDecode(decoded);
    let dataLocal;
    try {
      dataLocal = JSON.parse(decoded);
    } catch (e) {
      try {
        const fixed = fixJsonQuotes(decoded);
        dataLocal = JSON.parse(fixed);
      } catch (err2) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(500).json({ error: "抓取失敗", details: err2.message });
      }
    }

    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    if (!series.length) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "data-local 中無 series" });
    }

    // 找出所有 name 包含 本行賣出 的 series，選第二個（index=1），若不存在則第一個
    const matches = series
      .map((s, i) => ({ s, i }))
      .filter(x => x.s && typeof x.s.name === "string" && /本行賣出/.test(x.s.name));

    let pick = null;
    if (matches.length >= 2) {
      pick = matches[1].s;
    } else if (matches.length === 1) {
      pick = matches[0].s;
    } else {
      // 若沒有找到明確 match，嘗試找包含「即期」或非「現金」的備援
      pick = series.find(s => s && typeof s.name === "string" && /即期/.test(s.name))
        || series.find(s => s && typeof s.name === "string" && !/現金/.test(s.name))
        || series[0];
    }

    if (!pick || !Array.isArray(pick.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "找不到合適的 series",
        seriesNames: series.map(s => (s && s.name) ? s.name : null)
      });
    }

    const results = {};
    for (const point of pick.data) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [ts, rate] = point;
      const date = msToDate(ts);
      if (date.startsWith(month)) results[date] = Number(rate);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(results);
  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
