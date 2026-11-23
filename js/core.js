// ════════════════════════════════════════════
//  WEALTH PLANNER — core: connection, API, loading, formatting, modals, toast
// ════════════════════════════════════════════
// Shown in Settings so you can tell whether the phone has the latest update.
// Bump with every release: the date of the newest CHANGELOG.md heading (add .2, .3 for more the same day).
var APP_VERSION = '2026.11.22';
// Storage keys start with "wealth": Money Tracker lives on the same github.io address and shares localStorage.
var SCRIPT_URL = '';
var API_TOKEN  = '';
try { SCRIPT_URL = localStorage.getItem('wealthScriptUrl') || ''; API_TOKEN = localStorage.getItem('wealthToken') || ''; } catch(e) {}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
}

window.addEventListener('DOMContentLoaded', function() {
  if (!SCRIPT_URL || !API_TOKEN) { show('setup-screen'); return; }
  hide('setup-screen'); show('app');
  loadAll();
});

function show(id) { document.getElementById(id).style.display='flex'; }
function hide(id) { document.getElementById(id).style.display='none'; }

function saveConnection(url, tok) {
  try { localStorage.setItem('wealthScriptUrl', url); localStorage.setItem('wealthToken', tok); } catch(e) {}
  SCRIPT_URL = url; API_TOKEN = tok;
}
function saveScriptUrl() {
  var url = document.getElementById('script-url-input').value.trim();
  if (url.indexOf('http') !== 0) { toast('Please enter a valid URL'); return; }
  var tok = document.getElementById('script-token-input').value.trim();
  if (!tok) { toast('Paste the access token from setupToken()'); return; }
  saveConnection(url, tok);
  hide('setup-screen'); show('app');
  loadAll();
}
function updateScriptUrl() {
  var url = document.getElementById('settings-url').value.trim();
  if (url.indexOf('http') !== 0) { toast('Please enter a valid URL'); return; }
  saveConnection(url, document.getElementById('settings-token').value.trim());
  toast('Connection saved');
  closeModal('settings-modal');
  loadAll();
}
function openSettings() {
  document.getElementById('settings-url').value = SCRIPT_URL;
  document.getElementById('settings-token').value = API_TOKEN;
  document.getElementById('app-version').textContent = 'Version ' + APP_VERSION;
  openModal('settings-modal');
}

// ════════════════════════════════════════════
//  API
// ════════════════════════════════════════════
function rawApi(payload, retries) {
  if (retries === undefined) retries = 2;
  return fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(Object.assign({}, payload, { token: API_TOKEN }))
  }).then(function(r){ return r.json(); }).catch(function(err) {
    if (retries <= 0) throw err;
    return new Promise(function(res){ setTimeout(res, 800 * (3 - retries)); })
      .then(function(){ return rawApi(payload, retries - 1); });
  });
}

function api(payload, retries) {
  return rawApi(payload, retries).then(function(res) {
    if (res && res.auth) toast(res.error === 'unauthorized' ? 'Access token is wrong or missing — check Settings' : res.error);
    else if (res && res.ok === false && /Unknown action/.test(res.error || '')) toast('The backend is older than the app — deploy the latest version');
    return res;
  });
}

// One round-trip on open: holdings, prices, portfolio settings (and trades, once the backend sends them).
var holdings = [], holdingTotals = { value: 0, cost: 0, unrealized: 0, realized: 0, dividends: 0, investments: 0, assets: 0 };
var priceInfo = null, loaded = false;
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
    loaded = true;
    renderAll();
  }).catch(function() {
    st.textContent = 'Connection error — reload to retry'; st.style.display = '';
  });
}
function renderAll() { renderHome(); renderHoldings(); renderPortfolio(); }
function renderHome() {
  var t = holdingTotals;
  document.getElementById('header-total').textContent = fmtMoney(t.value);
  document.getElementById('header-total-sub').textContent = 'Investments ' + fmtMoney(t.investments) + ' · Assets ' + fmtMoney(t.assets);
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
function toast(msg, ms) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, ms || 2500);
}
