// ════════════════════════════════════════════
//  WEALTH PLANNER — core: connection, API, modals, toast
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

function loadAll() {
  var st = document.getElementById('home-status');
  return api({ action: 'bootstrap' }).then(function(d) {
    if (d && d.ok) st.textContent = 'Connected to "' + d.sheet + '".';
    else st.textContent = 'Not connected: ' + ((d && d.error) || 'no answer');
  }).catch(function() {
    st.textContent = 'Connection error — reload to retry';
  });
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
