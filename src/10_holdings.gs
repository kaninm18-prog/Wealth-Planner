// ── ASSETS & INVESTMENTS ─────────────────────────────────────
// Ported from Money Tracker's src/16_holdings.gs (Stage 4, step 3a).
// A holding is anything you own that isn't cash: gold, stocks, funds, property, a car...
// Buying/selling moves cash between a broker's cash and the holding; it is NOT spending or income.
// Unlike Money Tracker, fees and dividends are NOT copied into Expenses/Income (plan D2/D3):
// a fee stays in the HoldingTxns Fee column, a dividend stays a "dividend" row (tax withheld in Fee).
// Account is the broker's name; its cash and value are worked out in src/15_brokers.gs (step 3d).
// Cost basis uses the average-cost method.
var HOLDING_KINDS = { gold: "investment", stock: "investment", etf: "investment", fund: "investment",
  crypto: "investment", bond: "investment", property: "asset", vehicle: "asset", electronics: "asset", other: "asset" };

function holdingTxnRows() {
  return sheetToRows(getSheet(SHEET.HOLDING_TXNS), function(d, ri) {
    return { rowIndex: ri, id: String(d[0] || ""), holdingId: String(d[1] || ""), date: formatDate(d[2]),
      type: String(d[3] || ""), quantity: toFloat(d[4]), price: toFloat(d[5]), amount: toFloat(d[6]),
      fee: toFloat(d[7]), account: String(d[8] || "").trim(), note: String(d[9] || ""), linkedId: String(d[10] || ""),
      origAmount: toFloat(d[11]), currency: String(d[12] || "").toUpperCase(), feeOrig: toFloat(d[13]), taxOrig: toFloat(d[14]),
      lockUntil: formatDate(d[15]), switchId: String(d[16] || ""), switchValue: toFloat(d[17]) };
  });
}

// Tax funds (SSF, ThaiESG…): each buy can carry a LockUntil date. Which units are still locked is worked out
// lot by lot, with sells taken from the OLDEST units first (FIFO by date). That is an assumption to check with
// the fund house; cost and P/L still use the average-cost method, this only says what can be sold freely.
// A lot is locked while LockUntil > today; on the LockUntil date itself it is free.
// → { lots: [{ id, date, quantity, lockUntil, locked }] (what is left of each buy, oldest first),
//     lockedQty, freeQty, nextUnlock: { date, quantity } | null }
// RMF (retirement mutual fund): units can be sold without losing the tax benefit once you are 55 AND 5 years have
// passed since the first purchase of the fund. So each buy is locked until the later of the two dates. (A 29 Feb
// date lands on 1 Mar in a non-leap year: the later day, so it never says "free" a day early.)
function rmfUnlockDate(birthDate, firstBuyDate) {
  var age = addMonths(birthDate, 55 * 12), held = addMonths(firstBuyDate, 5 * 12);
  return age > held ? age : held;
}
function lockedLots(mine, today) {
  var lots = [];
  mine.forEach(function(t) {
    if (t.type === "buy") lots.push({ id: t.id, date: t.date, quantity: t.quantity, lockUntil: t.lockUntil || "" });
    else if (t.type === "sell") {
      var n = t.quantity;
      for (var i = 0; i < lots.length && n > 1e-9; i++) {
        var take = Math.min(lots[i].quantity, n);
        lots[i].quantity -= take; n -= take;
      }
    }
  });
  var locked = 0, total = 0, next = null;
  lots = lots.filter(function(l){ return l.quantity > 1e-9; }).map(function(l) {
    l.quantity = Math.round(l.quantity * 1e6) / 1e6;
    l.locked = !!l.lockUntil && l.lockUntil > today;
    total += l.quantity;
    if (l.locked) {
      locked += l.quantity;
      if (!next || l.lockUntil < next.date) next = { date: l.lockUntil, quantity: 0 };
    }
    return l;
  });
  if (next) lots.forEach(function(l){ if (l.locked && l.lockUntil === next.date) next.quantity += l.quantity; });
  if (next) next.quantity = Math.round(next.quantity * 1e6) / 1e6;
  locked = Math.round(locked * 1e6) / 1e6;
  return { lots: lots, lockedQty: locked, freeQty: Math.max(0, Math.round((total - locked) * 1e6) / 1e6), nextUnlock: next };
}

function holdingsData() {
  var txns = holdingTxnRows(), today = todayStr();
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
    var lk = lockedLots(mine, today);
    h.lockedQty = lk.lockedQty; h.freeQty = Math.min(lk.freeQty, h.quantity); h.nextUnlock = lk.nextUnlock;
    // the lots only matter (and are only sent) when some buy of this holding has a LockUntil date
    h.lots = mine.some(function(t){ return t.type === "buy" && t.lockUntil; }) ? lk.lots : [];
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
  var rmfRule = type === "buy" && String(p.lockRule || "") === "rmf";
  if (rmfRule && !birthDate()) return jsonResponse({ ok: false, error: "Add your birth date in Settings first (an RMF is locked until age 55)" });
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
  var lockUntil = type === "buy" ? String(p.lockUntil || "").trim() : "";
  if (rmfRule) {
    var birth = birthDate();
    var firstBuy = date;                              // the 5 years count from the first purchase of this fund
    (h.txns || []).forEach(function(t){ if (t.type === "buy" && t.date && t.date < firstBuy) firstBuy = t.date; });
    lockUntil = rmfUnlockDate(birth, firstBuy);
    if (lockUntil <= date) lockUntil = "";            // already 55 and held 5 years: nothing to lock
  }
  if (lockUntil && !/^\d{4}-\d{2}-\d{2}$/.test(lockUntil)) return jsonResponse({ ok: false, error: "Locked until should be a date (yyyy-MM-dd)" });
  if (lockUntil && lockUntil <= date) return jsonResponse({ ok: false, error: "Locked until should be after the purchase date" });
  // account may be empty for buy/sell = something you already owned (no cash moves)
  if (!account && (type === "dividend" || fee > 0)) return jsonResponse({ ok: false, error: "Choose an account" });
  var linked = "";                                  // LinkedId: kept for the layout, nothing is linked here
  // New dividends get a WD… Id: only those are exported to Money Tracker as Income (plan C8).
  // An Id sent with the entry (the app's retry id, or an old Id from an import file) is kept as it is.
  var sh = getSheet(SHEET.HOLDING_TXNS), r = sh.getLastRow() + 1, id = p.id || newId(type === "dividend" ? "WD" : "X");
  sh.getRange(r, 3).setNumberFormat("@");
  var tax = round2(toFloat(p.tax));
  sh.getRange(r, 1, 1, 11).setValues([[id, holdingId, date, type, type === "dividend" ? "" : qty, price || "",
    amount, type === "dividend" ? (tax || "") : (fee || ""), account, String(p.note || ""), linked]]);
  if (toFloat(p.origAmount) && p.currency && String(p.currency).toUpperCase() !== "THB") {
    ensureHeaders(sh, 12, ["OrigAmount", "Currency"]);
    sh.getRange(r, 12, 1, 2).setValues([[round2(toFloat(p.origAmount)), String(p.currency).toUpperCase()]]);
  }
  // The exact fee in the trade's currency (plan C3), same rule as Money Tracker's fee Expenses row.
  // Currency is written with it, so FeeOrig always says which currency it is in.
  var feeForeign = type !== "dividend" && fee > 0 && toFloat(p.feeOrig) && p.currency && String(p.currency).toUpperCase() !== "THB";
  if (feeForeign) {
    ensureHeaders(sh, 12, ["OrigAmount", "Currency", "FeeOrig"]);
    sh.getRange(r, 13, 1, 2).setValues([[String(p.currency).toUpperCase(), round2(toFloat(p.feeOrig))]]);
  }
  // The exact tax withheld on a foreign dividend (plan C6): same rule as FeeOrig, one column further on.
  var taxForeign = type === "dividend" && tax > 0 && toFloat(p.taxOrig) && p.currency && String(p.currency).toUpperCase() !== "THB";
  if (taxForeign) {
    ensureHeaders(sh, 12, ["OrigAmount", "Currency", "FeeOrig", "TaxOrig"]);
    sh.getRange(r, 13).setValue(String(p.currency).toUpperCase());
    sh.getRange(r, 15).setValue(round2(toFloat(p.taxOrig)));
  }
  // Locked until (tax funds), only on buys: the last column (after TaxOrig), added to older tabs when first used
  if (lockUntil) {
    ensureHeaders(sh, 12, ["OrigAmount", "Currency", "FeeOrig", "TaxOrig", "LockUntil"]);
    sh.getRange(r, 16).setNumberFormat("@");
    sh.getRange(r, 16).setValue(lockUntil);
  }
  // latest trade price becomes the current price, unless a newer price was set by hand
  if (price && type !== "dividend" && (!h.priceDate || date >= h.priceDate)) {
    var hs = getSheet(SHEET.HOLDINGS), hrow = resolveRow(SHEET.HOLDINGS, { id: holdingId });
    hs.getRange(hrow, 7).setNumberFormat("@");
    hs.getRange(hrow, 6, 1, 2).setValues([[price, date]]);
  }
  return jsonResponse({ ok: true, id: id, holdingId: holdingId, lockUntil: lockUntil });
}
function deleteHoldingTxn(p) {
  var row = resolveRow(SHEET.HOLDING_TXNS, p);
  if (!row) return staleResponse();
  var sw = String(getSheet(SHEET.HOLDING_TXNS).getRange(row, 17).getValue() || "");
  if (sw) return deleteSwitch(sw);                   // a switch goes as a whole: its sell and all its buys
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
