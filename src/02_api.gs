// ── Entry Point ───────────────────────────────────────────────

function doPost(e) {
  var lock = null;
  try {
    var p = JSON.parse(e.postData.contents);
    var authErr = tokenError(p);
    if (authErr) return jsonResponse({ ok: false, auth: true, error: authErr });
    // One request at a time, so the laptop and the phone never write over each other.
    lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) { lock = null; return jsonResponse({ ok: false, error: "Server busy, please try again" }); }
    return route(p);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  } finally {
    if (lock) { SpreadsheetApp.flush(); lock.releaseLock(); }
  }
}

// Opening the web-app URL in a browser is a GET. Answer that it's running, and nothing else:
// no token arrives with a GET, so it must never return data.
function doGet() {
  return jsonResponse({ ok: true, message: "Wealth Planner backend is running. Use this URL in the app's Settings." });
}

// Writes that change what Money Tracker reads: the export tabs are rebuilt after each of them (plan section 3).
var EXPORT_AFTER = { addHolding: 1, updateHolding: 1, deleteHolding: 1, addHoldingTxn: 1, deleteHoldingTxn: 1, refreshPrices: 1,
  addTrade: 1, deleteTrade: 1, importTrades: 1, importPack: 1, setBroker: 1, deleteBroker: 1 };

function route(p) {
  var res = dispatch(p);
  if (EXPORT_AFTER[p.action]) exportsSafe();      // a failed export never undoes the save; bootstrap reports it
  return res;
}

function dispatch(p) {
    switch (p.action) {
      case "bootstrap":              return bootstrap(p);
      case "getHoldings":            return jsonResponse(holdingsData());
      case "addHolding":             return addHolding(p);
      case "updateHolding":          return updateHolding(p);
      case "deleteHolding":          return deleteHolding(p);
      case "addHoldingTxn":          return addHoldingTxn(p);
      case "deleteHoldingTxn":       return deleteHoldingTxn(p);
      case "refreshPrices":          return jsonResponse(refreshPrices());
      case "setTargets":             return setTargets(p);
      case "setBenchmark":           return setBenchmark(p);
      case "getTrades":              return jsonResponse(getTrades());
      case "addTrade":               return addTrade(p);
      case "deleteTrade":            return deleteTrade(p);
      case "importTrades":           return importTrades(p);
      case "importPack":             return importPack(p);
      case "getBrokers":             return jsonResponse(getBrokers());
      case "setBroker":              return setBroker(p);
      case "deleteBroker":           return deleteBroker(p);
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + p.action });
    }
}

// One round-trip startup: returns everything the app needs on open.
function bootstrap(p) {
  _readCache = {};                                   // every tab is read once and shared by the getters
  try {
    var hld = holdingsData();
    var pf  = portfolioMeta();
    var tr  = getTrades().trades;
  } finally { _readCache = null; }
  var ex = exportsSafe();                          // also gives the broker cash ledger
  var brokers = ex.ok ? ex.ledger : { ok: false, error: ex.error };
  brokers.exported = ex.ok ? { values: ex.values, dividends: ex.dividends, asOf: ex.asOf } : null;
  var props = PropertiesService.getScriptProperties();
  return jsonResponse({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), today: todayStr(),
    holdings: hld, portfolio: pf, trades: tr, brokers: brokers,
    prices: { last: props.getProperty("LAST_PRICE_REFRESH") || "", daily: !!props.getProperty("PRICES_DAILY") } });
}
