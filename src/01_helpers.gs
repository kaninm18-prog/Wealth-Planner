// ── Helpers ──────────────────────────────────────────────────
// Same helpers as Money Tracker, so code can be ported between the two apps unchanged.

var _ss = null, _sheetMemo = {};
function getSheet(name) {
  if (_sheetMemo[name]) return _sheetMemo[name];
  if (!_ss) _ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = _ss.getSheetByName(name);
  if (!sh) {
    sh = _ss.insertSheet(name);
    if (HEADERS[name]) {
      sh.appendRow(HEADERS[name]);
      sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight("bold");
    }
    if (HIDDEN_TABS[name]) sh.hideSheet();
  }
  _sheetMemo[name] = sh;
  return sh;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

var _fmtMemo = {};
function formatDate(val) {
  if (!val) return "";
  // Apps Script date objects from getValues() don't pass instanceof Date in V8 — check the type instead.
  if (typeof val === "object") {
    var k = val.getTime ? val.getTime() : String(val);
    return _fmtMemo[k] || (_fmtMemo[k] = Utilities.formatDate(val, "GMT+7", "yyyy-MM-dd"));
  }
  return String(val).slice(0, 10);
}

function todayStr() {
  return Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd");
}

function addMonths(dateStr, n) {
  if (!dateStr || dateStr.length < 10) return dateStr;
  var y = parseInt(dateStr.substring(0, 4));
  var m = parseInt(dateStr.substring(5, 7)) - 1; // 0-indexed
  var d = parseInt(dateStr.substring(8, 10));
  var dt = new Date(y, m + n, d);
  return Utilities.formatDate(dt, "GMT+7", "yyyy-MM-dd");
}

function toFloat(v) { return parseFloat(v) || 0; }
function round2(n)  { return Math.round(n * 100) / 100; }

// Write a header cell only if it is still empty (older sheets lack the newer columns)
function ensureHeaders(sh, startCol, names) {
  var cur = sh.getRange(1, startCol, 1, names.length).getValues()[0];
  var need = false;
  names.forEach(function(n, i){ if (!cur[i]) { cur[i] = n; need = true; } });
  if (need) sh.getRange(1, startCol, 1, names.length).setValues([cur]).setFontWeight("bold");
}

// ── Security: shared secret token ────────────────────────────
// Run setupToken() once from the Apps Script editor (Run ▶), copy the token from the
// Execution log, and paste it into the app (Settings → Access token).
function setupToken() {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty("API_TOKEN");
  if (!t) { t = Utilities.getUuid().replace(/-/g, ""); props.setProperty("API_TOKEN", t); }
  Logger.log("Your Wealth Planner access token: " + t);
  return t;
}
function tokenError(p) {
  var want = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
  if (!want) return "No access token set on the server yet. In Apps Script, run setupToken() once.";
  if (String(p.token || "") !== want) return "unauthorized";
  return "";
}

// ── Stable row IDs ───────────────────────────────────────────
// Edits and deletes find their row by Id, so a row that moved (because something was
// deleted on another device) is still the one that gets changed. ID_COL[tab] = Id column.
var ID_COL = {};
ID_COL[SHEET.HOLDINGS]     = 1;
ID_COL[SHEET.HOLDING_TXNS] = 1;
ID_COL[SHEET.TRADES]       = 1;
ID_COL[SHEET.BROKERS]      = 1;                 // Brokers are keyed by Name

function newId(prefix) { return prefix + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }

function idExists(name, id) {
  if (!id) return false;
  var sh = getSheet(name), col = ID_COL[name], last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) return true;
  return false;
}

// Find the sheet row for p.id (p.rowIndex is only a hint). 0 = not found.
function resolveRow(name, p) {
  var sh = getSheet(name), last = sh.getLastRow(), hint = parseInt(p.rowIndex) || 0;
  var col = ID_COL[name];
  if (!p.id || !col || last < 2) return 0;
  if (hint >= 2 && hint <= last && String(sh.getRange(hint, col).getValue()) === String(p.id)) return hint;
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(p.id)) return i + 2;
  return 0;
}

function staleResponse() {
  return jsonResponse({ ok: false, stale: true,
    error: "This item was changed or deleted on another device. The app has refreshed, please try again." });
}

// During startup every sheet is read once and shared by all getters
var _readCache = null;
function sheetValues(sh) {
  if (!_readCache) return sh.getDataRange().getValues();
  var k = sh.getName();
  if (!_readCache[k]) _readCache[k] = sh.getDataRange().getValues();
  return _readCache[k];
}

function sheetToRows(sh, mapper) {
  var data = sheetValues(sh);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] && !data[i][1]) continue;
    rows.push(mapper(data[i], i + 1));
  }
  return rows;
}
