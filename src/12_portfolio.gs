// ── PORTFOLIO: targets, benchmark ────────────────────────────
// Ported from Money Tracker's src/21_portfolio.gs (Stage 4, step 3a).
function portfolioMeta() {
  var targets = {};
  sheetToRows(getSheet(SHEET.TARGETS), function(d){ return [String(d[0]), toFloat(d[1])]; }).forEach(function(r){ if (r[0]) targets[r[0]] = r[1]; });
  var props = PropertiesService.getScriptProperties();
  var bench = null;
  try { bench = JSON.parse(props.getProperty("BENCH") || "null"); } catch (e) {}
  return { ok: true, targets: targets, benchmarkSymbol: props.getProperty("BENCH_SYMBOL") || "INDEXBKK:SET",
           benchmark: bench, birthDate: birthDate(), tradeCount: Math.max(0, getSheet(SHEET.TRADES).getLastRow() - 1) };
}
// Your birth date, only used to work out when an RMF can be sold (rmfUnlockDate). Kept in Script Properties
// (never in code or logs); the app holds it in memory while unlocked.
function birthDate() { return PropertiesService.getScriptProperties().getProperty("BIRTH_DATE") || ""; }
function setBirthDate(p) {
  var d = String(p.birthDate || "").trim(), props = PropertiesService.getScriptProperties();
  if (!d) { props.deleteProperty("BIRTH_DATE"); return jsonResponse({ ok: true, birthDate: "" }); }
  var real = /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T00:00:00Z").toISOString().substring(0, 10) === d;
  if (!real) return jsonResponse({ ok: false, error: "Birth date should be a real date (yyyy-MM-dd)" });
  if (d > todayStr() || d < "1900-01-01") return jsonResponse({ ok: false, error: "That birth date doesn't look right" });
  props.setProperty("BIRTH_DATE", d);
  return jsonResponse({ ok: true, birthDate: d });
}
function setTargets(p) {                           // p.targets = { "Gold": 20, "Thai stocks": 30, ... }
  var sh = getSheet(SHEET.TARGETS), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  var rows = Object.keys(p.targets || {}).filter(function(k){ return toFloat(p.targets[k]) > 0; })
    .map(function(k){ return [k, toFloat(p.targets[k])]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  return jsonResponse({ ok: true });
}
function setBenchmark(p) {
  var sym = String(p.symbol || "").trim().toUpperCase();
  if (!sym) return jsonResponse({ ok: false, error: "Symbol required" });
  PropertiesService.getScriptProperties().setProperty("BENCH_SYMBOL", sym);
  return jsonResponse({ ok: true, benchmark: fetchBenchmark() });
}
// Weekly closing prices of the comparison index since your first investment (max ~5 years),
// saved in Script Properties so the app can ask "what if the same money had gone into the index?"
function fetchBenchmark() {
  var props = PropertiesService.getScriptProperties();
  var sym = props.getProperty("BENCH_SYMBOL") || "INDEXBKK:SET";
  var first = "";
  holdingTxnRows().forEach(function(t){ if (t.date && (!first || t.date < first)) first = t.date; });
  if (!first) return { ok: false, error: "No investments yet" };
  var minStart = addMonths(todayStr(), -60);
  if (first < minStart) first = minStart;
  var start = addMonths(first, 0), y = parseInt(start.substring(0, 4)), m = parseInt(start.substring(5, 7)), d = parseInt(start.substring(8, 10));
  var sh = getSheet(SHEET.PRICES), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  sh.getRange(2, 1).setFormula('=IFERROR(GOOGLEFINANCE("' + sym.replace(/"/g, "") + '","close",DATE(' + y + "," + m + "," + (d > 7 ? d - 7 : 1) + '),TODAY(),"WEEKLY"),"")');
  var vals = [];
  for (var attempt = 0; attempt < 6; attempt++) {
    SpreadsheetApp.flush();
    var lr = Math.max(2, sh.getLastRow());
    vals = sh.getRange(2, 1, lr - 1, 2).getValues();
    if (!vals.some(function(r){ return /loading/i.test(String(r[0])); })) break;
    Utilities.sleep(1500);
  }
  var series = [];
  vals.forEach(function(r) {
    if (r[0] && typeof r[0] === "object" && typeof r[1] === "number" && r[1] > 0) series.push([formatDate(r[0]), Math.round(r[1] * 100) / 100]);
  });
  sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 3).clearContent();
  if (!series.length) return { ok: false, error: "No prices for " + sym };
  var out = { symbol: sym, series: series.slice(-300) };
  props.setProperty("BENCH", JSON.stringify(out));
  return { ok: true, symbol: sym, points: out.series.length };
}

