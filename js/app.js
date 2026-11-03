// 個人股票系統：讀取 data/data.js（window.STOCK_DATA）並畫出各頁內容
(function () {
  const D = window.STOCK_DATA;
  if (!D) {
    document.querySelector("main").innerHTML =
      '<p class="note">找不到資料檔 data/data.js，請先執行 python3 scripts/build_data.py</p>';
    return;
  }

  // ---------- 小工具 ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) =>
    Number(n).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
  const cls = (n) => (n > 0 ? "up" : n < 0 ? "down" : "");
  const pct = (n) => (isFinite(n) ? fmt(n * 100, 1) + "%" : "—");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const money = (n) => `<span class="${cls(n)}">${signed(n)}</span>`;

  const COLOR = { up: "#ef5350", down: "#26a69a", accent: "#f0b429", grid: "#2a313c", muted: "#8b949e" };
  Chart.defaults.color = COLOR.muted;
  Chart.defaults.borderColor = COLOR.grid;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  // 把陣列資料轉成好讀的物件
  const trades = D.trades.map((r) => ({
    date: r[0], stock: r[1], type: r[2], qty: r[3], price: r[4], amount: r[5],
    fee: r[6], tax: r[7], interest: r[8], sblFee: r[9],
  }));
  const matches = D.matches.map((r) => ({
    stock: r[0], pool: r[1], kind: r[2], openDate: r[3], date: r[4], qty: r[5],
    buy: r[6], sell: r[7], pnl: r[7] - r[6],
  }));

  $("dataInfo").textContent =
    `${trades.length.toLocaleString()} 筆交易・${trades[0].date} ~ ${trades[trades.length - 1].date}・更新於 ${D.generatedAt}`;

  // ---------- 期間選單 ----------
  const months = [...new Set(trades.map((t) => t.date.slice(0, 7)))].sort().reverse();
  $("period").innerHTML =
    '<option value="">全部期間</option>' + months.map((m) => `<option value="${m}">${m.replace("/", " 年 ")} 月</option>`).join("");
  const inPeriod = (date) => !state.period || date.startsWith(state.period);

  const state = {
    period: "", stockSort: "pnl", stockAsc: false, page: 0,
    stock: null, roundPage: 0, stockTradePage: 0, openRounds: new Set(),
  };
  const stockLink = (s) => `<span class="stock-link" data-stock="${esc(s)}">${esc(s)}</span>`;

  // 把同一檔、同一天、同一類型的平倉合併成一個「回合」，用來算勝率
  function rounds(list) {
    const map = new Map();
    for (const m of list) {
      const key = `${m.stock}|${m.date}|${m.kind}|${m.pool}`;
      map.set(key, (map.get(key) || 0) + m.pnl);
    }
    return [...map.values()];
  }
  function stats(list) {
    const r = rounds(list);
    const wins = r.filter((x) => x > 0), losses = r.filter((x) => x < 0);
    const gain = sum(wins, (x) => x), loss = -sum(losses, (x) => x);
    return {
      pnl: sum(list, (m) => m.pnl),
      rounds: r.length,
      winRate: r.length ? wins.length / r.length : NaN,
      avgWin: wins.length ? gain / wins.length : 0,
      avgLoss: losses.length ? -loss / losses.length : 0,
      profitFactor: loss ? gain / loss : NaN,
      volume: sum(list, (m) => m.buy),
    };
  }
  const costOf = (t) => t.fee + t.tax + t.interest + t.sblFee;

  // ---------- 總覽 ----------
  let barChart, lineChart, stockChart;
  function renderOverview(ms, ts) {
    const s = stats(ms);
    const fees = sum(ts, costOf);
    const turnover = sum(ts, (t) => t.amount);
    $("kpis").innerHTML = [
      ["已實現損益", money(s.pnl), "已扣手續費與稅"],
      ["勝率", pct(s.winRate), `${fmt(s.rounds)} 個回合`],
      ["獲利因子", isFinite(s.profitFactor) ? fmt(s.profitFactor, 2) : "—", "總獲利 ÷ 總虧損"],
      ["交易成本", fmt(fees), "手續費＋稅＋利息"],
      ["成交金額", fmt(turnover), `${fmt(ts.length)} 筆成交`],
    ].map(([label, value, hint]) =>
      `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`
    ).join("");

    // 選全部期間 → 每月；選單月 → 每日
    const keyOf = state.period ? (m) => m.date : (m) => m.date.slice(0, 7);
    $("barTitle").textContent = state.period ? "每日損益" : "每月損益";
    const byKey = new Map();
    for (const m of ms) byKey.set(keyOf(m), (byKey.get(keyOf(m)) || 0) + m.pnl);
    const labels = [...byKey.keys()].sort();
    const values = labels.map((k) => Math.round(byKey.get(k)));
    const shortLabels = labels.map((l) => (state.period ? l.slice(5) : l));

    barChart?.destroy();
    barChart = new Chart($("barChart"), {
      type: "bar",
      data: {
        labels: shortLabels,
        datasets: [{
          label: "損益",
          data: values,
          backgroundColor: values.map((v) => (v >= 0 ? COLOR.up : COLOR.down)),
          borderRadius: 4,
          maxBarThickness: 36,
        }],
      },
      options: baseOptions({ legend: false }),
    });

    let run = 0;
    const cum = [];
    const daily = new Map();
    for (const m of ms) daily.set(m.date, (daily.get(m.date) || 0) + m.pnl);
    const days = [...daily.keys()].sort();
    for (const d of days) { run += daily.get(d); cum.push(Math.round(run)); }

    lineChart?.destroy();
    lineChart = new Chart($("lineChart"), {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [{
          label: "累積損益",
          data: cum,
          borderColor: COLOR.accent,
          backgroundColor: "rgba(240,180,41,.12)",
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.2,
        }],
      },
      options: baseOptions({ legend: false, crosshair: true }),
    });
  }

  function baseOptions({ legend, crosshair, horizontal }) {
    const valueAxis = { grid: { color: COLOR.grid }, ticks: { callback: (v) => fmt(v) } };
    const catAxis = { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } };
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: horizontal ? "y" : "x",
      interaction: crosshair ? { mode: "index", intersect: false } : { mode: "nearest", intersect: true },
      plugins: {
        legend: { display: legend },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}：${signed(horizontal ? c.parsed.x : c.parsed.y)} 元` } },
      },
      scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    };
  }

  // ---------- 績效分析 ----------
  function renderAnalysis(ms, ts) {
    // 當沖 vs 波段
    const kinds = ["當沖", "波段"];
    const rows = kinds.map((k) => [k, stats(ms.filter((m) => m.kind === k))]);
    rows.push(["合計", stats(ms)]);
    $("kindTable").innerHTML =
      "<thead><tr><th>類型</th><th>已實現損益</th><th>回合數</th><th>勝率</th><th>平均獲利</th><th>平均虧損</th><th>獲利因子</th></tr></thead><tbody>" +
      rows.map(([k, s]) => `<tr><td>${k}</td><td>${money(s.pnl)}</td><td>${fmt(s.rounds)}</td><td>${pct(s.winRate)}</td>
        <td class="up">${fmt(s.avgWin)}</td><td class="down">${fmt(s.avgLoss)}</td>
        <td>${isFinite(s.profitFactor) ? fmt(s.profitFactor, 2) : "—"}</td></tr>`).join("") + "</tbody>";

    // 費用
    const fee = sum(ts, (t) => t.fee), tax = sum(ts, (t) => t.tax);
    const intr = sum(ts, (t) => t.interest), sbl = sum(ts, (t) => t.sblFee);
    const totalCost = fee + tax + intr + sbl;
    const pnl = sum(ms, (m) => m.pnl);
    const gross = pnl + totalCost;
    const parts = [["手續費", fee, "#5b8def"], ["交易稅", tax, "#a77bf3"], ["利息", intr, "#f0b429"], ["融券費", sbl, "#8b949e"]];
    $("feeBox").innerHTML = `
      <p class="note">扣費用前約 ${money(gross)} 元，費用共 <strong>${fmt(totalCost)}</strong> 元，
      ${gross > 0 ? `吃掉了 <strong>${pct(totalCost / gross)}</strong> 的毛利。` : "期間內毛利為負，費用讓虧損更多。"}</p>
      <div class="fee-bar">${parts.filter((p) => p[1] > 0).map(([, v, c]) =>
        `<span style="flex:${v};background:${c}"></span>`).join("")}</div>
      <div class="legend">${parts.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} ${fmt(v)}</span>`).join("")}</div>`;

    // 各股
    const byStock = new Map();
    for (const m of ms) {
      if (!byStock.has(m.stock)) byStock.set(m.stock, []);
      byStock.get(m.stock).push(m);
    }
    const costByStock = new Map();
    for (const t of ts) costByStock.set(t.stock, (costByStock.get(t.stock) || 0) + costOf(t));
    const stockRows = [...byStock].map(([stock, list]) => ({ stock, ...stats(list), cost: costByStock.get(stock) || 0 }));

    // 長條圖：取損益絕對值最大的 20 檔，由賺到賠排序
    const top = [...stockRows].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 20).sort((a, b) => b.pnl - a.pnl);
    stockChart?.destroy();
    stockChart = new Chart($("stockChart"), {
      type: "bar",
      data: {
        labels: top.map((r) => r.stock),
        datasets: [{
          label: "損益",
          data: top.map((r) => Math.round(r.pnl)),
          backgroundColor: top.map((r) => (r.pnl >= 0 ? COLOR.up : COLOR.down)),
          borderRadius: 4,
          maxBarThickness: 18,
        }],
      },
      options: {
        ...baseOptions({ legend: false, horizontal: true }),
        onClick: (e, els) => els.length && openStock(top[els[0].index].stock),
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
      },
    });

    const cols = [
      ["stock", "股票"], ["pnl", "已實現損益"], ["rounds", "回合數"], ["winRate", "勝率"],
      ["profitFactor", "獲利因子"], ["cost", "交易成本"], ["volume", "買進金額"],
    ];
    const sorted = stockRows.sort((a, b) => {
      const x = a[state.stockSort], y = b[state.stockSort];
      const r = typeof x === "string" ? x.localeCompare(y) : (isFinite(x) ? x : -1e15) - (isFinite(y) ? y : -1e15);
      return state.stockAsc ? r : -r;
    });
    $("stockTable").innerHTML =
      "<thead><tr>" + cols.map(([k, n]) =>
        `<th class="sortable" data-key="${k}">${n}${state.stockSort === k ? (state.stockAsc ? " ▲" : " ▼") : ""}</th>`).join("") +
      "</tr></thead><tbody>" +
      sorted.map((r) => `<tr><td>${stockLink(r.stock)}</td><td>${money(r.pnl)}</td><td>${fmt(r.rounds)}</td><td>${pct(r.winRate)}</td>
        <td>${isFinite(r.profitFactor) ? fmt(r.profitFactor, 2) : "—"}</td><td>${fmt(r.cost)}</td><td>${fmt(r.volume)}</td></tr>`).join("") +
      "</tbody>";

    // 帳戶類型
    const pools = ["現股", "融資", "融券"];
    $("poolTable").innerHTML =
      "<thead><tr><th>帳戶</th><th>已實現損益</th><th>回合數</th><th>勝率</th></tr></thead><tbody>" +
      pools.map((p) => {
        const s = stats(ms.filter((m) => m.pool === p));
        return `<tr><td>${p}</td><td>${money(s.pnl)}</td><td>${fmt(s.rounds)}</td><td>${pct(s.winRate)}</td></tr>`;
      }).join("") + "</tbody>";
  }

  $("stockTable").addEventListener("click", (e) => {
    const key = e.target.closest("th")?.dataset.key;
    if (!key) return;
    state.stockAsc = state.stockSort === key ? !state.stockAsc : key === "stock";
    state.stockSort = key;
    render();
  });

  // ---------- 目前持股（不受期間影響）----------
  function renderHoldings() {
    const hs = D.holdings.map((r) => ({ stock: r[0], pool: r[1], qty: r[2], cost: r[3], since: r[4] }))
      .sort((a, b) => b.cost - a.cost);
    const total = sum(hs, (h) => h.cost);
    $("holdTable").innerHTML =
      "<thead><tr><th>股票</th><th class='left'>帳戶</th><th>股數</th><th>平均成本</th><th>總成本</th><th>佔比</th><th>最早買進日</th></tr></thead><tbody>" +
      hs.map((h) => `<tr><td>${stockLink(h.stock)}</td><td class="left">${h.pool}</td><td>${fmt(h.qty)}</td>
        <td>${fmt(h.cost / h.qty, 2)}</td><td>${fmt(h.cost)}</td><td>${pct(h.cost / total)}</td><td>${h.since}</td></tr>`).join("") +
      `</tbody><tfoot><tr><td>合計</td><td></td><td></td><td></td><td>${fmt(total)}</td><td>100%</td><td></td></tr></tfoot>`;

    const byStock = new Map();
    for (const [stock, pool, date, qty, value] of D.unknown) {
      const k = `${stock}|${pool}`;
      const o = byStock.get(k) || { stock, pool, qty: 0, value: 0, first: date, last: date };
      o.qty += qty; o.value += value; o.last = date;
      byStock.set(k, o);
    }
    const us = [...byStock.values()].sort((a, b) => b.value - a.value);
    $("unknownTable").innerHTML =
      "<thead><tr><th>股票</th><th class='left'>帳戶</th><th>股數</th><th>金額</th><th>期間</th></tr></thead><tbody>" +
      us.map((u) => `<tr><td>${stockLink(u.stock)}</td><td class="left">${u.pool}</td><td>${fmt(u.qty)}</td>
        <td>${fmt(u.value)}</td><td>${u.first} ~ ${u.last}</td></tr>`).join("") + "</tbody>";
  }

  // ---------- 交易紀錄 ----------
  const PAGE = 50;
  const types = [...new Set(trades.map((t) => t.type))].sort();
  $("fType").innerHTML += types.map((t) => `<option>${t}</option>`).join("");

  function filteredTrades() {
    const q = $("fStock").value.trim().toLowerCase();
    const type = $("fType").value;
    const from = $("fFrom").value.replaceAll("-", "/");
    const to = $("fTo").value.replaceAll("-", "/");
    return trades.filter((t) =>
      inPeriod(t.date) &&
      (!q || t.stock.toLowerCase().includes(q)) &&
      (!type || t.type === type) &&
      (!from || t.date >= from) &&
      (!to || t.date <= to));
  }

  // 成交明細表格（交易紀錄頁與個股頁共用）
  function tradeRowsHtml(rows, showStock) {
    return "<thead><tr><th>成交日</th>" + (showStock ? "<th class='left'>股票</th>" : "") +
      "<th class='left'>買賣</th><th>股數</th><th>成交價</th><th>價金</th><th>手續費</th><th>交易稅</th><th>利息</th><th>融券費</th></tr></thead><tbody>" +
      rows.map((t) => `<tr><td>${t.date}</td>${showStock ? `<td class="left">${stockLink(t.stock)}</td>` : ""}
        <td class="left ${t.type.endsWith("買") ? "up" : "down"}">${t.type}</td>
        <td>${fmt(t.qty)}</td><td>${fmt(t.price, 2)}</td><td>${fmt(t.amount)}</td><td>${fmt(t.fee)}</td>
        <td>${fmt(t.tax)}</td><td>${fmt(t.interest)}</td><td>${fmt(t.sblFee)}</td></tr>`).join("") + "</tbody>";
  }

  function renderTrades() {
    const list = filteredTrades().slice().reverse(); // 新的在前
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const rows = list.slice(state.page * PAGE, (state.page + 1) * PAGE);
    $("tradeSummary").textContent =
      `共 ${fmt(list.length)} 筆・成交金額 ${fmt(sum(list, (t) => t.amount))}・費用 ${fmt(sum(list, costOf))}`;
    $("tradeTable").innerHTML = tradeRowsHtml(rows, true);
    $("pageInfo").textContent = `第 ${state.page + 1} / ${pages} 頁`;
    $("prevPage").disabled = state.page === 0;
    $("nextPage").disabled = state.page >= pages - 1;
  }

  for (const id of ["fStock", "fType", "fFrom", "fTo"]) {
    $(id).addEventListener("input", () => { state.page = 0; renderTrades(); });
  }
  $("prevPage").addEventListener("click", () => { state.page--; renderTrades(); });
  $("nextPage").addEventListener("click", () => { state.page++; renderTrades(); });

  // ---------- 個股查詢 ----------
  const allStocks = [...new Set(trades.map((t) => t.stock))].sort();
  const tradeCount = new Map();
  for (const t of trades) tradeCount.set(t.stock, (tradeCount.get(t.stock) || 0) + 1);
  $("stockList").innerHTML = allStocks.map((s) => `<option value="${esc(s)}">`).join("");
  $("stockType").innerHTML += types.map((t) => `<option>${t}</option>`).join("");

  const ROUND_PAGE = 30;
  const DAY = 86400000;
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
  let stockPriceChart, stockPnlChart;

  // 依輸入文字找股票：完全相符 → 代號相符 → 唯一包含
  function findStock(text) {
    const q = text.trim().toLowerCase();
    if (!q) return null;
    const exact = allStocks.find((s) => s.toLowerCase() === q || s.split(" ")[0].toLowerCase() === q);
    if (exact) return exact;
    const hits = allStocks.filter((s) => s.toLowerCase().includes(q));
    return hits.length === 1 ? hits[0] : null;
  }

  function openStock(stock) {
    state.stock = stock;
    state.roundPage = 0;
    state.stockTradePage = 0;
    state.openRounds = new Set();
    $("stockInput").value = stock;
    history.replaceState(null, "", "#stock=" + encodeURIComponent(stock.split(" ")[0]));
    showTab("stock");
    renderStock();
    window.scrollTo(0, 0);
  }

  function renderChips() {
    const top = [...tradeCount].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s]) => s);
    $("stockChips").innerHTML = top.map((s) =>
      `<button class="chip ${s === state.stock ? "active" : ""}" data-stock="${esc(s)}">${esc(s)}</button>`).join("");
  }

  // 把同一天、同類型、同帳戶的配對合併成一個回合
  function groupRounds(list) {
    const map = new Map();
    for (const m of list) {
      const key = `${m.date}|${m.kind}|${m.pool}`;
      if (!map.has(key)) map.set(key, { key, date: m.date, kind: m.kind, pool: m.pool, qty: 0, buy: 0, sell: 0, pnl: 0, dayQty: 0, lots: [] });
      const r = map.get(key);
      r.qty += m.qty; r.buy += m.buy; r.sell += m.sell; r.pnl += m.pnl;
      r.dayQty += daysBetween(m.openDate, m.date) * m.qty;
      r.lots.push(m);
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function renderStock() {
    renderChips();
    const stock = state.stock;
    $("stockDetail").hidden = !stock;
    if (!stock) return;

    const ms = matches.filter((m) => m.stock === stock && inPeriod(m.date));
    const ts = trades.filter((t) => t.stock === stock && inPeriod(t.date));
    const s = stats(ms);
    const hold = D.holdings.filter((h) => h[0] === stock);
    const holdQty = sum(hold, (h) => h[2]), holdCost = sum(hold, (h) => h[3]);
    const unknownQty = sum(D.unknown.filter((u) => u[0] === stock && inPeriod(u[2])), (u) => u[3]);
    const buyQty = sum(ts.filter((t) => t.type.endsWith("買")), (t) => t.qty);
    const sellQty = sum(ts.filter((t) => t.type.endsWith("賣")), (t) => t.qty);
    const dayPnl = sum(ms.filter((m) => m.kind === "當沖"), (m) => m.pnl);
    const swingPnl = sum(ms.filter((m) => m.kind === "波段"), (m) => m.pnl);

    $("stockTitle").innerHTML = `${esc(stock)}<small>${state.period ? state.period + " 月" : "全部期間"}</small>`;
    $("stockKpis").innerHTML = [
      ["已實現損益", money(s.pnl), `當沖 ${signed(Math.round(dayPnl))}・波段 ${signed(Math.round(swingPnl))}`],
      ["勝率", pct(s.winRate), `${fmt(s.rounds)} 個回合・獲利因子 ${isFinite(s.profitFactor) ? fmt(s.profitFactor, 2) : "—"}`],
      ["平均每回合", s.rounds ? money(s.pnl / s.rounds) : "—", `賺 ${fmt(s.avgWin)}／賠 ${fmt(s.avgLoss)}`],
      ["交易成本", fmt(sum(ts, costOf)), `${fmt(ts.length)} 筆成交`],
      ["買進股數", fmt(buyQty), `賣出 ${fmt(sellQty)} 股・成交金額 ${fmt(sum(ts, (t) => t.amount))}`],
      ["目前持股", holdQty ? fmt(holdQty) + " 股" : "無",
        holdQty ? `均價 ${fmt(holdCost / holdQty, 2)}・成本 ${fmt(holdCost)}` : unknownQty ? `${fmt(unknownQty)} 股成本未知` : "已全部出清"],
    ].map(([label, value, hint]) =>
      `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`
    ).join("");

    renderStockCharts(ms, ts);
    renderStockMonths(ms, ts);
    renderStockRounds(ms);
    renderStockTrades(ts);
  }

  function renderStockCharts(ms, ts) {
    // 成交價：同一天、同方向、同價位合併成一個點
    const dates = [...new Set(ts.map((t) => t.date))].sort();
    const idx = new Map(dates.map((d, i) => [d, i]));
    const pts = new Map();
    for (const t of ts) {
      const side = t.type.endsWith("買") ? "買" : "賣";
      const key = `${t.date}|${side}|${t.price}`;
      const p = pts.get(key) || { x: idx.get(t.date), y: t.price, qty: 0, side, date: t.date };
      p.qty += t.qty;
      pts.set(key, p);
    }
    const all = [...pts.values()];
    const maxQty = Math.max(1, ...all.map((p) => p.qty));
    const toPoint = (p) => ({ ...p, r: 3 + Math.sqrt(p.qty / maxQty) * 9 });
    const ds = (side, color) => ({
      label: side === "買" ? "買進" : "賣出",
      data: all.filter((p) => p.side === side).map(toPoint),
      backgroundColor: color + "b3",
      borderColor: "#161b22",
      borderWidth: 1,
    });

    stockPriceChart?.destroy();
    stockPriceChart = new Chart($("stockPriceChart"), {
      type: "bubble",
      data: { datasets: [ds("買", COLOR.up), ds("賣", COLOR.down)] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.raw.date} ${c.dataset.label} ${fmt(c.raw.y, 2)} 元 × ${fmt(c.raw.qty)} 股` } },
        },
        scales: {
          x: {
            type: "linear", min: -0.5, max: dates.length - 0.5, grid: { display: false },
            ticks: { stepSize: 1, autoSkip: true, maxTicksLimit: 8, maxRotation: 0, callback: (v) => dates[v]?.slice(5) ?? "" },
          },
          y: { grid: { color: COLOR.grid }, ticks: { callback: (v) => fmt(v, 2) } },
        },
      },
    });

    const daily = new Map();
    for (const m of ms) daily.set(m.date, (daily.get(m.date) || 0) + m.pnl);
    const days = [...daily.keys()].sort();
    let run = 0;
    const cum = days.map((d) => Math.round((run += daily.get(d))));
    stockPnlChart?.destroy();
    stockPnlChart = new Chart($("stockPnlChart"), {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(5)),
        datasets: [{
          label: "累積損益", data: cum, borderColor: COLOR.accent, backgroundColor: "rgba(240,180,41,.12)",
          fill: true, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.2,
        }],
      },
      options: baseOptions({ legend: false, crosshair: true }),
    });
  }

  function renderStockMonths(ms, ts) {
    const months = [...new Set([...ms.map((m) => m.date.slice(0, 7)), ...ts.map((t) => t.date.slice(0, 7))])].sort().reverse();
    const rows = months.map((mo) => {
      const mm = ms.filter((m) => m.date.startsWith(mo));
      const tt = ts.filter((t) => t.date.startsWith(mo));
      return {
        mo, s: stats(mm),
        day: sum(mm.filter((m) => m.kind === "當沖"), (m) => m.pnl),
        swing: sum(mm.filter((m) => m.kind === "波段"), (m) => m.pnl),
        buy: sum(tt.filter((t) => t.type.endsWith("買")), (t) => t.qty),
        sell: sum(tt.filter((t) => t.type.endsWith("賣")), (t) => t.qty),
        cost: sum(tt, costOf),
      };
    });
    $("stockMonthTable").innerHTML =
      "<thead><tr><th>月份</th><th>已實現損益</th><th>當沖</th><th>波段</th><th>回合</th><th>勝率</th><th>買進股數</th><th>賣出股數</th><th>交易成本</th></tr></thead><tbody>" +
      rows.map((r) => `<tr><td>${r.mo}</td><td>${money(r.s.pnl)}</td><td>${money(r.day)}</td><td>${money(r.swing)}</td>
        <td>${fmt(r.s.rounds)}</td><td>${pct(r.s.winRate)}</td><td>${fmt(r.buy)}</td><td>${fmt(r.sell)}</td><td>${fmt(r.cost)}</td></tr>`).join("") +
      "</tbody>";
  }

  function renderStockRounds(ms) {
    const rounds = groupRounds(ms);
    const pages = Math.max(1, Math.ceil(rounds.length / ROUND_PAGE));
    state.roundPage = Math.min(state.roundPage, pages - 1);
    const rows = rounds.slice(state.roundPage * ROUND_PAGE, (state.roundPage + 1) * ROUND_PAGE);
    $("stockRoundTable").innerHTML =
      "<thead><tr><th>平倉日</th><th class='left'>類型</th><th class='left'>帳戶</th><th>股數</th><th>買進成本/股</th><th>賣出收入/股</th><th>損益</th><th>報酬率</th><th>平均持有天數</th></tr></thead><tbody>" +
      rows.map((r) => {
        const open = state.openRounds.has(r.key);
        const main = `<tr class="round ${open ? "open" : ""}" data-key="${r.key}"><td>${r.date}</td><td class="left">${r.kind}</td>
          <td class="left">${r.pool}</td><td>${fmt(r.qty)}</td><td>${fmt(r.buy / r.qty, 2)}</td><td>${fmt(r.sell / r.qty, 2)}</td>
          <td>${money(r.pnl)}</td><td class="${cls(r.pnl)}">${pct(r.pnl / r.buy)}</td><td>${fmt(r.dayQty / r.qty, 1)}</td></tr>`;
        const lots = open ? r.lots.map((m) => `<tr class="lot"><td>開倉 ${m.openDate}</td><td></td><td></td><td>${fmt(m.qty)}</td>
          <td>${fmt(m.buy / m.qty, 2)}</td><td>${fmt(m.sell / m.qty, 2)}</td><td>${money(m.pnl)}</td>
          <td>${pct(m.pnl / m.buy)}</td><td>${fmt(daysBetween(m.openDate, m.date))}</td></tr>`).join("") : "";
        return main + lots;
      }).join("") + "</tbody>";
    $("roundPage").textContent = `第 ${state.roundPage + 1} / ${pages} 頁・共 ${fmt(rounds.length)} 個回合`;
    $("roundPrev").disabled = state.roundPage === 0;
    $("roundNext").disabled = state.roundPage >= pages - 1;
  }

  function renderStockTrades(ts) {
    const type = $("stockType").value;
    const list = ts.filter((t) => !type || t.type === type).slice().reverse();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.stockTradePage = Math.min(state.stockTradePage, pages - 1);
    const rows = list.slice(state.stockTradePage * PAGE, (state.stockTradePage + 1) * PAGE);
    const qty = sum(list, (t) => t.qty), amount = sum(list, (t) => t.amount);
    $("stockTradeSummary").textContent =
      `共 ${fmt(list.length)} 筆・${fmt(qty)} 股・成交均價 ${qty ? fmt(amount / qty, 2) : "—"}・費用 ${fmt(sum(list, costOf))}`;
    $("stockTradeTable").innerHTML = tradeRowsHtml(rows, false);
    $("stPage").textContent = `第 ${state.stockTradePage + 1} / ${pages} 頁`;
    $("stPrev").disabled = state.stockTradePage === 0;
    $("stNext").disabled = state.stockTradePage >= pages - 1;
  }

  $("stockInput").addEventListener("change", (e) => {
    const s = findStock(e.target.value);
    if (s) openStock(s);
  });
  $("stockInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const s = findStock(e.target.value);
    if (s) openStock(s);
    else alert("找不到符合的股票，請輸入更完整的代號或名稱");
  });
  $("stockChips").addEventListener("click", (e) => {
    const s = e.target.closest(".chip")?.dataset.stock;
    if (s) openStock(s);
  });
  $("stockRoundTable").addEventListener("click", (e) => {
    const key = e.target.closest("tr.round")?.dataset.key;
    if (!key) return;
    state.openRounds.has(key) ? state.openRounds.delete(key) : state.openRounds.add(key);
    renderStockRounds(matches.filter((m) => m.stock === state.stock && inPeriod(m.date)));
  });
  const stockMatches = () => matches.filter((m) => m.stock === state.stock && inPeriod(m.date));
  const stockTrades = () => trades.filter((t) => t.stock === state.stock && inPeriod(t.date));
  $("roundPrev").addEventListener("click", () => { state.roundPage--; renderStockRounds(stockMatches()); });
  $("roundNext").addEventListener("click", () => { state.roundPage++; renderStockRounds(stockMatches()); });
  $("stPrev").addEventListener("click", () => { state.stockTradePage--; renderStockTrades(stockTrades()); });
  $("stNext").addEventListener("click", () => { state.stockTradePage++; renderStockTrades(stockTrades()); });
  $("stockType").addEventListener("input", () => { state.stockTradePage = 0; renderStockTrades(stockTrades()); });

  // 任何表格裡的股票名稱點了都能跳到個股查詢
  document.addEventListener("click", (e) => {
    const s = e.target.closest(".stock-link")?.dataset.stock;
    if (s) openStock(s);
  });

  // ---------- 分頁切換 ----------
  function showTab(id) {
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === id));
  }
  document.querySelectorAll(".tab").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.dataset.tab)));

  $("period").addEventListener("change", (e) => { state.period = e.target.value; state.page = 0; render(); });

  function render() {
    const ms = matches.filter((m) => inPeriod(m.date));
    const ts = trades.filter((t) => inPeriod(t.date));
    renderOverview(ms, ts);
    renderAnalysis(ms, ts);
    renderTrades();
    renderStock();
  }

  renderHoldings();
  render();

  // 網址帶 #stock=2327 時直接打開該檔
  const hashCode = decodeURIComponent((location.hash.match(/stock=([^&]+)/) || [])[1] || "");
  const hashStock = hashCode && findStock(hashCode);
  if (hashStock) openStock(hashStock);
})();
