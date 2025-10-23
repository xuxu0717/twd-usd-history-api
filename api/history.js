function htmlEntityDecode(str) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

    // 1) 解析表頭 th，找出文字為「本行賣出」的欄位 index（在表格的 th 序列中）
    // 支援 class 或無 class 情況：用正則抓出 <th ...>...</th>，並取 inner text
    const thRegex = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
    const ths = [];
    let thMatch;
    while ((thMatch = thRegex.exec(html)) !== null) {
      // 去除 tag 內的 HTML 留下純文字（簡單移除所有標籤）
      const inner = thMatch[1].replace(/<[^>]+>/g, "").trim();
      ths.push(inner);
    }

    // 若無 th，退回嘗試從 data-local
    if (!ths || ths.length === 0) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: "頁面未包含表頭 th，可能為動態載入或表格結構異動" });
    }

    // 找出本行賣出所在的 index
    const targetName = "本行賣出";
    let targetIndex = -1;
    for (let i = 0; i < ths.length; i++) {
      if (ths[i] && ths[i].includes(targetName)) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({ error: `找不到表頭 "${targetName}"，表頭列表已回傳供檢查`, thsSample: ths.slice(0, 30) });
    }

    // 2) 解析每一列 tr，收集同一欄位 index 的 td 值
    // 抓出 table body 內的 tr 序列（但頁面可能有多個 table，這裡抓所有 tr）
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const results = {};
    let trMatch;
    while ((trMatch = trRegex.exec(html)) !== null) {
      const trInner = trMatch[1];

      // 取出該 tr 裡所有 td 的文字（去 tag）
      const tdMatches = [...trInner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());

      if (tdMatches.length === 0) continue;

      // 日期欄位通常會有 data-table="日期" 或第一個 td 是日期，可嘗試先找 data-table="日期"
      // 先嘗試用正則從 trInner 找 data-table="日期"
      let date = null;
      const dateMatch = trInner.match(/<td\b[^>]*data-table=["']?日期["']?[^>]*>([\s\S]*?)<\/td>/i);
      if (dateMatch) {
        date = dateMatch[1].replace(/<[^>]+>/g, "").trim().replace(/\//g, "-");
      } else {
        // 若沒有 data-table，嘗試把第一個 td 視為日期（若格式符合 YYYY/MM/DD 或 YYYY-MM-DD）
        const first = tdMatches[0] || "";
        const d1 = first.replace(/\s+/g, "");
        if (/^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(d1)) {
          date = d1.replace(/\//g, "-");
        } else {
          // 若第一欄不是日期，嘗試找任何欄位匹配日期格式
          for (const cell of tdMatches) {
            const c = cell.replace(/\s+/g, "");
            if (/^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(c)) {
              date = c.replace(/\//g, "-");
              break;
            }
          }
        }
      }

      if (!date) continue;

      // 若 targetIndex 超過 tdMatches 長度，跳過
      if (targetIndex < 0 || targetIndex >= tdMatches.length) continue;

      const rawVal = tdMatches[targetIndex];
      const num = parseNumber(rawVal);
      if (!Number.isFinite(num)) continue;

      // 僅保留查詢月份
      if (date.startsWith(month)) results[date] = num;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
