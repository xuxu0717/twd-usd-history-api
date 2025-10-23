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
function parseNumber(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[,\s]/g, "").trim();
  return cleaned === "" ? NaN : Number(cleaned);
}

export default async function handler(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "請提供正確的月份格式，例如 ?month=2025-08" });
  }

  const url = `https://rate.bot.com.tw/xrt/quote/${month}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "zh-TW,zh;q=0.9"
      }
    });
    const htmlRaw = await resp.text();
    const html = htmlEntityDecode(htmlRaw);

    const results = {};

    // 1) 以 table row 解析：遍歷每個 <tr ...>...</tr>
    const trRegex = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(html)) !== null) {
      const trAttrs = trMatch[1] || "";
      const trInner = trMatch[2] || "";

      // 1.a 取日期：優先 data-date 屬性
      let date = null;
      const dataDateMatch = trAttrs.match(/data-date=["']?(\d{4}[\/-]\d{2}[\/-]\d{2})["']?/i);
      if (dataDateMatch) date = dataDateMatch[1].replace(/\//g, "-");
      if (!date) {
        // 從 trInner 找任何 YYYY-MM-DD 或 YYYY/MM/DD
        const anyDate = trInner.match(/(\d{4}[\/-]\d{2}[\/-]\d{2})/);
        if (anyDate) date = anyDate[1].replace(/\//g, "-");
      }
      if (!date || !date.startsWith(month)) continue;

      // 1.b 在該 tr 內尋找 class 包含指定字串的 td
      // 允許 class 屬性順序不同或多空白，使用正則容錯
      const targetTdRegex = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = targetTdRegex.exec(trInner)) !== null) {
        const tdAttrs = tdMatch[1] || "";
        const tdInner = tdMatch[2] || "";
        // 檢查 class 是否包含指定 token（全部或部分）
        if (/rate-content-sight/.test(tdAttrs) && /print_table-cell/.test(tdAttrs) && /hidden-phone/.test(tdAttrs)) {
          // 去除內部 html tag 只保留文字
          const text = tdInner.replace(/<[^>]+>/g, "").trim();
          const num = parseNumber(text);
          if (Number.isFinite(num)) {
            results[date] = num;
            break;
          }
        }
      }
    }

    // 2) 若解析到資料則回傳
    if (Object.keys(results).length > 0) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json({ source: url, month, method: "tr-td-class-parse", rates: results });
    }

    // 3) 回退到 data-local JSON（舊有穩定方案）
    const dlMatch = html.match(/data-local=(['"])([\s\S]*?)\1/);
    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "表格解析失敗且找不到 data-local" });
    }

    let decoded = htmlEntityDecode(dlMatch[2]);
    let dataLocal;
    try {
      dataLocal = JSON.parse(decoded);
    } catch (e) {
      try {
        const fixed = fixJsonQuotes(decoded);
        dataLocal = JSON.parse(fixed);
      } catch (err2) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(500).json({ error: "data-local 解析失敗", details: err2.message });
      }
    }

    // 回傳所有 series 讓你選 index
    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    const out = series.map((s, idx) => {
      const name = s && s.name ? String(s.name) : null;
      const rates = {};
      if (Array.isArray(s && s.data)) {
        for (const point of s.data) {
          if (!Array.isArray(point) || point.length < 2) continue;
          const date = msToDate(point[0]);
          if (date.startsWith(month)) rates[date] = Number(point[1]);
        }
      }
      return { index: idx, name, sampleCount: Array.isArray(s && s.data) ? s.data.length : 0, rates };
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ source: url, month, method: "fallback-data-local", series: out });

  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
