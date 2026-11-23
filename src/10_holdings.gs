// ── ASSETS & INVESTMENTS ─────────────────────────────────────
// Ported from Money Tracker's src/16_holdings.gs (Stage 4, step 3a).
// A holding is anything you own that isn't cash: gold, stocks, funds, property, a car...
// Buying/selling moves cash between a broker's cash and the holding; it is NOT spending or income.
// Unlike Money Tracker, fees and dividends are NOT copied into Expenses/Income (plan D2/D3):
// a fee stays in the HoldingTxns Fee column, a dividend stays a "dividend" row (tax withheld in Fee).
// Account is the broker's name only; broker cash balances come later (step 3d).
// Cost basis uses the average-cost method.
var HOLDING_KINDS = { gold: "investment", stock: "investment", etf: "investment", fund: "investment",
  crypto: "investment", bond: "investment", property: "asset", vehicle: "asset", electronics: "asset", other: "asset" };

function holdingTxnRows() {
  return sheetToRows(getSheet(SHEET.HOLDING_TXNS), function(d, ri) {
    return { rowIndex: ri, id: String(d[0] || ""), holdingId: String(d[1] || ""), date: formatDate(d[2]),
      type: String(d[3] || ""), quantity: toFloat(d[4]), price: toFloat(d[5]), amount: toFloat(d[6]),
      fee: toFloat(d[7]), account: String(d[8] || "").trim(), note: String(d[9] || ""), linkedId: String(d[10] || ""),
      origAmount: toFloat(d[11]), currency: String(d[12] || "").toUpperCase() };
  });
}

function holdingsData() {
  var txns = holdingTxnRows();
  var holdings = sheetToRows(getSheet(SHEET.HOLDINGS), function(d, ri) {
    var kind = String(d[2] || "other");
    return { rowIndex: ri, id: String(d[0] || ""), name: String(d[1] || ""), kind: kind,
      group: HOLDING_KINDS[kind] || "asset", symbol: String(d[3] || ""), unit: String(d[4] || ""),
      currentPrice: toFloat(d[5]), priceDate: formatDate(d[6]), note: String(d[7] || ""),
      status: String(d[8] || "active"), quoteCurrency: String(d[9] || ""), nextXD: formatDate(d[10]), nextDividend: toFloat(d[11]) };
  });
  var totals = { value: 0, cost: 0, unrealized: 0, realized: 0, dividends: 0, investments: 0, assets: 0 };
  holdings.forEach(function(h) {
    var mine = txns.filter(function(t){ return t.holdingId === h.id; })
      .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); });
    var qty = 0, cost = 0, realized = 0, dividends = 0, invested = 0, fees = 0, lastPrice = 0, tax = 0;
    mine.forEach(function(t) {
      if (t.type === "dividend") tax += t.fee; else fees += t.fee;     // on dividends the Fee column holds tax withheld
      if (t.type === "buy") { qty += t.quantity; cost += t.amount; invested += t.amount; if (t.price) lastPrice = t.price; }
      else if (t.type === "sell") {
        var avg = qty > 0 ? cost / qty : 0, out = avg * t.quantity;
        realized += t.amount - out; qty -= t.quantity; cost -= out;
        if (qty < 1e-9) { qty = 0; cost = 0; }
        if (t.price) lastPrice = t.price;
      } else if (t.type === "dividend") dividends += t.amount;
    });
    var price = h.currentPrice || lastPrice;
    h.quantity = Math.round(qty * 1e6) / 1e6;
    h.cost = round2(cost);
    h.avgCost = qty > 0 ? round2(cost / qty) : 0;
    h.value = round2(price ? qty * price : cost);
    h.priced = !!price;
    h.unrealized = round2(h.value - h.cost);
    h.realized = round2(realized); h.dividends = round2(dividends); h.invested = round2(invested); h.fees = round2(fees); h.taxWithheld = round2(tax);
    h.txns = mine.slice().reverse();
    h.autoPrice = h.group === "investment" && !!priceSource(h);
    h.proceeds = round2(mine.reduce(function(a, t){ return a + (t.type === "sell" ? t.amount : 0); }, 0));
    var trades = mine.filter(function(t){ return t.type !== "dividend"; });
    h.firstDate = trades.length ? trades[0].date : ""; h.lastDate = trades.length ? trades[trades.length - 1].date : "";
    totals.value += h.value; totals.cost += h.cost; totals.unrealized += h.unrealized;
    totals.realized += h.realized; totals.dividends += h.dividends;
    totals[h.group === "investment" ? "investments" : "assets"] += h.value;
  });
  Object.keys(totals).forEach(function(k){ totals[k] = round2(totals[k]); });
  return { ok: true, holdings: holdings, totals: totals };
}

function holdingFields(p) {
  var kind = HOLDING_KINDS[p.kind] ? p.kind : "other";
  return { name: String(p.name || "").trim(), kind: kind, symbol: String(p.symbol || "").trim().toUpperCase(),
    unit: String(p.unit || "").trim(), price: toFloat(p.currentPrice), note: String(p.note || "") };
}
function addHolding(p) {
  var f = holdingFields(p);
  if (!f.name) return jsonResponse({ ok: false, error: "Name required" });
  var sh = getSheet(SHEET.HOLDINGS), id = p.id || newId("H"), r = sh.getLastRow() + 1;
  sh.getRange(r, 7).setNumberFormat("@");
  sh.getRange(r, 1, 1, 9).setValues([[id, f.name, f.kind, f.symbol, f.unit, f.price || "", f.price ? todayStr() : "", f.note, "active"]]);
  return jsonResponse({ ok: true, id: id });
}
function updateHolding(p) {
  var row = resolveRow(SHEET.HOLDINGS, p);
  if (!row) return staleResponse();
  var sh = getSheet(SHEET.HOLDINGS), cur = sh.getRange(row, 1, 1, 9).getValues()[0];
  var f = holdingFields(Object.assign({ name: cur[1], kind: cur[2], symbol: cur[3], unit: cur[4], currentPrice: cur[5], note: cur[7] }, p));
  var priceChanged = p.currentPrice !== undefined && toFloat(p.currentPrice) !== toFloat(cur[5]);
  sh.getRange(row, 7).setNumberFormat("@");
  sh.getRange(row, 2, 1, 7).setValues([[f.name, f.kind, f.symbol, f.unit, f.price || "",
    priceChanged ? (p.priceDate || todayStr()) : cur[6], f.note]]);
  if (p.nextXD !== undefined || p.nextDividend !== undefined) {      // expected next dividend (you type it in)
    ensureHeaders(sh, 10, ["QuoteCurrency", "NextXD", "NextDividend"]);
    sh.getRange(row, 11).setNumberFormat("@");
    sh.getRange(row, 11, 1, 2).setValues([[p.nextXD || "", toFloat(p.nextDividend) || ""]]);
  }
  return jsonResponse({ ok: true });
}
function deleteHolding(p) {
  var row = resolveRow(SHEET.HOLDINGS, p);
  if (!row) return staleResponse();
  var id = String(getSheet(SHEET.HOLDINGS).getRange(row, 1).getValue());
  var tsh = getSheet(SHEET.HOLDING_TXNS);
  holdingTxnRows().filter(function(t){ return t.holdingId === id; }).reverse().forEach(function(t) {
    tsh.deleteRow(t.rowIndex);
  });
  getSheet(SHEET.HOLDINGS).deleteRow(row);
  return jsonResponse({ ok: true });
}
function addHoldingTxn(p) {
  var type = String(p.type || "");
  if (["buy", "sell", "dividend"].indexOf(type) < 0) return jsonResponse({ ok: false, error: "Unknown type" });
  if (p.id && idExists(SHEET.HOLDING_TXNS, p.id)) return jsonResponse({ ok: true, duplicate: true, id: p.id });
  var holdingId = String(p.holdingId || "");
  if (!holdingId) {                                   // first purchase creates the holding
    if (type !== "buy") return jsonResponse({ ok: false, error: "Choose what you are selling" });
    var hr = JSON.parse(addHolding(p.holding || {}).getContent());
    if (!hr.ok) return jsonResponse(hr);
    holdingId = hr.id;
  }
  var data = holdingsData(), h = null;
  data.holdings.forEach(function(x){ if (x.id === holdingId) h = x; });
  if (!h) return staleResponse();
  var qty = toFloat(p.quantity), price = toFloat(p.price), amount = round2(toFloat(p.amount) || qty * price), fee = round2(toFloat(p.fee));
  var date = p.date || todayStr(), account = String(p.account || "").trim();
  if (amount <= 0) return jsonResponse({ ok: false, error: "Enter an amount" });
  if (type !== "dividend" && qty <= 0) return jsonResponse({ ok: false, error: "Enter a quantity" });
  if (type === "sell" && qty > h.quantity + 1e-9) return jsonResponse({ ok: false, error: "You only hold " + h.quantity + (h.unit ? " " + h.unit : "") });
  // account may be empty for buy/sell = something you already owned (no cash moves)
  if (!account && (type === "dividend" || fee > 0)) return jsonResponse({ ok: false, error: "Choose an account" });
  var linked = "";                                  // LinkedId: kept for the layout, nothing is linked here
  var sh = getSheet(SHEET.HOLDING_TXNS), r = sh.getLastRow() + 1, id = p.id || newId("X");
  sh.getRange(r, 3).setNumberFormat("@");
  var tax = round2(toFloat(p.tax));
  sh.getRange(r, 1, 1, 11).setValues([[id, holdingId, date, type, type === "dividend" ? "" : qty, price || "",
    amount, type === "dividend" ? (tax || "") : (fee || ""), account, String(p.note || ""), linked]]);
  if (toFloat(p.origAmount) && p.currency && String(p.currency).toUpperCase() !== "THB") {
    ensureHeaders(sh, 12, ["OrigAmount", "Currency"]);
    sh.getRange(r, 12, 1, 2).setValues([[round2(toFloat(p.origAmount)), String(p.currency).toUpperCase()]]);
  }
  // latest trade price becomes the current price, unless a newer price was set by hand
  if (price && type !== "dividend" && (!h.priceDate || date >= h.priceDate)) {
    var hs = getSheet(SHEET.HOLDINGS), hrow = resolveRow(SHEET.HOLDINGS, { id: holdingId });
    hs.getRange(hrow, 7).setNumberFormat("@");
    hs.getRange(hrow, 6, 1, 2).setValues([[price, date]]);
  }
  return jsonResponse({ ok: true, id: id, holdingId: holdingId });
}
function deleteHoldingTxn(p) {
  var row = resolveRow(SHEET.HOLDING_TXNS, p);
  if (!row) return staleResponse();
  var sh = getSheet(SHEET.HOLDING_TXNS), d = sh.getRange(row, 1, 1, 11).getValues()[0];
  if (String(d[3]) === "buy") {             // can't remove a buy that later sells depend on
    var h = null; holdingsData().holdings.forEach(function(x){ if (x.id === String(d[1])) h = x; });
    if (h && h.quantity + 1e-9 < toFloat(d[4])) return jsonResponse({ ok: false, error: "Delete the later sale first — you'd be holding less than zero" });
  }
  sh.deleteRow(resolveRow(SHEET.HOLDING_TXNS, p));
  return jsonResponse({ ok: true });
}

// Value at cost of what you held on a date (from Money Tracker's src/19_net_worth.gs).
// Not used yet: kept for net worth and the estimated months later in Stage 4.
function holdingsAt(asOf) {
  var byId = {}, kinds = {};
  sheetToRows(getSheet(SHEET.HOLDINGS), function(d){ return { id: String(d[0]), kind: String(d[2] || "other") }; })
    .forEach(function(h){ kinds[h.id] = HOLDING_KINDS[h.kind] || "asset"; });
  holdingTxnRows().filter(function(t){ return t.date && t.date <= asOf; })
    .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); })
    .forEach(function(t) {
      var h = byId[t.holdingId] || (byId[t.holdingId] = { qty: 0, cost: 0 });
      if (t.type === "buy") { h.qty += t.quantity; h.cost += t.amount; }
      else if (t.type === "sell") { var out = h.qty > 0 ? h.cost / h.qty * t.quantity : 0; h.qty -= t.quantity; h.cost -= out; if (h.qty < 1e-9) { h.qty = 0; h.cost = 0; } }
    });
  var r = { investments: 0, assets: 0 };
  Object.keys(byId).forEach(function(id){ r[kinds[id] === "investment" ? "investments" : "assets"] += byId[id].cost; });
  return r;
}
