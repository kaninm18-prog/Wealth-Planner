// Wealth Planner — PIN lock screens: start-up, unlock, set / change the PIN, auto-lock, Forgot PIN.
// The crypto and the vault are in js/lock.js. Nothing is loaded from the sheet, and no request is sent,
// until the PIN has opened the vault (appOpen). See also clearAppData() in js/core.js.
// Loaded as a plain <script> after core.js: functions are global so onclick="..." handlers work.

var lockKey = null;          // the AES key, in memory only while unlocked
var appOpen = false;         // unlocked: data may be loaded and shown
var lockEpoch = 0;           // +1 on every lock; answers to requests sent before it are dropped (core.js rawApi)
var lockHiddenAt = 0;        // when the page went to the background

// The PIN pad's state
var pinMode = 'unlock';      // 'unlock' | 'new' | 'confirm' | 'change-old'
var pinPurpose = '';         // for 'new'/'confirm': 'migrate' (token from before the lock) | 'setup' | 'change'
var pinEntry = '', pinFirst = '', pinBusy = false, pinWaitTimer = null;
var pendingToken = '';       // setup: the token typed on the setup screen, until its PIN is set

window.addEventListener('DOMContentLoaded', lockStart);

function lockStart() {
  if (!lockSupported()) { show('nocrypto-screen'); return; }
  var plain = null;
  try { plain = localStorage.getItem(LOCK_PLAIN_TOKEN); } catch(e) {}
  if (lockHasVault(localStorage)) {
    // Left over if setting the PIN stopped half way: the vault already has it.
    if (plain) { localStorage.removeItem(LOCK_PLAIN_TOKEN); localStorage.removeItem(LOCK_PLAIN_RATES); }
    showPin('unlock');
  } else if (plain && SCRIPT_URL) {
    pinPurpose = 'migrate';       // first run after the update: set a PIN now (no skip)
    showPin('new');
  } else showSetup();
}

function showSetup() {
  hide('lock-screen'); hide('app');
  document.getElementById('script-url-input').value = SCRIPT_URL;
  show('setup-screen');
}

// The app is unlocked with `key` (from the PIN). Face ID / fingerprint (later): a WebAuthn credential with the
// PRF extension could unwrap the same key from a second entry (e.g. wealthLockBio_v1) and call this the same way.
function lockOpened(key, token, rates) {
  lockKey = key; API_TOKEN = token; fxRates = rates || {};
  appOpen = true; pendingToken = '';
  pinReset();
  hide('lock-screen'); hide('setup-screen'); show('app');
  loadAll();
}

// Lock: drop the key and the token, forget and clear the data, show the PIN pad.
function lockApp() {
  if (!appOpen) return;
  appOpen = false; lockEpoch++;
  lockKey = null; API_TOKEN = ''; pinPurpose = '';
  clearAppData();
  hide('app');
  showPin('unlock');
}

// Wipe the vault and the encrypted cache and go back to the setup screen. Google Sheets is not touched.
function lockReset(msg) {
  lockWipe(localStorage);
  if (appOpen) { appOpen = false; lockEpoch++; clearAppData(); }
  lockKey = null; API_TOKEN = ''; pendingToken = '';
  pinReset();
  showSetup();
  toast(msg, 9000, true);
}
function forgotPin() {
  if (!confirm('Reset Wealth Planner on this device?\n\nThe PIN and the saved access token are removed from this device. ' +
    'You then enter the Web App URL and access token again (Apps Script: run setupToken).\n\nYour data in Google Sheets is not touched.')) return;
  lockReset('Reset. Enter the URL and access token again — your data in Google Sheets is untouched.');
}

// ── auto-lock: 5 minutes in the background ──
document.addEventListener('visibilitychange', function() {
  if (document.hidden) { lockHiddenAt = Date.now(); return; }
  lockCheckAway();
});
window.addEventListener('pageshow', function(e) { if (e.persisted) lockCheckAway(); });
function lockCheckAway() {
  if (lockHiddenAt && Date.now() - lockHiddenAt >= LOCK_AFTER_MS) lockApp();
  lockHiddenAt = 0;
}

// ── Settings ──
function lockNow() { closeModal('settings-modal'); lockApp(); }
function changePin() {
  closeModal('settings-modal');
  pinPurpose = 'change';
  showPin('change-old');
}

// ── setup: after the URL + token, set a PIN ──
function pinStartSetup(tok) {
  pendingToken = tok;
  pinPurpose = 'setup';
  hide('setup-screen');
  showPin('new');
}

// ── the PIN pad ──
var PIN_TEXT = {
  'unlock': ['Enter your PIN', ''],
  'change-old': ['Current PIN', 'Enter your current PIN to change it.'],
  'confirm': ['Confirm your PIN', 'Enter the same 6 digits again.']
};
function pinTitle() {
  if (pinMode !== 'new') return PIN_TEXT[pinMode];
  if (pinPurpose === 'migrate') return ['Set a PIN', 'Wealth Planner now opens with a 6-digit PIN. Your access token is kept encrypted with it on this device.'];
  if (pinPurpose === 'change') return ['New PIN', 'Choose a new 6-digit PIN.'];
  return ['Set a PIN', 'Choose a 6-digit PIN to open Wealth Planner on this device.'];
}
function pinReset() {
  pinEntry = ''; pinFirst = ''; pinBusy = false; pinMode = 'unlock';
  clearInterval(pinWaitTimer); pinWaitTimer = null;
}
function showPin(mode) {
  if (mode === 'unlock') pinReset();
  pinMode = mode; pinEntry = ''; pinBusy = false;
  var t = pinTitle();
  document.getElementById('lock-title').textContent = t[0];
  document.getElementById('lock-sub').textContent = t[1];
  document.getElementById('lock-forgot').style.display = mode === 'unlock' ? '' : 'none';
  // Change PIN and setup can be cancelled; setting the PIN for an existing token can't (no skip)
  document.getElementById('lock-cancel').style.display = pinPurpose === 'change' || pinPurpose === 'setup' ? (mode === 'unlock' ? 'none' : '') : 'none';
  pinMsg('');
  pinDots();
  show('lock-screen');
  if (mode === 'unlock') pinCheckWait();
}
function pinDots() {
  var dots = document.querySelectorAll('#pin-dots span');
  for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < pinEntry.length);
}
function pinMsg(m, bad) {
  var el = document.getElementById('lock-msg');
  el.textContent = m; el.classList.toggle('bad', !!bad);
}
function cancelPin() {
  var purpose = pinPurpose;
  pinReset(); pinPurpose = '';
  if (purpose === 'setup') { pendingToken = ''; showSetup(); return; }
  if (appOpen) hide('lock-screen');
}
function pinKey(k) {
  if (pinBusy || pinWaitTimer || document.getElementById('lock-screen').style.display === 'none') return;
  if (k === 'del') pinEntry = pinEntry.slice(0, -1);
  else if (pinEntry.length < LOCK_PIN_LEN) pinEntry += k;
  pinDots();
  if (pinEntry.length === LOCK_PIN_LEN) pinSubmit();
}
// A hardware keyboard (laptop): digits, Backspace, Escape to cancel.
document.addEventListener('keydown', function(e) {
  if (document.getElementById('lock-screen').style.display === 'none' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pinKey(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); pinKey('del'); }
  else if (e.key === 'Escape' && document.getElementById('lock-cancel').style.display !== 'none') cancelPin();
});

function pinSubmit() {
  var pin = pinEntry;
  pinEntry = '';
  if (pinMode === 'new') { pinFirst = pin; showPin('confirm'); return; }
  if (pinMode === 'confirm') {
    if (pin !== pinFirst) { pinFirst = ''; showPin('new'); pinMsg('The PINs didn’t match — try again.', true); return; }
    return pinSave(pin);
  }
  // 'unlock' or 'change-old': check the PIN by opening the vault
  pinBusy = true; pinMsg('Checking…');
  lockUnlock(localStorage, pin, Date.now()).then(function(r) {
    pinBusy = false; pinDots();
    if (r.ok) {
      if (pinMode === 'change-old') { showPin('new'); return; }
      return lockOpened(r.key, r.token, r.rates);
    }
    if (r.wiped) return lockReset('10 wrong PINs: the app was reset on this device. Enter the URL and access token again — your data in Google Sheets is untouched.');
    if (r.none) { pinReset(); return showSetup(); }
    if (r.fails) pinMsg('Wrong PIN. ' + r.left + (r.left === 1 ? ' try' : ' tries') + ' left' + (r.left <= 5 ? ' before the app is reset on this device' : '') + '.', true);
    pinCheckWait();
  }).catch(function() { pinBusy = false; pinDots(); pinMsg('Something went wrong — try again.', true); });
}
// Set the PIN: encrypt the token with it, then remove the plain-text copy (js/lock.js lockCreate).
function pinSave(pin) {
  var purpose = pinPurpose, token = purpose === 'change' ? API_TOKEN : purpose === 'setup' ? pendingToken : localStorage.getItem(LOCK_PLAIN_TOKEN);
  if (!token) { pinReset(); pinPurpose = ''; return showSetup(); }
  pinBusy = true; pinMsg('Saving…');
  lockCreate(localStorage, pin, token, purpose === 'change' ? fxRates : null).then(function(made) {
    pinPurpose = '';
    if (purpose === 'change') {
      lockKey = made.key;
      pinReset(); hide('lock-screen');
      toast('PIN changed');
      return;
    }
    lockOpened(made.key, made.token, made.rates);
  }).catch(function() { pinBusy = false; showPin('new'); pinMsg('Could not save the PIN — try again.', true); });
}

// After wrong PINs: block the pad until the wait (stored in the vault, so it survives a reload) is over.
function pinCheckWait() {
  var vault = lockRead(localStorage);
  if (lockWaitMs(vault, Date.now()) <= 0) return;
  var padEl = document.getElementById('pin-pad');
  var tick = function() {
    var v = lockRead(localStorage), ms = lockWaitMs(v, Date.now());
    if (ms <= 0) {
      clearInterval(pinWaitTimer); pinWaitTimer = null; padEl.classList.remove('waiting');
      pinMsg(v ? lockTriesLeft(v) + ' tries left.' : '');
      return;
    }
    var s = Math.ceil(ms / 1000);
    pinMsg('Too many wrong PINs. Try again in ' + Math.floor(s / 60) + ':' + pad(s % 60) + ' · ' + lockTriesLeft(v) + ' tries left.', true);
  };
  clearInterval(pinWaitTimer);
  pinWaitTimer = setInterval(tick, 1000);
  padEl.classList.add('waiting');
  tick();
}
