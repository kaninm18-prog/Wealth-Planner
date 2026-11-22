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

function route(p) {
    switch (p.action) {
      case "bootstrap":              return bootstrap(p);
      default:
        return jsonResponse({ ok: false, error: "Unknown action: " + p.action });
    }
}

// One round-trip startup: returns everything the app needs on open.
function bootstrap(p) {
  return jsonResponse({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), today: todayStr() });
}
