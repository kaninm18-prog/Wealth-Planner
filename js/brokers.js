// Wealth Planner — brokers: each broker's cash and value, its currency and rate, where its dividends are paid.
// Stage 4 step 3d (Money Tracker's docs/stage-4-plan.md, D2/D3 and C1–C8). The numbers come from the backend
// (src/15_brokers.gs); this file only shows them and edits the Brokers tab.
// A broker here is a linked investment account in Money Tracker: deposits come from there, and its value goes back.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

var brokerData = null;              // getBrokers / bootstrap.brokers: { brokers, other, flows, check }
function fmtSigned(v, cur) { return (v < -0.004 ? '−' : '') + fmtCur(Math.abs(v), cur); }
function setBrokers(d) { brokerData = d && d.ok ? d : null; }
function brokerByName(name) {
  if (!brokerData) return null;
  for (var i = 0; i < brokerData.brokers.length; i++) if (brokerData.brokers[i].name === name) return brokerData.brokers[i];
  return null;
}
// Broker cash is only counted in the total when Money Tracker's deposits are known
function brokerCashKnown() { return !!(brokerData && brokerData.flows && brokerData.flows.status !== 'unknown'); }
function brokerCashThb() {
  if (!brokerCashKnown()) return 0;
  return brokerData.brokers.reduce(function(a, b){ return a + (b.unknown ? 0 : b.cashThb); }, 0);
}

// One line about Money Tracker's deposits, or '' when they were read just now
function flowsHint() {
  var f = brokerData && brokerData.flows;
  if (!f || f.status === 'ok') return '';
  if (!f.setUp) return 'Deposits from Money Tracker are not connected yet: add the Script Property MONEY_SHEET_ID in the Apps Script project. Until then broker cash leaves out deposits, and broker values are not sent to Money Tracker.';
  if (f.status === 'stale') return 'Money Tracker could not be read just now — deposits as of ' + fmtDateY(f.asOf) + '.';
  return 'Money Tracker could not be read and no earlier copy is saved: deposits are unknown, so broker values are not sent to Money Tracker.';
}

function renderBrokers() {
  var el = document.getElementById('brokers-section');
  if (!el || !loaded) return;
  if (!brokerData) { el.innerHTML = ''; return; }
  var list = brokerData.brokers || [], hint = flowsHint(), html = '<div class="acc-page-section-header">🏦 Brokers</div>';
  if (hint) html += '<div class="fx-hint broker-hint" id="broker-hint">' + recEsc(hint) + '</div>';
  if (!list.length) html += '<div class="hold-sub" style="padding:4px 2px 10px">Add each broker (or gold shop) you buy through. In Money Tracker it is a linked investment account with the same name.</div>';
  list.forEach(function(b) {
    var cur = b.currency, warn = b.unknown || (b.warnings && b.warnings.length);
    var sub = 'Cash ' + (b.unknown && !brokerCashKnown() ? '—' : fmtSigned(b.cash, cur)) + ' · Holdings ' + fmtCur(b.holdings, cur) +
      ' · Dividends → ' + recEsc(b.dividendsTo || 'broker');
    html += '<div class="hold-card" onclick="openBroker(\'' + escQ(b.name) + '\')">' +
      '<div class="hold-icon">🏦</div>' +
      '<div style="min-width:0"><div class="hold-name">' + recEsc(b.name) + ' <span class="pending-badge">' + recEsc(cur) + '</span>' +
        (b.saved ? '' : ' <span class="pending-badge">not set up</span>') + '</div>' +
      '<div class="hold-sub">' + sub + (cur !== 'THB' ? ' · 1 ' + recEsc(cur) + ' = ' + (b.rate ? fmtMoney(b.rate) : '?') : '') + '</div>' +
      (warn ? '<div class="hold-sub broker-warn">⚠ ' + recEsc(b.unknown ? 'Value unknown — ' + ((b.warnings || [])[0] || 'deposits not known yet') : b.warnings[0]) + '</div>' : '') + '</div>' +
      '<div><div class="hold-val">' + (b.unknown ? '—' : fmtSigned(b.value, cur)) + '</div>' +
      (cur !== 'THB' && !b.unknown ? '<div class="hold-pl">≈ ' + fmtMoney(b.valueThb) + '</div>' : '') + '</div></div>';
  });
  var o = brokerData.other;
  if (o && o.positions && o.positions.length)
    html += '<div class="hold-total"><span>Other assets (no broker)</span><span><b>' + fmtMoney(o.value) + '</b></span></div>';
  html += '<button class="btn btn-ghost hold-add" onclick="openBroker()">+ Add broker</button>';
  el.innerHTML = html;
}

// ── detail + edit ──
var editBrokerName = null;
function openBroker(name) {
  var b = name ? brokerByName(name) : null;
  editBrokerName = b && b.saved ? b.name : null;
  document.getElementById('bk-title').textContent = b ? '🏦 ' + b.name : 'Add broker';
  var nm = document.getElementById('bk-name');
  nm.value = b ? b.name : ''; nm.disabled = !!b;      // entries refer to the name, so it can't be changed here
  var cur = b ? b.currency : 'THB', sel = document.getElementById('bk-currency');
  sel.innerHTML = TRADE_CURS.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
  if (TRADE_CURS.indexOf(cur) < 0) sel.innerHTML += '<option value="' + escAttr(cur) + '">' + recEsc(cur) + '</option>';
  sel.value = cur;
  document.getElementById('bk-rate').value = b && cur !== 'THB' && b.rate ? b.rate : (cur !== 'THB' ? suggestRate(cur) : '');
  document.getElementById('bk-divto').value = b ? b.dividendsTo : '';
  document.getElementById('bk-note').value = b ? b.note : '';
  document.getElementById('bk-opening').value = b && b.opening ? b.opening : '';
  document.getElementById('bk-body').innerHTML = b ? brokerDetailHtml(b) : '';
  document.getElementById('bk-delete').style.display = b && b.saved ? '' : 'none';
  document.getElementById('bk-save').textContent = b && !b.saved ? 'Save broker settings' : 'Save';
  brokerFormUpdate();
  openModal('broker-modal');
}
function brokerDetailHtml(b) {
  var c = b.currency, f = function(v){ return fmtCur(v, c); };
  var stats = [
    ['Value', b.unknown ? '—' : fmtSigned(b.value, c), b.unknown ? 'unknown — not sent to Money Tracker' : (c !== 'THB' ? '≈ ' + fmtMoney(b.valueThb) : 'cash + holdings')],
    ['Cash', fmtSigned(b.cash, c), c !== 'THB' ? '≈ ' + fmtSigned(b.cashThb, 'THB') : ''],
    ['Holdings', f(b.holdings), c !== 'THB' ? '≈ ' + fmtMoney(b.holdingsThb) : 'market value'],
    ['Dividends to', recEsc(b.dividendsTo || 'this broker'), b.dividendsTo ? 'a bank account in Money Tracker' : 'into its cash']
  ];
  var rows = [['Opening cash', b.opening || 0], ['Deposits (from Money Tracker)', b.deposits], ['Withdrawals', b.withdrawals], ['Bought', -b.buys], ['Sold', b.sells],
    ['Fees', -b.fees], ['Dividends', b.dividends], ['Closed trades', b.trades]];
  var html = '<div class="hd-grid">' + stats.map(function(x) {
    return '<div class="hd-stat"><div class="l">' + x[0] + '</div><div class="v">' + x[1] + '</div>' + (x[2] ? '<div class="s">' + x[2] + '</div>' : '') + '</div>';
  }).join('') + '</div>';
  html += '<div class="card-title" style="margin-top:14px">Cash</div>' + rows.filter(function(r){ return Math.abs(r[1]) > 0.004; }).map(function(r) {
    return '<div class="hd-txn"><div><div class="t">' + r[0] + '</div></div><div class="a">' + (r[1] < 0 ? '−' : '+') + f(Math.abs(r[1])) + '</div></div>';
  }).join('') + '<div class="hd-txn"><div><div class="t"><b>Cash</b></div></div><div class="a"><b>' + fmtSigned(b.cash, c) + '</b></div></div>';
  if (b.dividendsElsewhere) html += '<div class="fx-hint">' + f(b.dividendsElsewhere) + ' of dividends went to ' + recEsc(b.dividendsTo) + ', not into this cash.</div>';
  if (b.positions && b.positions.length) html += '<div class="card-title" style="margin-top:14px">Held here</div>' + b.positions.map(function(p) {
    return '<div class="hd-txn"><div><div class="t">' + kindInfo(p.kind)[1] + ' ' + recEsc(p.name) + '</div><div class="d">' + fmtQty(p.quantity) + '</div></div>' +
      '<div class="a">' + fmtMoney(p.valueThb) + '</div></div>';
  }).join('');
  (b.warnings || []).forEach(function(w){ html += '<div class="hold-sub broker-warn">⚠ ' + recEsc(w) + '</div>'; });
  var hint = flowsHint();
  if (hint) html += '<div class="fx-hint">' + recEsc(hint) + '</div>';
  return html + '<div class="card-title" style="margin-top:14px">Settings</div>';
}
function brokerFormUpdate() {
  var cur = document.getElementById('bk-currency').value || 'THB';
  document.getElementById('bk-rate-group').style.display = cur === 'THB' ? 'none' : '';
  document.getElementById('bk-rate-label').textContent = '1 ' + cur + ' = ฿ (updates with prices)';
}
// Saved dividends that would follow a new "dividends to" setting (Money Tracker moves their Income rows too)
function brokerDividendCount(name) {
  var n = 0;
  holdings.forEach(function(h){ h.txns.forEach(function(t){ if (t.type === 'dividend' && t.account === name && /^WD/.test(t.id)) n++; }); });
  return n;
}
function saveBroker() {
  var name = document.getElementById('bk-name').value.trim();
  if (!name) { toast('Enter the broker name'); return; }
  var cur = document.getElementById('bk-currency').value || 'THB', rate = parseFloat(document.getElementById('bk-rate').value) || 0;
  var to = document.getElementById('bk-divto').value.trim(), b = brokerByName(name);
  if (!editBrokerName && b && b.saved) { toast('There is already a broker called ' + name); return; }
  if (b && (b.dividendsTo || '') !== to) {
    var n = brokerDividendCount(name);
    if (n && !confirm(n + ' dividend' + (n > 1 ? 's' : '') + ' already saved at ' + name + ' will also count as paid to ' + (to || 'the broker') + ' (in Money Tracker too). Continue?')) return;
  }
  var btn = document.getElementById('bk-save'); btn.textContent = 'Saving…'; btn.disabled = true;
  api({ action: 'setBroker', name: name, currency: cur, rate: cur === 'THB' ? 1 : rate, dividendsTo: to, note: document.getElementById('bk-note').value.trim(),
    openingCash: parseFloat(document.getElementById('bk-opening').value) || 0 }).then(function(res) {
    btn.disabled = false; btn.textContent = 'Save';
    if (!res.ok) { apiError(res); return; }
    closeModal('broker-modal');
    toast(res.needsRate ? 'Saved — refresh prices to get the ' + cur + ' rate' : 'Saved');
    loadAll();
  }).catch(function(){ btn.disabled = false; btn.textContent = 'Save'; toast('Needs a connection'); });
}
function deleteBroker() {
  if (!editBrokerName || !confirm('Delete the broker "' + editBrokerName + '"?')) return;
  api({ action: 'deleteBroker', name: editBrokerName }).then(function(res) {
    if (!res.ok) { apiError(res); return; }
    closeModal('broker-modal'); toast('Deleted'); loadAll();
  }).catch(function(){ toast('Needs a connection'); });
}

// ── for the dividend form: where a dividend at this broker is paid ──
function dividendPaidTo(account) {
  var b = brokerByName(String(account || '').trim());
  return b && b.dividendsTo ? b.dividendsTo : '';
}
