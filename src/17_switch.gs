// ── FUND SWITCH (e.g. SSF → SSF, ThaiESG → ThaiESG) ───────────
// One action that moves units of one fund into another at the same broker. It is saved as a sell of the
// from-fund and one or more buys of the to-fund on the same date, all with the same SwitchId (HoldingTxns col 17).
// Cost (Arm's choice, for switches only — a normal sell still realises profit or loss):
//  • the ORIGINAL cost is carried over: cost out = the from-fund's average cost × units switched out;
//  • the sell row's Amount = the buy rows' Amount = that cost, so the from-fund books no realised P/L, its average
//    cost stays the same, and the to-fund's cost is the carried cost (not the market value);
//  • broker cash is unchanged (+cost −cost). A fee is a normal fee on the (first) buy row: the only cash effect.
//  • What the fund house said the switch was worth is kept in SwitchValue (col 18), for information only.
// Lock dates (tax funds): the units switched out are taken oldest first (the FIFO of lockedLots, src/10_holdings.gs).
// The new units inherit those LockUntil dates in proportion: one buy row per lock date. Units whose lock had already
// ended by the switch date (or never had one) give free new units.
// OrigAmount is never written on switch rows: Amount/OrigAmount would look like an exchange rate (suggestRate).
var SWITCH_COLS = ["OrigAmount", "Currency", "FeeOrig", "TaxOrig", "LockUntil", "SwitchId", "SwitchValue"];

function round6(n) { return Math.round(n * 1e6) / 1e6; }

function addSwitch(p) {
  var swId = String(p.id || "").trim();
  if (swId && holdingTxnRows().some(function(t){ return t.switchId === swId; }))
    return jsonResponse({ ok: true, duplicate: true, id: swId });        // a retried save
  var date = p.date || todayStr(), account = String(p.account || "").trim();
  var out = toFloat(p.unitsOut), inn = toFloat(p.unitsIn), fee = round2(toFloat(p.fee)), value = round2(toFloat(p.value));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ ok: false, error: "Enter the date" });
  if (!(out > 0)) return jsonResponse({ ok: false, error: "Enter the units switched out" });
  if (!(inn > 0)) return jsonResponse({ ok: false, error: "Enter the units received" });
  if (fee > 0 && !account) return jsonResponse({ ok: false, error: "Choose an account" });
  var data = holdingsData(), from = null, to = null;
  data.holdings.forEach(function(h){ if (h.id === p.fromId) from = h; if (p.toId && h.id === p.toId) to = h; });
  if (!from || (p.toId && !to)) return staleResponse();
  if (from.group !== "investment") return jsonResponse({ ok: false, error: "Only investments can be switched" });
  if (out > from.quantity + 1e-9) return jsonResponse({ ok: false, error: "You only hold " + from.quantity + (from.unit ? " " + from.unit : "") });
  if (to && to.id === from.id) return jsonResponse({ ok: false, error: "Choose another fund to switch into" });
  if (!to) {                                       // switching into a new fund creates it
    var hr = JSON.parse(addHolding(Object.assign({ kind: from.kind, unit: from.unit }, p.toHolding || {}, { currentPrice: "" })).getContent());
    if (!hr.ok) return jsonResponse(hr);
    to = { id: hr.id, priceDate: "" };
  }
  // cost carried over (average cost of what is switched out; all of it when everything goes)
  var all = Math.abs(out - from.quantity) < 1e-9;
  var cost = all ? from.cost : round6(from.cost / from.quantity * out);
  // which units go: oldest first, grouped by the lock date they still have on the switch date
  var lots = lockedLots(from.txns.slice().reverse().filter(function(t){ return t.date <= date; }), date).lots, left = out, byLock = {}, order = [];
  lots.forEach(function(l) {
    if (left <= 1e-9) return;
    var q = Math.min(l.quantity, left), k = l.lockUntil && l.lockUntil > date ? l.lockUntil : "";
    left -= q;
    if (!(k in byLock)) { byLock[k] = 0; order.push(k); }
    byLock[k] += q;
  });
  if (!order.length) { order.push(""); byLock[""] = out; }
  // one buy row per lock date: units and cost shared in proportion; the last row takes the rounding rest
  var buys = [], unitsLeft = inn, costLeft = cost;
  order.forEach(function(k, i) {
    var last = i === order.length - 1, share = byLock[k] / out;
    var u = last ? round6(unitsLeft) : round6(inn * share), c = last ? round6(costLeft) : round6(cost * share);
    unitsLeft -= u; costLeft -= c;
    buys.push({ lockUntil: k, units: u, cost: c });
  });
  if (!swId) swId = newId("SW");
  var note = String(p.note || "").trim();
  var sh = getSheet(SHEET.HOLDING_TXNS);
  ensureHeaders(sh, 12, SWITCH_COLS);
  var rows = [[newId("X"), from.id, date, "sell", out, round6(cost / out), cost, "", account, note, "", "", "", "", "", "", swId, value || ""]];
  buys.forEach(function(b, i) {
    var f = i === 0 ? fee : 0;
    rows.push([newId("X"), to.id, date, "buy", b.units, round6(b.cost / b.units), b.cost, f || "", account, note, "", "", "", "", "",
      b.lockUntil, swId, value || ""]);
  });
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, rows.length, 18).setNumberFormats(rows.map(function(){ return ["@","@","@","@","0.######","0.######","0.00","0.00","@","@","@","0.00","@","0.00","0.00","@","@","0.00"]; }));
  sh.getRange(r, 1, rows.length, 18).setValues(rows);
  // The market value is real price information (not cost): it updates each fund's price, like a trade would,
  // unless a newer price was set already.
  if (value > 0) {
    var hs = getSheet(SHEET.HOLDINGS);
    [[from, value / out], [to, value / inn]].forEach(function(x) {
      if (x[0].priceDate && date < x[0].priceDate) return;
      var hrow = resolveRow(SHEET.HOLDINGS, { id: x[0].id });
      if (!hrow) return;
      hs.getRange(hrow, 7).setNumberFormat("@");
      hs.getRange(hrow, 6, 1, 2).setValues([[Math.round(x[1] * 10000) / 10000, date]]);
    });
  }
  return jsonResponse({ ok: true, id: swId, fromId: from.id, toId: to.id, cost: round2(cost), buys: buys.length });
}

// Delete every row of a switch. Refused when later sales of the new units depend on it (like deleting a buy).
function deleteSwitch(swId) {
  var mine = holdingTxnRows().filter(function(t){ return t.switchId === swId; });
  if (!mine.length) return staleResponse();
  var bought = {};
  mine.forEach(function(t){ if (t.type === "buy") bought[t.holdingId] = (bought[t.holdingId] || 0) + t.quantity; });
  var held = {};
  holdingsData().holdings.forEach(function(h){ held[h.id] = h.quantity; });
  for (var id in bought) {
    if ((held[id] || 0) + 1e-9 < bought[id]) return jsonResponse({ ok: false, error: "Delete the later sale of the new fund first — you'd be holding less than zero" });
  }
  var sh = getSheet(SHEET.HOLDING_TXNS);
  mine.map(function(t){ return t.rowIndex; }).sort(function(a, b){ return b - a; }).forEach(function(r){ sh.deleteRow(r); });
  return jsonResponse({ ok: true, deleted: mine.length });
}
