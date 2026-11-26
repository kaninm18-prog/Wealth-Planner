// ════════════════════════════════════════════
//  WEALTH PLANNER — core: connection, API, loading, formatting, modals, toast
// ════════════════════════════════════════════
// Shown in Settings so you can tell whether the phone has the latest update.
// Bump with every release: the date of the newest CHANGELOG.md heading (add .2, .3 for more the same day).
var APP_VERSION = '2026.11.25.3';
// Storage keys start with "wealth": Money Tracker lives on the same github.io address and shares localStorage.
// The URL is kept in plain text (it is useless without the token). The token is only in memory while the app is
// unlocked; at rest it is in the encrypted vault (js/lock.js). Starting, locking and unlocking: js/lockscreen.js.
var SCRIPT_URL = '';
var API_TOKEN  = '';
try { SCRIPT_URL = localStorage.getItem('wealthScriptUrl') || ''; } catch(e) {}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}

function show(id) { document.getElementById(id).style.display='flex'; }
function hide(id) { document.getElementById(id).style.display='none'; }

function saveScriptUrlOnly(url) {
  try { localStorage.setItem('wealthScriptUrl', url); } catch(e) {}
  SCRIPT_URL = url;
}
// Setup screen: URL + token, then a PIN is set (js/lockscreen.js) before anything is saved for the token.
function saveScriptUrl() {
  var url = document.getElementById('script-url-input').value.trim();
  if (url.indexOf('http') !== 0) { toast('Please enter a valid URL', 0, true); return; }
  var tok = document.getElementById('script-token-input').value.trim();
  if (!tok) { toast('Paste the access token from setupToken()', 0, true); return; }
  document.getElementById('script-token-input').value = '';
  saveScriptUrlOnly(url);
  pinStartSetup(tok);
}
// Settings: a new URL, and a new token if one is typed (empty = keep the saved one). The token is re-encrypted.
function updateScriptUrl() {
  var url = document.getElementById('settings-url').value.trim();
  if (url.indexOf('http') !== 0) { toast('Please enter a valid URL'); return; }
  var tokEl = document.getElementById('settings-token'), tok = tokEl.value.trim();
  tokEl.value = '';
  saveScriptUrlOnly(url);
  (tok ? lockStoreToken(localStorage, lockKey, tok).then(function(){ API_TOKEN = tok; }) : Promise.resolve()).then(function() {
    toast('Connection saved');
    closeModal('settings-modal');
    loadAll();
  }).catch(function(){ toast('Could not save the token'); });
}
function openSettings() {
  document.getElementById('settings-url').value = SCRIPT_URL;
  document.getElementById('settings-token').value = '';     // never put the token back into the page
  document.getElementById('app-version').textContent = 'Version ' + APP_VERSION;
  openModal('settings-modal');
}

// ════════════════════════════════════════════
//  API
// ════════════════════════════════════════════
// Requests only go out while unlocked. An answer that arrives after the app was locked (lockEpoch changed) is
// dropped: the promise never settles, so nothing is rendered and no toast shows on the lock screen.
function lockedPromise() { return new Promise(function(){}); }
function rawApi(payload, retries) {
  if (retries === undefined) retries = 2;
  if (!appOpen) return lockedPromise();
  var epoch = lockEpoch;
  return fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({}, payload, { token: API_TOKEN }))
  }).then(function(r){ return r.json(); }).catch(function(err) {
    if (epoch !== lockEpoch) return lockedPromise();
    if (retries <= 0) throw err;
    return new Promise(function(res){ setTimeout(res, 800 * (3 - retries)); })
      .then(function(){ return epoch !== lockEpoch ? lockedPromise() : rawApi(payload, retries - 1); });
  }).then(function(res) {
    return epoch !== lockEpoch ? lockedPromise() : res;
  }, function(err) {
    if (epoch !== lockEpoch) return lockedPromise();
    throw err;
  });
}

function api(payload, retries) {
  return rawApi(payload, retries).then(function(res) {
    if (res && res.auth) toast(res.error === 'unauthorized' ? 'Access token is wrong or missing — check Settings' : res.error);
    else if (res && res.ok === false && /Unknown action/.test(res.error || '')) toast('The backend is older than the app — deploy the latest version');
    return res;
  });
}

// One round-trip on open: holdings, prices, portfolio settings, trades and brokers (once the backend sends them).
var holdings = [], holdingTotals = emptyTotals();
var priceInfo = null, loaded = false;
var fxRates = {};                   // last exchange rates (js/holdings.js); kept encrypted at rest
function emptyTotals() { return { value: 0, cost: 0, unrealized: 0, realized: 0, dividends: 0, investments: 0, assets: 0 }; }
function loadAll() {
  var st = document.getElementById('home-status');
  return api({ action: 'bootstrap' }).then(function(d) {
    if (!d || !d.ok) { st.textContent = 'Not connected: ' + ((d && d.error) || 'no answer'); st.style.display = ''; return; }
    st.style.display = 'none';
    if (d.prices) priceInfo = d.prices;
    if (d.holdings && d.holdings.ok) { holdings = d.holdings.holdings || []; holdingTotals = d.holdings.totals || holdingTotals; }
    if (d.portfolio && d.portfolio.ok) setPortfolioMeta(d.portfolio);
    if (d.trades) setTrades(d.trades);
    else if (journalOn && !trades) loadTrades();      // backend from before the trading journal moved here (3b)
    setBrokers(d.brokers);                            // backend from before step 3d: no brokers section
    loaded = true;
    renderAll();
  }).catch(function() {
    st.textContent = 'Connection error — reload to retry'; st.style.display = '';
  });
}
// On lock: forget everything loaded from the sheet and empty what was rendered from it.
// Anything new that holds your data (a variable or a part of the page) must be reset here too.
function clearAppData() {
  holdings = []; holdingTotals = emptyTotals(); priceInfo = null; loaded = false; fxRates = {};
  brokerData = null; editBrokerName = null; openHoldingId = null; holdCollapsed = {};
  trades = null; tradesLoading = false; journalOn = true; tjPending = null; packPending = null;
  portfolioMeta = { targets: {}, benchmarkSymbol: 'INDEXBKK:SET', benchmark: null, tradeCount: 0 };
  document.querySelectorAll('.modal-overlay.open, .annual-modal-overlay.open').forEach(function(m){ m.classList.remove('open'); });
  ['header-total-sub', 'home-totals', 'brokers-section', 'hd-title', 'hd-body', 'hd-actions', 'hd-history', 'bk-body', 'bk-title',
    'pf-body', 'pack-summary', 'tji-summary', 'broker-list', 'tr-holding'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.innerHTML = '';
  });
  document.getElementById('header-total').textContent = '฿0';
  document.getElementById('home-totals').style.display = 'none';
  document.getElementById('holdings-section').innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  var st = document.getElementById('home-status'); st.textContent = 'Connecting…'; st.style.display = '';
  document.querySelectorAll('#app input, .modal-overlay input, .annual-modal-overlay input, #app textarea, .modal-overlay textarea').forEach(function(i) {
    if (i.type !== 'button' && i.type !== 'submit') i.value = '';
  });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  clearTimeout(toastTimer); document.getElementById('toast').classList.remove('show');
}
function renderAll() { renderHome(); renderHoldings(); renderBrokers(); renderPortfolio(); }
function renderHome() {
  var t = holdingTotals;
  // Broker cash counts once Money Tracker's deposits are known (otherwise it would be only −buys + sells)
  var cash = brokerCashThb();
  document.getElementById('header-total').textContent = fmtMoney(t.value + cash);
  document.getElementById('header-total-sub').textContent = 'Investments ' + fmtMoney(t.investments) + ' · Assets ' + fmtMoney(t.assets) +
    (brokerCashKnown() ? ' · Broker cash ' + fmtMoney(cash) : '');
  var el = document.getElementById('home-totals');
  if (!holdings.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = [['Cost', fmtMoney(t.cost), 'what you hold, at average cost'], ['Unrealised', plHtml(t.unrealized, t.cost), 'not sold yet'],
    ['Realised', plHtml(t.realized, 0), 'from sales'], ['Dividends', fmtMoney(t.dividends), 'all time, after tax']].map(function(x) {
    return '<div class="hd-stat"><div class="l">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="s">' + x[2] + '</div></div>';
  }).join('');
}
// The backend answers "Unknown action" when it is older than the app; api() has already said so in a toast.
function oldBackend(res) { return !!(res && res.ok === false && /Unknown action/.test(res.error || '')); }
function apiError(res) { if (!oldBackend(res) && !(res && res.auth)) toast('Error: ' + ((res && res.error) || '?'), 4000); }

// ════════════════════════════════════════════
//  FORMATTING (copied from Money Tracker's js/core.js; no privacy mode here)
// ════════════════════════════════════════════
var CUR_SYM = {USD:'$',EUR:'€',GBP:'£',JPY:'¥',SGD:'S$',CNY:'¥',AUD:'A$',HKD:'HK$'};
function curSym(c) { return c === 'THB' ? '฿' : (CUR_SYM[c] || c); }
function fmtMoney(n) { return '฿' + parseFloat(n||0).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2}); }
function fmtCur(n, cur) {
  if (!cur || cur === 'THB') return fmtMoney(n);
  return (CUR_SYM[cur] || cur + ' ') + parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function fmtDateY(str) { if(!str)return''; var d=new Date(str+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function fmtDate(str) { if(!str)return''; var d=new Date(str+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); }
function todayStr() { var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function pad(n) { return n<10?'0'+n:''+n; }
function addDaysStr(str, n) { var d = new Date(str+'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
var SHORT_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function recEsc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
function escQ(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
// Ids made on the device, so a retried save is recognised by the backend instead of saved twice.
function newClientId(prefix) {
  var r = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') : (Date.now().toString(16) + Math.random().toString(16).slice(2));
  return prefix + r.slice(0, 10);
}

// ════════════════════════════════════════════
//  MODALS + TOAST
// ════════════════════════════════════════════
function openModal(id) {
  var el = document.getElementById(id);
  el.classList.add('open');
  el.onclick = function(e){ if(e.target===el){ el.classList.remove('open'); } };
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

var toastTimer;
// While locked, only toasts marked `always` (setup and lock screens) show: nothing about your data.
function toast(msg, ms, always) {
  if (!appOpen && !always) return;
  var el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, ms || 2500);
}
