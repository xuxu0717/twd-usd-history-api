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

  const baseUrl = `https://rate.bot.com.tw/xrt/quote/${month}`;
  try {
    // 1) 先抓月總表（不帶 /USD）
    const resp = await fetch(baseUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept-Language": "zh-TW,zh;q=0.9"
      }
    });
    const htmlRaw = await resp.text();
    const html = htmlEntityDecode(htmlRaw);

    // 2) 嘗試從表格解析：找出 thead 的 th，確定本行賣出欄位 index
    const theadMatch = html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
    const headHtml = theadMatch ? theadMatch[1] : html; // 若無 thead 就搜尋整頁
    const thTagMatches = [...headHtml.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)].map(m => ({ attrs: m[1], inner: m[2].replace(/<[^>]+>/g, "").trim() }));

    let targetThIndex = -1;
    for (let i = 0; i < thTagMatches.length; i++) {
      const attrs = thTagMatches[i].attrs || "";
      const inner = thTagMatches[i].inner || "";
      if (inner.includes("本行賣出") && attrs.includes("rate-content-sight")) {
        targetThIndex = i;
        break;
      }
    }
    // 容錯：若沒找到包含 rate-content-sight 的 th，改以內文匹配「本行賣出」
    if (targetThIndex === -1) {
      for (let i = 0; i < thTagMatches.length; i++) {
        if ((thTagMatches[i].inner || "").includes("本行賣出")) {
          targetThIndex = i;
          break;
        }
      }
    }

    // 3) 若找到了 th index，找出 USD 行（或帶有 USD 標示的 tr）
    const results = {};
    if (targetThIndex !== -1) {
      // 取出所有 table，逐 table 檢查 tbody tr 裡第一個 cell 是否包含 USD
      const tableMatches = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[0]);
      for (const tHtml of tableMatches) {
        const trMatches = [...tHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
        for (const trInner of trMatches) {
          // 判斷是否為 USD 行：任何 cell 含 "USD" 或 "美金" 或 "美元"
          if (!/USD|美金|美元/.test(trInner)) continue;
          // 取所有 td 純文字
          const tdVals = [...trInner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
          if (tdVals.length === 0) continue;
          // 若 th index 在 td 範圍內，讀該欄
          if (targetThIndex >= 0 && targetThIndex < tdVals.length) {
            const raw = tdVals[targetThIndex];
            const num = parseNumber(raw);
            // 有些表格是每列一個日期（不展開），若解析到單日數值就放入當月最後一天候補（不理想）
            // 先嘗試從 trInner 找 date attribute 或 data-date 等資訊
            const dateMatch = trInner.match(/data-date=["']?(\d{4}[-/]\d{2}[-/]\d{2})["']?/i);
            if (dateMatch) {
              const date = dateMatch[1].replace(/\//g, "-");
              if (date.startsWith(month) && Number.isFinite(num)) results[date] = num;
            } else {
              // 嘗試找到任何 YYYY-MM-DD 或 YYYY/MM/DD 字串
              const anyDate = trInner.match(/(\d{4}[\/-]\d{2}[\/-]\d{2})/);
              if (anyDate) {
                const date = anyDate[1].replace(/\//g, "-");
                if (date.startsWith(month) && Number.isFinite(num)) results[date] = num;
              } else {
                // 若找不到日期，可能 table 是按日期橫向呈現（需要另一種解析）
                // 繼續下一個 table
                continue;
              }
            }
          }
        }
      }
    }

    // 4) 如果表格解析未取得任何即期資料，回退到 data-local（舊有方法）
    if (Object.keys(results).length === 0) {
      const dlMatch = html.match(/data-local=(['"])([\s\S]*?)\1/);
      if (!dlMatch) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return res.status(502).json({ error: "表格解析與 data-local 皆失敗，無法取得即期資料" });
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

      // 把 data-local 的所有 series 一一列出（供你比對與選 index）
      const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
      const out = series.map((s, idx) => {
        const name = s && s.name ? String(s.name) : null;
        const rates = {};
        if (Array.isArray(s && s.data)) {
          for (const point of s.data) {
            if (!Array.isArray(point) || point.length < 2) continue;
            const [ts, rate] = point;
            const date = msToDate(ts);
            if (date.startsWith(month)) rates[date] = Number(rate);
          }
        }
        return { index: idx, name, sampleCount: Array.isArray(s && s.data) ? s.data.length : 0, rates };
      });

      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json({ source: baseUrl, month, fallback: "data-local", series: out });
    }

    // 5) 成功從表格取得即期資料
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ source: baseUrl, month, rates: results, method: "table-parse" });

  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
