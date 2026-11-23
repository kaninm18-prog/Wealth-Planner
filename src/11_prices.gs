// ── AUTOMATIC PRICES ─────────────────────────────────────────
// Ported from Money Tracker's src/18_prices.gs (Stage 4, step 3a), holding prices only:
// this app has no accounts, so Money Tracker keeps refreshing its own account exchange rates.
// It also refreshes the Rate of every non-THB broker (step 3d), which values that broker's cash.
// Uses Google Sheets' GOOGLEFINANCE in a hidden "_Prices" sheet.
//  • Holdings with a Symbol get today's price: "PTT.BK" or "BKK:PTT" (Thai stocks), "NASDAQ:AAPL",
//    "CURRENCY:BTCTHB"… Prices in other currencies are converted to baht at today's rate.
//  • Gold (kind gold, unit oz / baht-weight / gram, or symbol XAUUSD, GOLD:BAHT, GOLD:GRAM) follows spot gold.
// Thai mutual funds are not in GOOGLEFINANCE — update those by hand.
// Gold has no stock symbol: it is priced from spot gold (XAU/USD, per troy ounce).
// Thai 96.5% gold: 1 baht-weight = 15.244 g × 96.5% = 0.47295 oz of pure gold (an estimate — shops add a spread).
var GOLD_UNITS = { OZ: 1, BAHT: 0.47295, GRAM: 1 / 31.1035 };
function goldUnit(sym, unit, kind) {
  var s = String(sym || "").trim().toUpperCase();
  if (s === "XAUUSD" || s === "GOLD" || s === "GOLD:OZ" || s === "CURRENCY:XAUUSD") return "OZ";
  if (s === "GOLD:BAHT") return "BAHT";
  if (s === "GOLD:GRAM") return "GRAM";
  if (s || kind !== "gold") return "";
  var u = String(unit || "").toLowerCase();
  if (/baht/.test(u)) return "BAHT";
  if (/^(oz|ounce|ounces|troy)/.test(u)) return "OZ";
  if (/^(g|gram|grams)$/.test(u)) return "GRAM";
  return "";
}
// What to ask GOOGLEFINANCE for a holding: { q, factor, cur } (cur = known quote currency) or null
function priceSource(h) {
  var g = goldUnit(h.symbol, h.unit, h.kind);
  if (g) return { q: "CURRENCY:XAUUSD", factor: GOLD_UNITS[g], cur: "USD" };
  var q = quoteSymbol(h.symbol);
  if (!q) return null;
  var m = q.match(/^CURRENCY:[A-Z]{3}([A-Z]{3})$/);
  return { q: q, factor: 1, cur: m ? m[1] : "" };
}
function quoteSymbol(sym) {
  var s = String(sym || "").trim().toUpperCase();
  if (!s) return "";
  if (s.indexOf(":") > 0) return s;
  var m = s.match(/^([A-Z0-9&\-]+)\.BK$/);
  if (m) return "BKK:" + m[1];
  return /^[A-Z0-9.\-]{1,12}$/.test(s) ? s : "";
}
function evalFormulas(formulas) {                 // [[f1, f2...], ...] -> values (waits for "Loading...")
  var sh = getSheet(SHEET.PRICES);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (!formulas.length) return [];
  var rng = sh.getRange(2, 1, formulas.length, formulas[0].length);
  rng.setFormulas(formulas);
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    vals = rng.getValues();
    var loading = vals.some(function(r){ return r.some(function(v){ return /loading/i.test(String(v)); }); });
    if (!loading) break;
    Utilities.sleep(1500);
  }
  return vals;
}
function goodNumber(v) { return typeof v === "number" && isFinite(v) && v > 0; }

function refreshPrices() {
  var today = todayStr(), result = { ok: true, updated: [], failed: [], rates: {} };
  var hs = getSheet(SHEET.HOLDINGS);
  var data = holdingsData().holdings.filter(function(h){ return h.autoPrice && h.quantity > 0; });
  // 1) prices + their currency
  var srcs = data.map(priceSource);
  var px = evalFormulas(data.map(function(h, i) {
    var q = srcs[i].q.replace(/"/g, "");
    return ['="' + q + '"', '=IFERROR(GOOGLEFINANCE("' + q + '","price"),"")', '=IFERROR(GOOGLEFINANCE("' + q + '","currency"),"")'];
  }));
  px.forEach(function(r, i) {                     // apply gold unit factor; known quote currency wins
    if (goodNumber(r[1])) r[1] = r[1] * srcs[i].factor;
    if (srcs[i].cur) r[2] = srcs[i].cur;
  });
  // 2) exchange rates for every non-THB quote currency and broker currency
  var curs = {}, brokers = brokerRows();
  px.forEach(function(r){ var c = String(r[2] || "").toUpperCase(); if (c && c !== "THB") curs[c] = true; });
  brokers.forEach(function(b){ if (b.currency !== "THB") curs[b.currency] = true; });
  var curList = Object.keys(curs);
  var fx = evalFormulas(curList.map(function(c) {
    return ['="' + c + '"', '=IFERROR(GOOGLEFINANCE("CURRENCY:' + c + 'THB"),"")', '=""'];
  }));
  curList.forEach(function(c, i){ if (goodNumber(fx[i][1])) result.rates[c] = fx[i][1]; });
  // broker Rates (a currency that wasn't found keeps its last rate) and the rates for the cash ledger
  var bs = getSheet(SHEET.BROKERS);
  brokers.forEach(function(b) {
    var r = result.rates[b.currency];
    if (b.currency === "THB" || !r) return;
    bs.getRange(b.rowIndex, 4).setValue(Math.round(r * 10000) / 10000);
  });
  if (curList.length) {
    var props = PropertiesService.getScriptProperties(), saved = {};
    try { saved = JSON.parse(props.getProperty("FX_RATES") || "{}") || {}; } catch (e) { saved = {}; }
    props.setProperty("FX_RATES", JSON.stringify(Object.assign(saved, result.rates)));
  }
  // 3) write holding prices (in baht)
  data.forEach(function(h, i) {
    var price = px[i] ? px[i][1] : "", cur = String(px[i] ? px[i][2] : "").toUpperCase() || "THB";
    if (goodNumber(price) && cur === "GBX") { price = price / 100; cur = "GBP"; }   // London quotes in pence
    var thb = goodNumber(price) ? (cur === "THB" ? price : (result.rates[cur] ? price * result.rates[cur] : 0)) : 0;
    if (!thb) { result.failed.push(h.name + (h.symbol ? " (" + h.symbol + ")" : "")); return; }
    var row = resolveRow(SHEET.HOLDINGS, { id: h.id });
    if (!row) return;
    hs.getRange(row, 7).setNumberFormat("@");
    hs.getRange(row, 6, 1, 2).setValues([[Math.round(thb * 10000) / 10000, today]]);
    ensureHeaders(hs, 10, ["QuoteCurrency", "NextXD", "NextDividend"]);
    hs.getRange(row, 10).setValue(cur);
    result.updated.push(h.name);
  });
  try { result.benchmark = fetchBenchmark(); } catch (e) { result.benchmark = { ok: false, error: e.message }; }
  PropertiesService.getScriptProperties().setProperty("LAST_PRICE_REFRESH", new Date().toISOString());
  return result;
}

// Daily job (set up by setupAutomation): refresh prices, then rebuild the exports for Money Tracker
// (even if the prices failed: the deposits may have changed). No backup or net-worth snapshot here yet.
function dailyRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) return;
  try {
    try { refreshPrices(); } finally { exportsSafe(); }
  } finally { lock.releaseLock(); }
}

// One-time setup from the Apps Script editor: daily prices (~7am)
function setupAutomation() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "dailyRefresh") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyRefresh").timeBased().everyDays(1).atHour(7).create();
  PropertiesService.getScriptProperties().setProperty("PRICES_DAILY", "7am");
  var r = refreshPrices();
  Logger.log("Automation is on: daily prices (7am).");
  Logger.log("Prices updated: " + (r.updated.join(", ") || "none") + (r.failed.length ? " | not found: " + r.failed.join(", ") : ""));
}
