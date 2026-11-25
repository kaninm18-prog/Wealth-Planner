// Wealth Planner — holdings: list on the home screen, detail, buy / sell / dividend, live prices.
// Ported from Money Tracker's js/holdings.js (Stage 4, step 3c). This app has no accounts:
// the broker is a name (set up in js/brokers.js), and a foreign amount is typed with its currency and rate.
// Buying/selling moves cash between the broker's cash and the holding — it is not spending.
// Loaded as a plain <script> (not a module): functions are global so onclick="..." handlers work.

var HOLD_KINDS = [
  ['gold','🥇','Gold','investment','baht-weight'], ['stock','📈','Stock','investment','shares'], ['etf','📊','ETF','investment','units'],
  ['fund','🏦','Mutual fund','investment','units'], ['crypto','🪙','Crypto','investment','coins'], ['bond','📜','Bond','investment','units'],
  ['property','🏠','Property','asset',''], ['vehicle','🚗','Vehicle','asset',''], ['electronics','💻','Electronics','asset',''], ['other','📦','Other asset','asset','']
];
var TRADE_CURS = ['THB','USD','EUR','GBP','JPY','SGD','HKD','CNY','AUD'];
function kindInfo(k) { for (var i = 0; i < HOLD_KINDS.length; i++) if (HOLD_KINDS[i][0] === k) return HOLD_KINDS[i]; return HOLD_KINDS[HOLD_KINDS.length-1]; }
function isAssetKind(k) { return kindInfo(k)[3] === 'asset'; }
function kindOptions() { return HOLD_KINDS.map(function(k){ return '<option value="' + k[0] + '">' + k[1] + ' ' + k[2] + '</option>'; }).join(''); }
function fmtQty(n) { return parseFloat(n||0).toLocaleString('en-US', { maximumFractionDigits: 6 }); }
function plHtml(v, base) {
  var cls = v > 0.005 ? 'pl-pos' : v < -0.005 ? 'pl-neg' : 'pl-zero';
  var pct = base > 0 ? ' (' + (v >= 0 ? '+' : '') + (v / base * 100).toFixed(1) + '%)' : '';
  return '<span class="' + cls + '">' + (v > 0.005 ? '+' : v < -0.005 ? '−' : '') + fmtMoney(Math.abs(v)) + pct + '</span>';
}
function fmtMonY(d) { var p = String(d).split('-'); return SHORT_MON[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2); }
// Today's price for one unit (share, baht-weight…): baht, plus the quote currency when it's foreign and its rate is known.
function unitPriceHtml(h) {
  if (!h.priced || !h.currentPrice) return '';
  var q = String(h.quoteCurrency || '').toUpperCase(), r = q && q !== 'THB' ? savedRates()[q] : 0;
  return 'now ' + fmtMoney(h.currentPrice) + (r ? ' (' + fmtCur(h.currentPrice / r, q) + ')' : '');
}
function holdingById(id) { for (var i = 0; i < holdings.length; i++) if (holdings[i].id === id) return holdings[i]; return null; }

// ── exchange rates ──
// Remembered from the last "Refresh prices" (only currencies your holdings are quoted in), so the form can suggest one.
// Kept in memory (fxRates, js/core.js) while unlocked, and encrypted in storage with the PIN's key (js/lock.js).
function savedRates() { return fxRates || {}; }
function saveRates(r) {
  fxRates = Object.assign({}, fxRates, r || {});
  if (lockKey) lockSaveRates(localStorage, lockKey, fxRates).catch(function(){});
}
// Rate to suggest for a currency: the last refresh, else the rate of your latest entry in that currency.
function suggestRate(cur) {
  if (cur === 'THB') return 1;
  var r = savedRates()[cur];
  if (r) return Math.round(r * 10000) / 10000;
  var best = null;
  holdings.forEach(function(h){ h.txns.forEach(function(t) {
    if (t.currency === cur && t.origAmount && t.amount && (!best || t.date > best.date)) best = t;
  }); });
  return best ? Math.round(best.amount / best.origAmount * 10000) / 10000 : '';
}
// Broker names (Brokers tab, holding entries and trades), for the suggestions under the Broker field.
function brokerNames() {
  var seen = {}, out = [];
  var add = function(n){ n = String(n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = true; out.push(n); } };
  if (brokerData) brokerData.brokers.forEach(function(b){ add(b.name); });
  holdings.forEach(function(h){ h.txns.forEach(function(t){ add(t.account); }); });
  (trades || []).forEach(function(t){ add(t.account); });
  return out.sort(function(a, b){ return a.toLowerCase().localeCompare(b.toLowerCase()); });
}
function fillBrokerList() {
  document.getElementById('broker-list').innerHTML = brokerNames().map(function(n){ return '<option value="' + escAttr(n) + '">'; }).join('');
}

// ── grouping on the home screen (js/grouping.js) ──
// Type | Broker is a display choice, not data: plain localStorage is fine. Which groups are folded is kept in
// memory only (broker names are data), so it is forgotten on lock (clearAppData) and on reload.
var holdGroupMode = 'type';
try { holdGroupMode = localStorage.getItem('wealthHoldGroup') === 'broker' ? 'broker' : 'type'; } catch(e) {}
var holdCollapsed = {};             // group key → true when folded; memory only
function setHoldGroupMode(m) {
  holdGroupMode = m === 'broker' ? 'broker' : 'type';
  try { localStorage.setItem('wealthHoldGroup', holdGroupMode); } catch(e) {}
  renderHoldings();
}
function toggleHoldGroup(i) {
  var el = document.querySelectorAll('#holdings-section .hold-group')[i];
  if (!el) return;
  var key = el.getAttribute('data-key'), shut = !holdCollapsed[key];
  if (shut) holdCollapsed[key] = true; else delete holdCollapsed[key];
  el.classList.toggle('shut', shut);
  el.querySelector('.hold-group-head').setAttribute('aria-expanded', shut ? 'false' : 'true');
}
// One holding's card. `it` is its part in the group (js/grouping.js): by broker, only what that broker holds.
function holdCardHtml(it) {
  var h = it.h, k = kindInfo(h.kind), inv = h.group === 'investment';
  var sub = inv
    ? fmtQty(it.qty) + (h.unit ? ' ' + recEsc(h.unit) : '') + (it.split ? ' of ' + fmtQty(h.quantity) : '') +
      (h.avgCost ? ' · avg ' + fmtMoney(h.avgCost) : '') + (unitPriceHtml(h) ? ' · ' + unitPriceHtml(h) : '')
    : k[2] + (h.priceDate ? ' · valued ' + fmtDate(h.priceDate) : '');
  return '<div class="hold-card" onclick="openHolding(\'' + escQ(h.id) + '\')">' +
    '<div class="hold-icon">' + k[1] + '</div>' +
    '<div style="min-width:0"><div class="hold-name">' + recEsc(h.name) + (h.symbol ? ' <span class="hold-sub">' + recEsc(h.symbol) + '</span>' : '') + '</div>' +
    '<div class="hold-sub">' + sub + (h.autoPrice ? ' · <span class="live-badge">live</span>' : (!h.priced && inv ? ' · no price yet' : '')) + '</div></div>' +
    '<div><div class="hold-val">' + fmtMoney(it.value) + '</div><div class="hold-pl">' + plHtml(it.value - it.cost, it.cost) + '</div></div></div>';
}

function renderHoldings() {
  var el = document.getElementById('holdings-section');
  if (!el || !loaded) return;
  var html = '';
  var groups = holdingGroups(holdings, holdGroupMode, brokerData);
  if (groups.length) {
    html += '<div class="hold-head"><div class="acc-page-section-header">📊 Holdings</div>' +
      '<div class="type-tabs hold-mode" role="group" aria-label="Group by">' +
      ['type', 'broker'].map(function(m) {
        var on = holdGroupMode === m;
        return '<button class="type-tab' + (on ? ' active' : '') + '" aria-pressed="' + on + '" onclick="setHoldGroupMode(\'' + m + '\')">' + (m === 'type' ? 'Type' : 'Broker') + '</button>';
      }).join('') + '</div></div>';
    groups.forEach(function(g, i) {
      var shut = !!holdCollapsed[g.key], kind = g.key.indexOf('type:') === 0 ? g.key.slice(5) : '';
      var icon = kind ? kindInfo(kind)[1] : (g.key === 'broker:' ? '📦' : '🏦');
      html += '<div class="hold-group' + (shut ? ' shut' : '') + '" data-key="' + escAttr(g.key) + '">' +
        '<button type="button" class="hold-group-head" aria-expanded="' + !shut + '" onclick="toggleHoldGroup(' + i + ')">' +
          '<span class="hold-group-name"><span class="hold-group-chev" aria-hidden="true">▾</span>' + icon + ' ' + recEsc(g.label) +
            ' <span class="hold-group-count">' + g.count + '</span></span>' +
          '<span class="hold-group-sum"><b>' + fmtMoney(g.value) + '</b> ' + plHtml(g.unrealized, g.cost) + '</span>' +
        '</button><div class="hold-group-body">' + g.items.map(holdCardHtml).join('') + '</div></div>';
    });
  }
  var closed = holdings.filter(function(h){ return h.quantity <= 0 && h.txns.length; });
  if (closed.length) {
    var rz = closed.reduce(function(a, h){ return a + h.realized + h.dividends; }, 0), inv = closed.reduce(function(a, h){ return a + h.invested; }, 0);
    html += '<div class="acc-page-section-header">✅ Closed positions</div>' +
      '<div class="hold-total"><span>Realised profit</span><span>' + plHtml(rz, inv) + '</span></div>';
    closed.sort(function(a, b){ return (b.lastDate || '').localeCompare(a.lastDate || ''); }).forEach(function(h) {
      var span = h.firstDate ? fmtMonY(h.firstDate) + (h.lastDate && h.lastDate.slice(0, 7) !== h.firstDate.slice(0, 7) ? ' – ' + fmtMonY(h.lastDate) : '') : '';
      html += '<div class="hold-card" onclick="openHolding(\'' + escQ(h.id) + '\')"><div class="hold-icon">' + kindInfo(h.kind)[1] + '</div>' +
        '<div style="min-width:0"><div class="hold-name">' + recEsc(h.name) + '</div>' +
        '<div class="hold-sub">Put in ' + fmtMoney(h.invested) + ' · got back ' + fmtMoney(h.proceeds) + (h.dividends ? ' + ' + fmtMoney(h.dividends) + ' dividends' : '') + (span ? ' · ' + span : '') + '</div></div>' +
        '<div><div class="hold-val">' + plHtml(h.realized + h.dividends, h.invested) + '</div><div class="hold-pl">sold</div></div></div>';
    });
  }
  if (holdings.some(function(h){ return h.autoPrice && h.quantity > 0; })) {
    var when = priceInfo && priceInfo.last ? new Date(priceInfo.last) : null;
    html = '<div class="price-bar"><span>' + (when ? 'Prices updated ' + when.toLocaleDateString('en-GB', { day:'numeric', month:'short' }) + ' ' + when.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : 'Live prices not fetched yet') +
      (priceInfo && priceInfo.daily ? ' · daily at ' + recEsc(priceInfo.daily === true ? '7am' : priceInfo.daily) : '') + '</span><button class="btn btn-ghost btn-sm" id="price-btn" onclick="refreshPricesNow()">↻ Refresh prices</button></div>' + html;
  }
  if (!html) html = '<div class="acc-page-section-header">📈 Assets & Investments</div><div class="hold-sub" style="padding:4px 2px 10px">Track gold, stocks, funds, property or a car here. Buying them moves money out of a broker\'s cash but is not counted as spending.</div>';
  if (holdings.some(function(h){ return h.group === 'investment'; }) || (journalOn && ((trades && trades.length) || portfolioMeta.tradeCount)))
    html += '<button class="btn btn-primary hold-add" style="margin-bottom:8px" onclick="openPortfolio()">📊 Portfolio — allocation, returns, dividends' + (journalOn ? ', trading' : '') + '</button>';
  else if (journalOn) html += '<button class="btn btn-ghost hold-add" style="margin-bottom:8px" onclick="openPortfolio(\'trading\')">🥇 Trading journal</button>';
  html += '<button class="btn btn-ghost hold-add" onclick="openTrade(\'buy\')">+ Add asset / investment</button>';
  el.innerHTML = html;
}

// ── locked units (tax funds: SSF, ThaiESG…) ──
// The backend works out, lot by lot, which units are still locked (sells taken from the oldest units first).
function addYearsStr(str, n) {
  var p = String(str).split('-'), y = parseInt(p[0], 10) + n, m = parseInt(p[1], 10), d = parseInt(p[2], 10);
  var last = new Date(y, m, 0).getDate();                 // 29 Feb + 1 year → 28 Feb
  return y + '-' + pad(m) + '-' + pad(Math.min(d, last));
}
// How many units of a sale of `qty` come out of locked lots, oldest units first (the backend's rule).
function lockedInSale(h, qty) {
  if (!h || !(h.lockedQty > 0) || !(qty > 0)) return 0;
  if (!h.lots || !h.lots.length) return Math.max(0, qty - (h.freeQty || 0));
  var n = qty, out = 0;
  h.lots.forEach(function(l) { if (n > 1e-9) { var t = Math.min(l.quantity, n); n -= t; if (l.locked) out += t; } });
  return Math.round(out * 1e6) / 1e6;
}
function lockBoxHtml(h) {
  if (!h.lots || !h.lots.length || !(h.quantity > 0)) return '';
  var u = h.unit ? ' ' + recEsc(h.unit) : ' units', dates = h.lots.filter(function(l){ return l.locked; }).map(function(l){ return l.lockUntil; }).sort();
  var sum = h.lockedQty > 0
    ? '🔒 Locked: ' + fmtQty(h.lockedQty) + u + ' until ' + fmtDateY(dates[0]) + (dates[dates.length - 1] !== dates[0] ? ' – ' + fmtDateY(dates[dates.length - 1]) : '') +
      ', free: ' + fmtQty(h.freeQty) + u + '.' +
      (h.nextUnlock && dates[dates.length - 1] !== dates[0] ? '<br>Next: ' + fmtQty(h.nextUnlock.quantity) + u + ' free on ' + fmtDateY(h.nextUnlock.date) + '.' : '')
    : '🔓 Nothing locked: all ' + fmtQty(h.quantity) + u + ' are free to sell.';
  return '<div class="lock-box"><div class="lock-sum">' + sum + '</div>' + h.lots.map(function(l) {
    return '<div class="lock-lot"><span>Bought ' + fmtDateY(l.date) + ' · <b>' + fmtQty(l.quantity) + '</b> left</span><span>' +
      (l.locked ? '🔒 until ' + fmtDateY(l.lockUntil) : l.lockUntil ? 'free since ' + fmtDateY(l.lockUntil) : 'not locked') + '</span></div>';
  }).join('') + '<div class="lock-lot"><span>Sales are counted from the oldest units first.</span></div></div>';
}

// ── detail ──
var openHoldingId = null;
function openHolding(id) {
  var h = holdingById(id);
  if (!h) { toast('Not loaded yet — refresh'); return; }
  openHoldingId = id;
  closeModal('trade-modal');
  var k = kindInfo(h.kind), asset = h.group === 'asset';
  document.getElementById('hd-title').innerHTML = k[1] + ' ' + recEsc(h.name) + (h.symbol ? ' <span class="hold-sub">' + recEsc(h.symbol) + '</span>' : '');
  var stats = asset ? [
      ['Current value', fmtMoney(h.value), h.priceDate ? 'as of ' + fmtDateY(h.priceDate) : 'purchase price'],
      ['Paid', fmtMoney(h.cost), ''],
      ['Gain / loss', plHtml(h.unrealized, h.cost), ''],
      ['Type', k[2], '']
    ] : [
      ['Holding', fmtQty(h.quantity) + (h.unit ? ' ' + recEsc(h.unit) : ''), h.avgCost ? 'avg cost ' + fmtMoney(h.avgCost) : ''],
      ['Value', fmtMoney(h.value), h.priced ? fmtMoney(h.currentPrice || 0) + ' / unit' + (h.priceDate ? ' · ' + fmtDate(h.priceDate) : '') : 'no price yet — at cost'],
      ['Unrealised', plHtml(h.unrealized, h.cost), 'cost ' + fmtMoney(h.cost)],
      ['Realised', plHtml(h.realized, 0), 'from sales'],
      ['Dividends', fmtMoney(h.dividends), h.taxWithheld ? 'after ' + fmtMoney(h.taxWithheld) + ' tax' : 'after tax'],
      ['Fees', fmtMoney(h.fees), 'buys and sales']
    ];
  var priceLabel = asset ? 'Current value (฿)' : 'Current price per ' + (h.unit ? recEsc(h.unit.replace(/s$/, '')) : 'unit') + ' (฿)';
  document.getElementById('hd-body').innerHTML = '<div class="hd-grid">' + stats.map(function(x) {
      return '<div class="hd-stat"><div class="l">' + x[0] + '</div><div class="v">' + x[1] + '</div>' + (x[2] ? '<div class="s">' + x[2] + '</div>' : '') + '</div>';
    }).join('') + '</div>' + lockBoxHtml(h) +
    (h.quantity > 0 ? '<div class="hd-price"><div class="form-group"><label class="form-label">' + priceLabel + '</label>' +
      '<input type="number" class="form-control" id="hd-price" inputmode="decimal" step="any" value="' + (asset ? (h.value || '') : (h.currentPrice || '')) + '"></div>' +
      '<button class="btn btn-primary btn-sm" style="width:auto" onclick="updateHoldingPrice()">Update</button></div>' : '') +
    (h.note ? '<div class="hold-sub" style="margin-top:8px">' + recEsc(h.note) + '</div>' : '');
  var acts = asset ? '' : '<button class="btn btn-primary btn-sm" onclick="openTrade(\'buy\', \'' + escQ(id) + '\')">Buy more</button>';
  if (h.quantity > 0) acts += '<button class="btn btn-ghost btn-sm" onclick="openTrade(\'sell\', \'' + escQ(id) + '\')">Sell</button>';
  if (!asset) acts += '<button class="btn btn-ghost btn-sm" onclick="openTrade(\'dividend\', \'' + escQ(id) + '\')">Dividend</button>';
  acts += '<button class="btn btn-ghost btn-sm" onclick="toggleHoldingEdit()">Edit</button>';
  document.getElementById('hd-actions').innerHTML = acts;
  document.getElementById('hd-edit').style.display = 'none';
  document.getElementById('hd-history').innerHTML = h.txns.length ? h.txns.map(function(t) {
    var what = t.type === 'buy' ? 'Bought' : t.type === 'sell' ? 'Sold' : 'Dividend';
    var detail = t.type === 'dividend' ? '' : fmtQty(t.quantity) + (h.unit ? ' ' + recEsc(h.unit) : '') + (t.price ? ' @ ' + fmtMoney(t.price) : '') +
      (t.lockUntil ? ' · 🔒 until ' + fmtDateY(t.lockUntil) : '');
    return '<div class="hd-txn"><div><div class="t">' + what + (detail ? ' · ' + detail : '') + '</div>' +
      '<div class="d">' + fmtDateY(t.date) + ' · ' + (t.account ? recEsc(t.account) : 'no cash moved') + (t.fee ? (t.type === 'dividend' ? ' · tax ' : ' · fee ') + fmtMoney(t.fee) : '') + (t.note ? ' · ' + recEsc(t.note) : '') + '</div></div>' +
      '<div class="a">' + (t.type === 'buy' ? '−' : '+') + (t.origAmount && t.currency && t.currency !== 'THB'
        ? fmtCur(t.origAmount, t.currency) + '<div class="d">≈ ' + fmtMoney(t.amount) + '</div>' : fmtMoney(t.amount)) + '</div>' +
      '<button title="Delete" onclick="deleteHoldingTxn(\'' + escQ(t.id) + '\')">✕</button></div>';
  }).join('') : '<div class="hold-sub">No entries yet.</div>';
  openModal('holding-modal');
}
function toggleHoldingEdit() {
  var h = holdingById(openHoldingId); if (!h) return;
  var box = document.getElementById('hd-edit');
  if (box.style.display === 'none') {
    document.getElementById('hd-kind').innerHTML = kindOptions();
    document.getElementById('hd-name').value = h.name; document.getElementById('hd-kind').value = h.kind;
    document.getElementById('hd-symbol').value = h.symbol; document.getElementById('hd-unit').value = h.unit; document.getElementById('hd-note').value = h.note;
    box.style.display = '';
  } else box.style.display = 'none';
}
function holdingCall(payload, okMsg) {
  return api(payload).then(function(res) {
    if (res.ok) { toast(okMsg); return refreshHoldings(); }
    apiError(res);
    return null;
  }).catch(function(){ toast('Needs a connection'); return null; });
}
function refreshHoldings() {
  return loadAll().then(function() { if (openHoldingId && document.getElementById('holding-modal').classList.contains('open')) {
    if (holdingById(openHoldingId)) openHolding(openHoldingId); else closeModal('holding-modal'); } });
}
function saveHoldingDetails() {
  var name = document.getElementById('hd-name').value.trim();
  if (!name) { toast('Enter a name'); return; }
  holdingCall({ action: 'updateHolding', id: openHoldingId, name: name, kind: document.getElementById('hd-kind').value,
    symbol: document.getElementById('hd-symbol').value, unit: document.getElementById('hd-unit').value, note: document.getElementById('hd-note').value }, 'Saved');
}
function updateHoldingPrice() {
  var h = holdingById(openHoldingId); if (!h) return;
  var v = parseFloat(document.getElementById('hd-price').value);
  if (!v || v <= 0) { toast('Enter a value'); return; }
  // assets are valued as a whole; investments by price per unit
  var price = h.group === 'asset' && h.quantity ? v / h.quantity : v;
  holdingCall({ action: 'updateHolding', id: openHoldingId, currentPrice: price, priceDate: todayStr() }, 'Value updated');
}
function deleteHoldingTxn(id) {
  if (!confirm('Delete this entry?')) return;
  holdingCall({ action: 'deleteHoldingTxn', id: id }, 'Deleted');
}
function deleteHolding() {
  var h = holdingById(openHoldingId); if (!h) return;
  if (!confirm('Delete "' + h.name + '" and all its buys, sales and dividends?')) return;
  holdingCall({ action: 'deleteHolding', id: openHoldingId }, 'Deleted').then(function(){ closeModal('holding-modal'); });
}

// ── buy / sell / dividend form ──
// Amounts are typed in the chosen currency; a foreign amount is converted to ฿ at the rate typed under it,
// and the exact foreign amount (and fee) is kept too.
var tradeType = 'buy';
function tradeCur() { return document.getElementById('tr-currency').value || 'THB'; }
function tradeRate() { return tradeCur() === 'THB' ? 1 : (parseFloat(document.getElementById('tr-rate').value) || 0); }
// Currency a holding is usually traded in: its latest entry's, else the currency its price is quoted in.
function holdingCur(h) {
  if (!h) return 'THB';
  if (h.txns.length) return h.txns[0].origAmount && h.txns[0].currency ? h.txns[0].currency : 'THB';
  var q = String(h.quoteCurrency || '').toUpperCase();
  return h.kind !== 'gold' && TRADE_CURS.indexOf(q) > 0 ? q : 'THB';
}
function openTrade(type, holdingId) {
  closeModal('holding-modal');
  var sel = document.getElementById('tr-holding');
  var open = holdings.filter(function(h){ return h.quantity > 0 || !h.txns.length || h.id === holdingId; });
  sel.innerHTML = '<option value="">➕ New…</option>' + open.map(function(h) {
    return '<option value="' + escAttr(h.id) + '">' + kindInfo(h.kind)[1] + ' ' + recEsc(h.name) + (h.quantity ? ' (' + fmtQty(h.quantity) + (h.unit ? ' ' + recEsc(h.unit) : '') + ')' : '') + '</option>';
  }).join('');
  sel.value = holdingId || '';
  document.getElementById('tr-kind').innerHTML = kindOptions();
  document.getElementById('tr-currency').innerHTML = TRADE_CURS.map(function(c){ return '<option value="' + c + '">' + c + '</option>'; }).join('');
  ['tr-name','tr-symbol','tr-unit','tr-qty','tr-price','tr-amount','tr-fee','tr-note','tr-lock'].forEach(function(i){ document.getElementById(i).value = ''; });
  document.getElementById('tr-amount').dataset.touched = '';
  document.getElementById('tr-kind').value = 'gold';
  document.getElementById('tr-date').value = todayStr();
  lockYearsPicked(0);
  var h = holdingId ? holdingById(holdingId) : null, last = h && h.txns.length ? h.txns[0].account : '';
  document.getElementById('tr-account').value = last || '';
  fillBrokerList();
  setTradeCurrency(holdingCur(h));
  setTradeType(type || 'buy');
  openModal('trade-modal');
}
function setTradeCurrency(c) {
  var sel = document.getElementById('tr-currency');
  if (TRADE_CURS.indexOf(c) < 0 && !sel.querySelector('option[value="' + c.replace(/[^A-Z]/g, '') + '"]')) sel.innerHTML += '<option value="' + escAttr(c) + '">' + recEsc(c) + '</option>';
  sel.value = c;
  document.getElementById('tr-rate').value = suggestRate(c);
}
function onTradeHolding() { setTradeCurrency(holdingCur(holdingById(document.getElementById('tr-holding').value))); tradeFormUpdate(); }
function onTradeCurrency() { setTradeCurrency(tradeCur()); tradeFormUpdate(); }
// "Locked until": the quick buttons count from the purchase date (and follow it when the date changes).
function setLockYears(n) {
  var base = document.getElementById('tr-date').value || todayStr();
  document.getElementById('tr-lock').value = n ? addYearsStr(base, n) : '';
  lockYearsPicked(n);
}
function lockYearsPicked(n) {             // n: years of the quick button, 0 = None, -1 = a date typed by hand
  var q = document.getElementById('tr-lock-quick');
  q.setAttribute('data-years', n);
  q.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', parseInt(b.getAttribute('data-years'), 10) === n); });
}
function onTradeDate() {
  var n = parseInt(document.getElementById('tr-lock-quick').getAttribute('data-years'), 10);
  if (n > 0) setLockYears(n);
}
function setTradeType(t) {
  tradeType = t;
  tradeFormUpdate();
}
function tradeFormUpdate() {
  var id = document.getElementById('tr-holding').value, h = id ? holdingById(id) : null;
  var isNew = !h, kind = h ? h.kind : document.getElementById('tr-kind').value, asset = isAssetKind(kind);
  if (isNew && tradeType !== 'buy') tradeType = 'buy';
  if (asset && tradeType === 'dividend') tradeType = 'buy';
  ['buy','sell','dividend'].forEach(function(x){ document.getElementById('tr-tab-' + x).classList.toggle('active', x === tradeType); });
  document.getElementById('tr-tab-sell').style.display = isNew ? 'none' : '';
  document.getElementById('tr-tab-dividend').style.display = (isNew || asset) ? 'none' : '';
  document.getElementById('tr-new').style.display = isNew ? '' : 'none';
  document.getElementById('tr-unit-group').style.display = asset ? 'none' : '';
  if (isNew && !document.getElementById('tr-unit').value) document.getElementById('tr-unit').placeholder = kindInfo(kind)[4] || 'units';
  var div = tradeType === 'dividend';
  document.getElementById('tr-acct-label').textContent = div ? 'Broker (paid by)' : tradeType === 'buy' ? 'Broker (paid from its cash)' : 'Broker (received into its cash)';
  document.getElementById('tr-account').placeholder = div ? 'e.g. Dime, Streaming' : tradeType === 'buy' ? 'Empty = already owned, no money moves' : 'Empty = not received at a broker';
  var cur = tradeCur(), cs = curSym(cur);
  document.getElementById('tr-rate-group').style.display = cur === 'THB' ? 'none' : '';
  document.getElementById('tr-rate-label').textContent = '1 ' + cur + ' = ฿';
  document.getElementById('tr-qp').style.display = (div || asset) ? 'none' : 'flex';
  document.getElementById('tr-lock-group').style.display = tradeType === 'buy' && !asset ? '' : 'none';
  document.getElementById('tr-fee-label').textContent = (div ? 'Tax withheld (' : 'Fee (') + cs + ')';
  document.getElementById('tr-fee').placeholder = div ? 'e.g. 10% for Thai stocks' : '0';
  document.getElementById('tr-amount-label').textContent = (div ? 'Dividend received' : asset ? (tradeType === 'sell' ? 'Sold for' : 'Price paid') : 'Total') + ' (' + cs + ')';
  var unit = h ? (h.unit || 'unit') : (document.getElementById('tr-unit').value || kindInfo(kind)[4] || 'unit');
  document.getElementById('tr-price-label').textContent = 'Price per ' + unit.replace(/s$/, '') + ' (' + cs + ')';
  document.getElementById('tr-qty-label').textContent = 'Quantity' + (unit && unit !== 'unit' ? ' (' + unit + ')' : '');
  document.getElementById('tr-title').textContent = div ? 'Dividend' : (tradeType === 'sell' ? 'Sell' : (isNew ? 'Add asset / investment' : 'Buy more'));
  var hint = '', rate = tradeRate();
  if (tradeType === 'sell' && h) hint = 'You hold ' + fmtQty(h.quantity) + (h.unit ? ' ' + h.unit : '') + (h.avgCost ? ' · avg cost ' + fmtMoney(h.avgCost) + (cur !== 'THB' && rate ? ' ≈ ' + fmtCur(h.avgCost / rate, cur) : '') : '') + '.' +
    (h.lockedQty > 0 ? ' Locked: ' + fmtQty(h.lockedQty) + ', free to sell: ' + fmtQty(h.freeQty) + '.' : '');
  else if (div) {
    var acct = document.getElementById('tr-account').value.trim(), to = dividendPaidTo(acct);
    hint = 'Amount after tax. ' + (to ? 'Paid to ' + to + ' (set on the broker), not into ' + acct + '\'s cash.'
      : acct ? 'Paid into ' + acct + '\'s cash.' : '') + ' Also counted as income in Money Tracker.';
  }
  else if (tradeType === 'buy') hint = 'Not counted as spending — it moves money from the broker\'s cash into the holding.';
  document.getElementById('tr-hint').textContent = hint;
  tradeCalc();
}
function tradeCalc() {
  var q = parseFloat(document.getElementById('tr-qty').value), p = parseFloat(document.getElementById('tr-price').value);
  var amt = document.getElementById('tr-amount');
  if (amt.dataset.touched !== '1' && q > 0 && p > 0) amt.value = Math.round(q * p * 100) / 100;
  tradeLockWarn();
}
// Selling locked units is allowed (it is your money), but say clearly what it may cost.
function tradeLockWarn() {
  var el = document.getElementById('tr-lock-warn'), id = document.getElementById('tr-holding').value, h = id ? holdingById(id) : null;
  var n = tradeType === 'sell' && h ? lockedInSale(h, parseFloat(document.getElementById('tr-qty').value)) : 0;
  el.style.display = n > 0 ? '' : 'none';
  el.textContent = n > 0 ? '⚠ Selling ' + fmtQty(n) + ' locked unit' + (n === 1 ? '' : 's') + ': you may lose the tax benefit and have to pay it back.' +
    (h.nextUnlock ? ' The next ' + fmtQty(h.nextUnlock.quantity) + ' unlock on ' + fmtDateY(h.nextUnlock.date) + '.' : '') : '';
}
function saveTrade() {
  var id = document.getElementById('tr-holding').value, h = id ? holdingById(id) : null;
  var kind = h ? h.kind : document.getElementById('tr-kind').value, asset = isAssetKind(kind), div = tradeType === 'dividend';
  var amount = parseFloat(document.getElementById('tr-amount').value);
  var qty = asset ? (tradeType === 'sell' && h ? h.quantity : 1) : parseFloat(document.getElementById('tr-qty').value);
  var price = asset ? amount : parseFloat(document.getElementById('tr-price').value);
  if (!h && !document.getElementById('tr-name').value.trim()) { toast('Enter a name'); return; }
  if (!div && !(qty > 0)) { toast('Enter the quantity'); return; }
  if (!(amount > 0)) { toast(div ? 'Enter the dividend' : 'Enter the total'); return; }
  if (!div && !asset && !(price > 0)) price = amount / qty;
  if (asset && tradeType === 'sell') price = amount / qty;
  var fee = parseFloat(document.getElementById('tr-fee').value) || 0;
  var payload = { action: 'addHoldingTxn', type: tradeType, holdingId: id, quantity: div ? 0 : qty, price: div ? 0 : price,
    amount: amount, fee: div ? 0 : fee, tax: div ? fee : 0,
    account: document.getElementById('tr-account').value.trim(), date: document.getElementById('tr-date').value || todayStr(),
    note: document.getElementById('tr-note').value.trim(), id: newClientId(div ? 'WD' : 'X') };   // WD: exported to Money Tracker (C8)
  if (!h) payload.holding = { name: document.getElementById('tr-name').value.trim(), kind: kind,
    symbol: document.getElementById('tr-symbol').value, unit: asset ? '' : (document.getElementById('tr-unit').value.trim() || kindInfo(kind)[4]) };
  var lock = tradeType === 'buy' && !asset ? document.getElementById('tr-lock').value : '';
  if (lock && lock <= payload.date) { toast('"Locked until" should be after the purchase date'); return; }
  if (lock) payload.lockUntil = lock;
  if (!payload.account && (div || payload.fee)) { toast(div ? 'Enter the broker that paid it' : 'Enter the broker the fee was paid at'); return; }
  var cur = tradeCur(), rate = tradeRate();
  if (cur !== 'THB') {                 // typed in a foreign currency → keep the exact amount and fee, store ฿ too
    if (!(rate > 0)) { toast('Enter the exchange rate (฿ for 1 ' + cur + ')'); return; }
    payload.currency = cur; payload.origAmount = amount;
    payload.amount = Math.round(amount * rate * 100) / 100;
    payload.price = Math.round(payload.price * rate * 10000) / 10000;
    if (payload.fee) { payload.feeOrig = payload.fee; payload.fee = Math.round(payload.fee * rate * 100) / 100; }
    if (payload.tax) { payload.taxOrig = payload.tax; payload.tax = Math.round(payload.tax * rate * 100) / 100; }   // C6
  }
  var btn = document.getElementById('tr-save'); btn.textContent = 'Saving…';
  api(payload).then(function(res) {
    btn.textContent = 'Save';
    if (res.ok) {
      closeModal('trade-modal');
      toast(div ? 'Dividend saved' : tradeType === 'sell' ? 'Sale saved' : 'Saved');
      openHoldingId = res.holdingId || id;
      loadAll().then(function(){ if (openHoldingId && holdingById(openHoldingId)) openHolding(openHoldingId); });
    } else apiError(res);
  }).catch(function(){ btn.textContent = 'Save'; toast('Needs a connection'); });
}

// ── live prices ──
function refreshPricesNow() {
  var b = document.getElementById('price-btn'); if (b) { b.textContent = 'Updating…'; b.disabled = true; }
  api({ action: 'refreshPrices' }).then(function(res) {
    if (!res.ok) { apiError(res); return; }
    saveRates(res.rates);
    var msg = res.updated.length ? 'Updated ' + res.updated.length + ' price' + (res.updated.length === 1 ? '' : 's') : 'No prices updated';
    if (res.failed.length) msg += ' · not found: ' + res.failed.join(', ');
    toast(msg, res.failed.length ? 9000 : 2500);              // long enough to read why each one failed
    return loadAll();
  }).catch(function(){ toast('Updating prices needs a connection'); })
    .then(function(){ var b2 = document.getElementById('price-btn'); if (b2) { b2.textContent = '↻ Refresh prices'; b2.disabled = false; } });
}
