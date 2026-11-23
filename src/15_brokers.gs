// ── BROKERS, BROKER CASH AND THE EXPORTS FOR MONEY TRACKER ───
// Stage 4 step 3d. Money Tracker's docs/stage-4-plan.md: D2, D3, section 3 and contract details C1–C8.
// Each broker is a linked investment account in Money Tracker (its LinkedTo = the broker's Name here).
//  • Money Tracker writes every transfer into / out of a linked account to its tab _Export_LinkedFlows.
//    This file reads it (spreadsheet id in the Script Property MONEY_SHEET_ID) as the broker's deposits.
//  • Broker cash, in the broker's own currency =
//      opening cash + deposits − withdrawals − buys + sells − fees + dividends paid to the broker + closed trades' net.
//    Opening cash (Brokers tab) is what was already at the broker when it was set up here.
//    Buys and sells only move cash between the broker's cash and a holding: they are not spending or income.
//  • _Export_Values: each broker's cash + the market value of what is held there; plus one "Other assets"
//    row (C7) for entries with no broker (a car, a house…). Money Tracker shows it as the account balance.
//  • _Export_Dividends: every dividend with a WD… Id (C8). Money Tracker keeps one Income row per Id.
// Export tabs are rebuilt whole by writeExports(): on bootstrap, dailyRefresh and after every write.

var MONEY_TAB = { FLOWS: "_Export_LinkedFlows" };
var FLOWS_HEADER = ["Id", "Date", "Account", "Amount", "Currency"];
var FLOWS_CACHE = "MONEY_FLOWS_CACHE";            // Script Property: last good flows, summed per account and currency
var OTHER_ASSETS = "Other assets";                // _Export_Values row for entries with no broker (C7)
var EXPORT_DIVIDEND_ID = /^WD/;                   // only these dividends are exported (C8)

// Per request (reset like the other memos): undefined = not read yet
var _moneyFlows;

function numberCell(v) { return v !== "" && v !== null && v !== undefined && isFinite(parseFloat(v)); }

function brokerRows() {
  return sheetToRows(getSheet(SHEET.BROKERS), function(d, ri) {
    var cur = String(d[1] || "").trim().toUpperCase() || "THB";
    return { rowIndex: ri, name: String(d[0] || "").trim(), currency: cur, dividendsTo: String(d[2] || "").trim(),
      rate: cur === "THB" ? 1 : toFloat(d[3]), note: String(d[4] || ""), opening: toFloat(d[5]) };
  }).filter(function(b){ return b.name; });
}

// ── Brokers tab ──────────────────────────────────────────────
function getBrokers() { return brokerLedger(); }

// Add a broker, or change one (found by Name). The Name can't be changed here: entries refer to it.
function setBroker(p) {
  var name = String(p.name || "").trim();
  if (!name) return jsonResponse({ ok: false, error: "Name required" });
  if (name.toLowerCase() === OTHER_ASSETS.toLowerCase())
    return jsonResponse({ ok: false, error: "\"" + OTHER_ASSETS + "\" is kept for things with no broker. Choose another name." });
  var cur = String(p.currency || "THB").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return jsonResponse({ ok: false, error: "Currency should be a 3-letter code such as THB or USD" });
  var to = String(p.dividendsTo || "").trim();
  if (to === name) to = "";                       // "paid to itself" = paid into the broker's cash
  var sh = getSheet(SHEET.BROKERS), row = resolveRow(SHEET.BROKERS, { id: name, rowIndex: p.rowIndex });
  ensureHeaders(sh, 6, ["OpeningCash"]);              // tabs made before the column existed
  var old = row ? sh.getRange(row, 1, 1, 6).getValues()[0] : null;
  var oldCur = old ? (String(old[1] || "").trim().toUpperCase() || "THB") : "";
  // a typed rate wins; otherwise keep the saved one while the currency stays the same
  var rate = cur === "THB" ? 1 : (toFloat(p.rate) > 0 ? toFloat(p.rate) : (old && oldCur === cur ? toFloat(old[3]) : 0));
  // opening cash: kept when not sent (an older app), so saving never wipes it
  var opening = p.openingCash === undefined || p.openingCash === null ? (old ? toFloat(old[5]) : 0) : toFloat(p.openingCash);
  var vals = [name, cur, to, rate || "", String(p.note === undefined ? (old ? old[4] : "") : p.note), opening || ""];
  // Dividends already saved follow the new setting (Money Tracker moves their Income rows): say how many.
  var oldTo = old ? String(old[2] || "").trim() : "";
  var moved = to === oldTo ? 0 : holdingTxnRows().filter(function(t) {
    return t.type === "dividend" && t.account === name && EXPORT_DIVIDEND_ID.test(t.id);
  }).length;
  if (!row) row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 6).setNumberFormats([["@", "@", "@", "0.0000", "@", "0.00"]]);
  sh.getRange(row, 1, 1, 6).setValues([vals]);
  return jsonResponse({ ok: true, name: name, added: !old, dividendsMoved: moved, needsRate: cur !== "THB" && !rate });
}

function deleteBroker(p) {
  var name = String(p.name || p.id || "").trim();
  var row = resolveRow(SHEET.BROKERS, { id: name, rowIndex: p.rowIndex });
  if (!row) return staleResponse();
  var used = holdingTxnRows().filter(function(t){ return t.account === name; }).length +
             tradeRows().filter(function(t){ return t.account === name; }).length;
  if (used) return jsonResponse({ ok: false, error: used + " entr" + (used > 1 ? "ies use" : "y uses") + " this broker. Delete or move them first." });
  getSheet(SHEET.BROKERS).deleteRow(row);
  return jsonResponse({ ok: true });
}

// ── Reading Money Tracker's _Export_LinkedFlows ──────────────
// → { setUp, status, asOf, error, totals }
//   status "ok"      read just now; asOf = today
//   status "stale"   couldn't read it: the last good copy (cache) is used; asOf = the day it was read
//   status "unknown" couldn't read it and there is no cache: deposits are unknown, never taken as 0
//   totals = { <broker name>: { <currency>: [deposits, withdrawals] } }   (withdrawals ≤ 0)
// Rows belong to a broker by their Account (C1: a transfer between two linked accounts gives two rows with
// the same Id, one per Account). Rows are never merged by Id: each row is one movement of cash.
function readMoneyFlows() {
  if (_moneyFlows !== undefined) return _moneyFlows;
  var props = PropertiesService.getScriptProperties(), id = props.getProperty("MONEY_SHEET_ID");
  var rows = null, error = "";
  if (!id) error = "MONEY_SHEET_ID is not set";
  else {
    try {
      var sh = SpreadsheetApp.openById(id).getSheetByName(MONEY_TAB.FLOWS);
      if (!sh) error = "Money Tracker has no " + MONEY_TAB.FLOWS + " tab";
      else {
        var data = sh.getDataRange().getValues();
        var head = (data[0] || []).slice(0, FLOWS_HEADER.length).map(function(h){ return String(h).trim(); });
        if (head.join("|") !== FLOWS_HEADER.join("|")) error = MONEY_TAB.FLOWS + " has unexpected columns";
        else rows = data.slice(1);
      }
    } catch (e) { error = "Money Tracker's sheet could not be opened"; }   // no id or details in the message
  }
  var out;
  if (rows) {
    var totals = {};
    rows.forEach(function(d) {
      var acct = String(d[2] || "").trim();
      if (!acct || !numberCell(d[3])) return;
      var cur = String(d[4] || "").trim().toUpperCase() || "THB", amt = toFloat(d[3]);
      var t = totals[acct] || (totals[acct] = {}), s = t[cur] || (t[cur] = [0, 0]);
      s[amt >= 0 ? 0 : 1] += amt;
    });
    Object.keys(totals).forEach(function(a){ Object.keys(totals[a]).forEach(function(c) {
      totals[a][c] = [round2(totals[a][c][0]), round2(totals[a][c][1])];
    }); });
    out = { setUp: true, status: "ok", asOf: todayStr(), error: "", totals: totals };
    var keep = JSON.stringify({ asOf: out.asOf, totals: totals });
    if (props.getProperty(FLOWS_CACHE) !== keep) props.setProperty(FLOWS_CACHE, keep);
  } else {
    var cache = null;
    try { cache = JSON.parse(props.getProperty(FLOWS_CACHE) || "null"); } catch (e) { cache = null; }
    out = cache && cache.totals
      ? { setUp: !!id, status: "stale", asOf: String(cache.asOf || ""), error: error, totals: cache.totals }
      : { setUp: !!id, status: "unknown", asOf: "", error: error, totals: {} };
  }
  _moneyFlows = out;
  return out;
}

// THB per 1 unit of each currency: the last price refresh, then each broker's own Rate.
function fxRates(brokers) {
  var r = {};
  try { r = JSON.parse(PropertiesService.getScriptProperties().getProperty("FX_RATES") || "{}") || {}; } catch (e) { r = {}; }
  brokers.forEach(function(b){ if (b.currency !== "THB" && b.rate > 0) r[b.currency] = b.rate; });
  r.THB = 1;
  return r;
}

// ── The broker-cash ledger ───────────────────────────────────
// Every amount is turned into the broker's currency by the rule Money Tracker's accountBalances used for
// holding entries on a USD account: the exact OrigAmount (FeeOrig) when the entry is in the broker's
// currency, else the THB amount ÷ the broker's Rate. Anything that can't be converted makes the broker's
// value unknown (exported blank), never a wrong number.
function brokerLedger() {
  var flows = readMoneyFlows(), hd = holdingsData(), txns = holdingTxnRows(), trades = tradeRows();
  var saved = brokerRows(), rates = fxRates(saved), by = {}, list = [];
  var holdingById = {};
  hd.holdings.forEach(function(h){ holdingById[h.id] = h; });

  function broker(name) {
    if (by[name]) return by[name];
    var s = null;
    saved.forEach(function(b){ if (b.name === name) s = b; });
    var b = by[name] = { name: name, saved: !!s, rowIndex: s ? s.rowIndex : 0, currency: s ? s.currency : "THB",
      rate: s ? s.rate : 1, dividendsTo: s ? s.dividendsTo : "", note: s ? s.note : "",
      opening: s ? s.opening : 0, deposits: 0, withdrawals: 0, buys: 0, sells: 0, fees: 0, dividends: 0, dividendsElsewhere: 0, trades: 0,
      qty: {}, warnings: [], unknown: false };
    list.push(b);
    return b;
  }
  function warn(b, msg) { if (b.warnings.indexOf(msg) < 0) b.warnings.push(msg); }
  // an amount in currency `cur` → the broker's currency (null when no rate is known)
  function conv(b, amount, cur) {
    cur = cur || "THB";
    if (cur === b.currency) return amount;
    if (!(b.rate > 0) || !(rates[cur] > 0)) {
      b.unknown = true; warn(b, "No exchange rate for " + (b.rate > 0 ? cur : b.currency) + " yet — refresh prices or type the rate");
      return 0;
    }
    return amount * rates[cur] / b.rate;
  }
  // a HoldingTxns amount: exact foreign amount when it is in the broker's currency, else THB ÷ Rate
  function txnAmt(b, thb, orig, cur) {
    if (b.currency === "THB") return thb;
    if (orig && cur === b.currency) return orig;
    return conv(b, thb, "THB");
  }

  saved.forEach(function(s){ broker(s.name); });
  txns.forEach(function(t) {
    if (!t.account) return;
    var b = broker(t.account);
    if (t.type === "buy" || t.type === "sell") {
      var amt = txnAmt(b, t.amount, t.origAmount, t.currency);
      if (t.type === "buy") b.buys += amt; else b.sells += amt;
      if (t.fee) b.fees += txnAmt(b, t.fee, t.feeOrig, t.currency);
    } else if (t.type === "dividend") {
      // the amount received (after tax): the tax withheld was never paid out, so it is not taken off again
      var d = txnAmt(b, t.amount, t.origAmount, t.currency);
      if (b.dividendsTo) b.dividendsElsewhere += d; else b.dividends += d;
    }
  });
  trades.forEach(function(t) {
    if (!t.account || !t.closeTime) return;
    var b = broker(t.account);
    b.trades += conv(b, t.net, String(t.currency || "USD").toUpperCase());
  });
  Object.keys(flows.totals).forEach(function(name) {
    var b = broker(name);
    Object.keys(flows.totals[name]).forEach(function(cur) {
      if (cur !== b.currency) warn(b, "Money Tracker keeps this account in " + cur + ", here it is " + b.currency);
      b.deposits += conv(b, flows.totals[name][cur][0], cur);
      b.withdrawals += conv(b, flows.totals[name][cur][1], cur);
    });
  });
  // Quantity of each holding at each broker ("" = no broker), entry by entry in date order. No slice ever
  // goes below 0. Agreed rules for entries with no broker (a gold bar taken out of MTS Gold, no cash moves):
  //  • a no-broker sell of a holding held at exactly one broker comes out of that broker's position;
  //  • a no-broker buy of a holding held at exactly one broker goes into that broker's position;
  //  • held at more than one broker: it stays in the no-broker slice, and those brokers get a warning.
  // A sell bigger than its slice takes the rest from the no-broker slice, then from the other brokers
  // in proportion to what they hold, with a warning (so no slice is negative and the totals still add up).
  var qtyAt = {}, MOVED = "Moved without a broker — check where it is held";
  function heldAt(q) { return Object.keys(q).filter(function(k){ return k && q[k] > 1e-9; }); }
  function take(q, k, n) {                              // take n out of slice k; returns the slices that gave
    var got = Math.min(n, Math.max(q[k] || 0, 0)), from = [];
    if (got > 0) { q[k] -= got; n -= got; }
    if (n > 1e-9 && k !== "" && (q[""] || 0) > 1e-9) { var o = Math.min(n, q[""]); q[""] -= o; n -= o; from.push(""); }
    var others = heldAt(q).filter(function(x){ return x !== k; }), tot = 0;
    others.forEach(function(x){ tot += q[x]; });
    if (n > 1e-9 && tot > 1e-9) {
      var part = Math.min(n, tot);
      others.forEach(function(x){ q[x] -= part * q[x] / tot; from.push(x); });
      n -= part;
    }
    if (n > 1e-9) q[k] = (q[k] || 0) - n;               // only with bad data: sold more than was ever held
    return from;
  }
  txns.filter(function(t){ return t.type === "buy" || t.type === "sell"; })
    .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); })
    .forEach(function(t) {
      var q = qtyAt[t.holdingId] || (qtyAt[t.holdingId] = {}), k = t.account || "";
      if (k) broker(k);
      if (!k) {
        var at = heldAt(q);
        if (at.length === 1) k = at[0];                // moved into / out of that broker, no cash
        else if (at.length > 1) at.forEach(function(x){ warn(broker(x), MOVED); });
      }
      if (t.type === "buy") { q[k] = (q[k] || 0) + t.quantity; return; }
      var from = take(q, k, t.quantity);
      if (from.length && t.account) warn(broker(t.account), "More sold here than bought here — the rest was taken from " +
        from.map(function(x){ return x || OTHER_ASSETS; }).join(", "));
      from.forEach(function(x){ if (x && x !== t.account) warn(broker(x), MOVED); });
    });
  // Market value of a slice of a holding: its share of the holding's value (qty × price, or cost when unpriced)
  function positions(key) {
    var out = [], thb = 0;
    Object.keys(qtyAt).forEach(function(hid) {
      var q = qtyAt[hid][key], h = holdingById[hid];
      if (!h || Math.abs(q || 0) < 1e-9) return;
      var unit = h.quantity ? h.value / h.quantity : (h.currentPrice || 0), v = unit * q;
      thb += v;
      out.push({ id: h.id, name: h.name, kind: h.kind, quantity: Math.round(q * 1e6) / 1e6, valueThb: round2(v) });
    });
    out.sort(function(a, b){ return b.valueThb - a.valueThb; });
    return { list: out, thb: thb };
  }

  var check = { holdingsThb: hd.totals.value, cashThb: 0, rowsThb: 0 };
  if (flows.status === "unknown") list.forEach(function(b){ b.unknown = true; });
  list.sort(function(a, b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
  var brokers = list.map(function(b) {
    var pos = positions(b.name);
    if (b.currency !== "THB" && !(b.rate > 0)) { b.unknown = true; warn(b, "No exchange rate for " + b.currency + " yet — refresh prices or type the rate"); }
    var R = b.rate > 0 ? b.rate : 0;
    var cash = b.opening + b.deposits + b.withdrawals - b.buys + b.sells - b.fees + b.dividends + b.trades;
    var held = R ? pos.thb / R : 0, value = cash + held;
    check.cashThb += cash * R; check.rowsThb += value * R;
    return { name: b.name, saved: b.saved, rowIndex: b.rowIndex, currency: b.currency, rate: b.rate, dividendsTo: b.dividendsTo, note: b.note,
      opening: round2(b.opening), deposits: round2(b.deposits), withdrawals: round2(b.withdrawals), buys: round2(b.buys), sells: round2(b.sells), fees: round2(b.fees),
      dividends: round2(b.dividends), dividendsElsewhere: round2(b.dividendsElsewhere), trades: round2(b.trades),
      cash: round2(cash), cashThb: round2(cash * R), holdings: round2(held), holdingsThb: round2(pos.thb),
      value: round2(value), valueThb: round2(value * R), unknown: b.unknown, warnings: b.warnings, positions: pos.list };
  });
  var oth = positions("");
  check.rowsThb += oth.thb;
  var other = { name: OTHER_ASSETS, currency: "THB", value: round2(oth.thb), valueThb: round2(oth.thb), positions: oth.list };
  // Every holding's value must land in exactly one row: rows = holdings + all broker cash
  check.diff = round2(check.rowsThb - check.holdingsThb - check.cashThb);
  Object.keys(check).forEach(function(k){ check[k] = round2(check[k]); });
  return { ok: true, brokers: brokers, other: other, check: check,
    flows: { setUp: flows.setUp, status: flows.status, asOf: flows.asOf, error: flows.error } };
}

// ── Export tabs ──────────────────────────────────────────────
function writeTab(name, rows, textCols) {
  var sh = getSheet(name);
  sh.clearContents();
  (textCols || []).forEach(function(c){ sh.getRange(1, c, rows.length, 1).setNumberFormat("@"); });   // dates stay plain text
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
}

// Rebuild _Export_Values and _Export_Dividends. Returns the ledger, so bootstrap can send it to the app.
function writeExports() {
  var L = brokerLedger(), today = todayStr();
  // Cash built from an old copy of the flows is "as of" that copy: Money Tracker then adds the transfers
  // made since (C4), instead of missing them.
  var brokerAsOf = L.flows.status === "stale" && L.flows.asOf ? L.flows.asOf : today;
  var values = [HEADERS[SHEET.EXPORT_VALUES]];
  L.brokers.forEach(function(b) {
    values.push([b.name, b.currency, b.unknown ? "" : b.value, b.unknown ? "" : b.valueThb, brokerAsOf]);   // blank = unknown, not 0
  });
  values.push([OTHER_ASSETS, "THB", L.other.value, L.other.valueThb, today]);
  writeTab(SHEET.EXPORT_VALUES, values, [5]);

  var names = {}, paidTo = {};
  holdingsData().holdings.forEach(function(h){ names[h.id] = h.name; });
  L.brokers.forEach(function(b){ paidTo[b.name] = b.dividendsTo || b.name; });   // C2
  var divs = [HEADERS[SHEET.EXPORT_DIVIDENDS]];
  holdingTxnRows().filter(function(t){ return t.type === "dividend" && EXPORT_DIVIDEND_ID.test(t.id); })
    .sort(function(a, b){ return a.date === b.date ? a.rowIndex - b.rowIndex : a.date.localeCompare(b.date); })
    .forEach(function(t) {
      var foreign = t.currency && t.currency !== "THB" && t.origAmount;
      divs.push([t.id, t.date, names[t.holdingId] || "", round2(t.amount), foreign ? round2(t.origAmount) : "",
        foreign ? t.currency : "THB", round2(t.fee), paidTo[t.account] || t.account]);
    });
  writeTab(SHEET.EXPORT_DIVIDENDS, divs, [1, 2]);
  return { ok: true, values: values.length - 1, dividends: divs.length - 1, asOf: brokerAsOf, ledger: L };
}

// The same, for callers that must not fail because of it (a save has already been made)
function exportsSafe() {
  try { return writeExports(); } catch (e) { return { ok: false, error: e.message }; }
}
