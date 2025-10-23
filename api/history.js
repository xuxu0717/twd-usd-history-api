// api/history.js

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

function fixJsonQuotes(jsonStr) {
  return jsonStr
    .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*'([^']*)'/g, ': "$1"');
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

    // 1) 嘗試以表格表頭定位「本行賣出」欄位
    // 找出所有 <table ...>...</table> 片段，逐一檢查該 table 的 thead th 是否含 target
    const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[0]);
    const targetThClass = 'rate-content-sight print_table-cell hidden-phone';
    const targetText = '本行賣出';

    let found = false;
    let results = {};
    let debug = { tableCount: tables.length, checkedTables: 0, matchedTableIndex: -1, matchedThIndex: -1, thTextsSample: [] };

    for (let ti = 0; ti < tables.length; ti++) {
      const tableHtml = tables[ti];
      debug.checkedTables++;

      // 擷取該 table 的 thead 內所有 th（若無 thead 也抓所有 th）
      const theadMatch = tableHtml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i);
      const thContainer = theadMatch ? theadMatch[1] : tableHtml;
      const ths = [...thContainer.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
      debug.thTextsSample = debug.thTextsSample.concat(ths.slice(0, 20));

      // 同時檢查完整 th 原始標籤，以便比對 class + innerText
      const thTagMatches = [...thContainer.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi)].map(m => ({ attrs: m[1], inner: m[2] }));

      // 找出第幾個 th 的 inner text 包含 targetText 且 attrs 含 targetThClass（寬鬆匹配）
      let thIndex = -1;
      for (let i = 0; i < thTagMatches.length; i++) {
        const attrs = thTagMatches[i].attrs || "";
        const innerText = (thTagMatches[i].inner || "").replace(/<[^>]+>/g, "").trim();
        if (innerText.includes(targetText) && attrs.includes('rate-content-sight') && attrs.includes('hidden-phone')) {
          thIndex = i;
          break;
        }
      }

      if (thIndex === -1) {
        // 如果沒有 class 完整匹配，也嘗試只比對 inner text（容錯）
        for (let i = 0; i < thTagMatches.length; i++) {
          const innerText = (thTagMatches[i].inner || "").replace(/<[^>]+>/g, "").trim();
          if (innerText.includes(targetText)) {
            thIndex = i;
            break;
          }
        }
      }

      if (thIndex === -1) continue; // 該 table 未命中

      // 若命中，解析該 table 的 tbody 或所有 tr
      debug.matchedTableIndex = ti;
      debug.matchedThIndex = thIndex;
      found = true;

      const tbodyMatch = tableHtml.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
      const rowsSource = tbodyMatch ? tbodyMatch[1] : tableHtml;
      const trMatches = [...rowsSource.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];

      for (const trM of trMatches) {
        const trInner = trM[1];
        // 取所有 td 的純文字
        const tdMatches = [...trInner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());

        if (!tdMatches || tdMatches.length === 0) continue;

        // 日期優先找 data-table="日期" 欄
        let date = null;
        const dateCellMatch = trInner.match(/<td\b[^>]*data-table=["']?日期["']?[^>]*>([\s\S]*?)<\/td>/i);
        if (dateCellMatch) {
          date = dateCellMatch[1].replace(/<[^>]+>/g, "").trim().replace(/\//g, "-");
        } else {
          // 若找不到 data-table，嘗試第一個或任何欄位匹配日期格式
          const cand = tdMatches.find(c => /^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(c.replace(/\s+/g, "")));
          if (cand) date = cand.replace(/\//g, "-");
        }

        if (!date) continue;

        if (thIndex < 0 || thIndex >= tdMatches.length) continue;
        const rawVal = tdMatches[thIndex];
        const num = parseNumber(rawVal);
        if (!Number.isFinite(num)) continue;
        if (date.startsWith(month)) results[date] = num;
      }

      // 命中第一個符合表格後就停止搜尋其他 table
      break;
    }

    if (found) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(results);
    }

    // 2) 表格解析失敗 → 回退到 data-local JSON 抽取（舊有穩定方案）
    const dlMatch = html.match(/data-local=(['"])([\s\S]*?)\1/);
    if (!dlMatch) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "表格解析與 data-local 皆失敗",
        checks: debug
      });
    }

    let decoded = htmlEntityDecode(dlMatch[2]);
    let dataLocal;
    try {
      dataLocal = JSON.parse(decoded);
    } catch (e) {
      const fixed = fixJsonQuotes(decoded);
      dataLocal = JSON.parse(fixed);
    }

    // 從 data-local 取 name 包含「本行賣出」或「即期」的 series
    const series = Array.isArray(dataLocal.series) ? dataLocal.series : [];
    const pick = series.find(s => s && typeof s.name === 'string' && /本行賣出|即期/.test(s.name))
      || series.find(s => s && typeof s.name === 'string' && !/現金/.test(s.name))
      || series[0];

    if (!pick || !Array.isArray(pick.data)) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json({
        error: "data-local 存在但無合適 series",
        seriesNames: series.map(s => (s && s.name) ? s.name : null)
      });
    }

    const fallbackResults = {};
    for (const point of pick.data) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const [ts, rate] = point;
      const date = msToDate(ts);
      if (date.startsWith(month)) fallbackResults[date] = Number(rate);
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json(fallbackResults);

  } catch (err) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ error: "抓取失敗", details: err.message });
  }
}
