// Wealth Planner — PIN lock: the crypto and the vault (no DOM here, so tests/lock.test.js can load it with vm).
// The access token (and the cached exchange rates) are kept encrypted in localStorage:
//   PBKDF2-SHA-256 (random 16-byte salt, LOCK_ITER rounds) turns the 6-digit PIN into an AES-GCM-256 key,
//   and every encryption uses a fresh random 12-byte IV.
// The key only ever lives in memory while the app is unlocked. The PIN is checked by decrypting the vault
// (GCM's auth tag fails for a wrong key): neither the PIN nor a hash of it is stored anywhere.
// The screens that use this are in js/lockscreen.js.
// Loaded as a plain <script> before core.js: functions are global.

var LOCK_KEY = 'wealthLock_v1';              // the vault: { v, it, salt, iv, ct, fails, failAt } (ct = the token)
var LOCK_RATES_KEY = 'wealthFxRates_v1';     // encrypted cache: { v, iv, ct } (ct = exchange rates JSON)
// Plain-text keys from before the lock. Removed once they are in the vault; never written again.
var LOCK_PLAIN_TOKEN = 'wealthToken', LOCK_PLAIN_RATES = 'wealthFxRates';
// 300k rounds: ~55 ms on a laptop, well under a second on an older phone (measured: see the pull request).
// Stored in the vault, so it can be raised later without locking anyone out.
var LOCK_ITER = 300000;
var LOCK_PIN_LEN = 6;
var LOCK_MAX_FAILS = 10;                     // the 10th wrong PIN wipes the vault
var LOCK_FREE_FAILS = 4;                     // tries 1–4 wrong: no wait; from the 5th: 30 s, 1 min, 2 min, 4 min, 8 min
var LOCK_AFTER_MS = 5 * 60 * 1000;           // auto-lock after this long in the background

function lockSupported() {
  return !!(typeof crypto !== 'undefined' && crypto && crypto.subtle && crypto.getRandomValues && typeof TextEncoder !== 'undefined');
}
function lockPinOk(pin) { return new RegExp('^\\d{' + LOCK_PIN_LEN + '}$').test(String(pin || '')); }

// ── bytes ↔ base64 ──
function lockB64(bytes) {
  bytes = new Uint8Array(bytes);
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function lockUnB64(str) {
  var s = atob(String(str || '')), out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function lockRandom(n) { return crypto.getRandomValues(new Uint8Array(n)); }

// ── crypto ──
// The key can't be exported: even code running in the page can only use it, not read it.
function lockDeriveKey(pin, salt, iterations) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']).then(function(base) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations || LOCK_ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}
// `label` is bound in as additional data, so a ciphertext can't be moved to another entry.
function lockEncrypt(key, text, label) {
  var iv = lockRandom(12);
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: new TextEncoder().encode(label || '') }, key,
    new TextEncoder().encode(String(text))).then(function(ct) {
    return { iv: lockB64(iv), ct: lockB64(ct) };
  });
}
// Rejects when the key is wrong or the entry was changed.
function lockDecrypt(key, box, label) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: lockUnB64(box.iv), additionalData: new TextEncoder().encode(label || '') }, key,
    lockUnB64(box.ct)).then(function(pt) { return new TextDecoder().decode(pt); });
}

// ── vault in storage (localStorage in the app, a fake in the tests) ──
function lockRead(storage) {
  try {
    var v = JSON.parse(storage.getItem(LOCK_KEY) || 'null');
    return v && v.v === 1 && v.salt && v.iv && v.ct ? v : null;
  } catch(e) { return null; }
}
function lockWrite(storage, vault) { storage.setItem(LOCK_KEY, JSON.stringify(vault)); }
function lockHasVault(storage) { return !!lockRead(storage); }

// Wait before the next try after `fails` wrong PINs: none for the first 4, then 30 s doubling.
function lockDelayMs(fails) { return fails > LOCK_FREE_FAILS ? 30000 * Math.pow(2, fails - LOCK_FREE_FAILS - 1) : 0; }
// How long until a PIN may be tried again. A clock set backwards doesn't shorten the wait.
function lockWaitMs(vault, now) {
  if (!vault || !vault.fails) return 0;
  var d = lockDelayMs(vault.fails), since = now - (vault.failAt || 0);
  if (since < 0) return d;
  return Math.max(0, d - since);
}
function lockTriesLeft(vault) { return LOCK_MAX_FAILS - ((vault && vault.fails) || 0); }

// Remove the vault and everything encrypted with it (and any old plain-text copies). The URL and the theme stay;
// nothing in Google Sheets is touched.
function lockWipe(storage) {
  [LOCK_KEY, LOCK_RATES_KEY, LOCK_PLAIN_TOKEN, LOCK_PLAIN_RATES].forEach(function(k) { storage.removeItem(k); });
}

// New vault for `token` under `pin`. Old plain-text rates are moved into the encrypted cache, then the plain-text
// copies are removed (only after the vault is written, so nothing is lost if this stops half way).
// Used for first-time setup, for the first run after the update (token from the old plain-text key) and for Change PIN.
// Resolves { key, token, rates }.
function lockCreate(storage, pin, token, rates) {
  if (!lockPinOk(pin)) return Promise.reject(new Error('PIN must be ' + LOCK_PIN_LEN + ' digits'));
  if (!token) return Promise.reject(new Error('no token'));
  if (!rates) { try { rates = JSON.parse(storage.getItem(LOCK_PLAIN_RATES) || 'null'); } catch(e) { rates = null; } }
  var salt = lockRandom(16), key;
  return lockDeriveKey(pin, salt, LOCK_ITER).then(function(k) {
    key = k;
    return lockEncrypt(key, token, LOCK_KEY);
  }).then(function(box) {
    lockWrite(storage, { v: 1, it: LOCK_ITER, salt: lockB64(salt), iv: box.iv, ct: box.ct, fails: 0, failAt: 0 });
    return lockSaveRates(storage, key, rates || {});
  }).then(function() {
    storage.removeItem(LOCK_PLAIN_TOKEN); storage.removeItem(LOCK_PLAIN_RATES);
    return { key: key, token: token, rates: rates || {} };
  });
}
// First run after the update: the token is still in plain text. Resolves like lockCreate, or null if there's none.
function lockMigrate(storage, pin) {
  var token = storage.getItem(LOCK_PLAIN_TOKEN);
  return token ? lockCreate(storage, pin, token) : Promise.resolve(null);
}

// Try a PIN. Resolves one of:
//   { ok: true, key, token, rates }
//   { ok: false, wait }                     still waiting after earlier wrong PINs (this try didn't count)
//   { ok: false, fails, left, wait }        wrong; `wait` ms before the next try
//   { ok: false, wiped: true }              that was the 10th wrong PIN: everything is wiped
//   { ok: false, none: true }               no vault
function lockUnlock(storage, pin, now) {
  var vault = lockRead(storage);
  if (!vault) return Promise.resolve({ ok: false, none: true });
  var wait = lockWaitMs(vault, now);
  if (wait > 0) return Promise.resolve({ ok: false, wait: wait });
  var key;
  return lockDeriveKey(pin, lockUnB64(vault.salt), vault.it || LOCK_ITER).then(function(k) {
    key = k;
    return lockDecrypt(key, vault, LOCK_KEY);
  }).then(function(token) {
    var v = lockRead(storage) || vault;
    if (v.fails) { v.fails = 0; v.failAt = 0; lockWrite(storage, v); }
    return lockLoadRates(storage, key).then(function(rates) { return { ok: true, key: key, token: token, rates: rates }; });
  }, function() {
    // Re-read so two tabs trying at once both count.
    var v = lockRead(storage) || vault;
    v.fails = (v.fails || 0) + 1; v.failAt = now;
    if (v.fails >= LOCK_MAX_FAILS) { lockWipe(storage); return { ok: false, wiped: true }; }
    lockWrite(storage, v);
    return { ok: false, fails: v.fails, left: lockTriesLeft(v), wait: lockDelayMs(v.fails) };
  });
}

// Replace the token in the vault (Settings → new access token), with the key already in memory.
function lockStoreToken(storage, key, token) {
  var vault = lockRead(storage);
  if (!vault) return Promise.reject(new Error('no vault'));
  return lockEncrypt(key, token, LOCK_KEY).then(function(box) {
    var v = lockRead(storage) || vault;
    v.iv = box.iv; v.ct = box.ct;
    lockWrite(storage, v);
  });
}

// ── encrypted cache: exchange rates ──
function lockSaveRates(storage, key, rates) {
  return lockEncrypt(key, JSON.stringify(rates || {}), LOCK_RATES_KEY).then(function(box) {
    storage.setItem(LOCK_RATES_KEY, JSON.stringify({ v: 1, iv: box.iv, ct: box.ct }));
  });
}
// Resolves the rates, or {} if there are none or they can't be read (they are only a suggestion for forms).
function lockLoadRates(storage, key) {
  var box;
  try { box = JSON.parse(storage.getItem(LOCK_RATES_KEY) || 'null'); } catch(e) { box = null; }
  if (!box || !box.iv || !box.ct) return Promise.resolve({});
  return lockDecrypt(key, box, LOCK_RATES_KEY).then(function(t) { return JSON.parse(t) || {}; }, function() { return {}; });
}
