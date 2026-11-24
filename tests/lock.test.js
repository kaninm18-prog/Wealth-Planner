// PIN lock: js/lock.js loaded with vm (as the browser loads it: plain script, global functions),
// against a fake localStorage. Node 22 has WebCrypto (globalThis.crypto.subtle), the same API the browser uses.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'lock.js'), 'utf8');

function load() {
  const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: 'js/lock.js' });
  ctx.LOCK_ITER = 1000;            // the real count is slow on purpose; the tests check the stored count is used
  return ctx;
}
function fakeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    keys: () => Array.from(m.keys()).sort(),
    dump: () => Array.from(m.values()).join('\n'),
  };
}
const TOKEN = 'tok-3f9a1c7e5b2d4e8f';
const PIN = '482916';

test('lock: real iteration count is at least 210,000', () => {
  const m = code.match(/var LOCK_ITER = (\d+);/);
  assert.ok(m && +m[1] >= 210000, 'LOCK_ITER must stay >= 210000');
});

test('lock: set a PIN, then unlock with it (round trip)', async () => {
  const L = load(), s = fakeStorage({ wealthScriptUrl: 'https://example.invalid/exec' });
  const made = await L.lockCreate(s, PIN, TOKEN);
  assert.equal(made.token, TOKEN);
  const r = await L.lockUnlock(s, PIN, 1000);
  assert.equal(r.ok, true);
  assert.equal(r.token, TOKEN);
  assert.equal(s.getItem('wealthScriptUrl'), 'https://example.invalid/exec', 'the URL stays as it was');
});

test('lock: a wrong PIN fails and is counted', async () => {
  const L = load(), s = fakeStorage();
  await L.lockCreate(s, PIN, TOKEN);
  const r = await L.lockUnlock(s, '000000', 1000);
  assert.equal(r.ok, false);
  assert.equal(r.fails, 1);
  assert.equal(r.left, 9);
  assert.equal(r.wait, 0);
  assert.equal(r.token, undefined);
  assert.equal(L.lockRead(s).fails, 1, 'the count is stored in the vault, so a reload does not reset it');
});

test('lock: every encryption uses a new IV (and a new salt per vault)', async () => {
  const L = load();
  const key = await L.lockDeriveKey(PIN, L.lockRandom(16), 1000);
  const a = await L.lockEncrypt(key, 'same text', 'x'), b = await L.lockEncrypt(key, 'same text', 'x');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
  assert.equal(Buffer.from(a.iv, 'base64').length, 12);
  const s1 = fakeStorage(), s2 = fakeStorage();
  await L.lockCreate(s1, PIN, TOKEN); await L.lockCreate(s2, PIN, TOKEN);
  const v1 = L.lockRead(s1), v2 = L.lockRead(s2);
  assert.notEqual(v1.salt, v2.salt);
  assert.equal(Buffer.from(v1.salt, 'base64').length, 16);
  assert.notEqual(v1.iv, v2.iv);
  // replacing the token re-encrypts with a new IV
  const r = await L.lockUnlock(s1, PIN, 0);
  await L.lockStoreToken(s1, r.key, TOKEN);
  assert.notEqual(L.lockRead(s1).iv, v1.iv);
  assert.equal((await L.lockUnlock(s1, PIN, 0)).token, TOKEN);
});

test('lock: storage never holds the PIN or the token in plain text', async () => {
  const L = load(), s = fakeStorage({ wealthToken: TOKEN, wealthFxRates: '{"USD":36.55}' });
  await L.lockMigrate(s, PIN);
  const all = s.dump();
  assert.ok(all.length > 0);
  [TOKEN, PIN, '36.55'].forEach(secret => {
    assert.ok(!all.includes(secret), 'found ' + secret + ' in storage');
    assert.ok(!all.includes(Buffer.from(secret).toString('base64')), 'found base64 of ' + secret);
  });
  const vault = L.lockRead(s);
  assert.deepEqual(Object.keys(vault).sort(), ['ct', 'failAt', 'fails', 'it', 'iv', 'salt', 'v']);
  // the stored iteration count is the one used
  assert.equal(vault.it, 1000);
});

test('lock: the vault and the cache cannot be swapped or edited', async () => {
  const L = load(), s = fakeStorage({ wealthFxRates: '{"USD":36}' });
  await L.lockCreate(s, PIN, TOKEN);
  const v = L.lockRead(s), rates = JSON.parse(s.getItem('wealthFxRates_v1'));
  // the rates entry put in the token's place doesn't decrypt (different label)
  L.lockWrite(s, Object.assign({}, v, { iv: rates.iv, ct: rates.ct }));
  assert.equal((await L.lockUnlock(s, PIN, 0)).ok, false);
  // one flipped byte fails too
  const ct = Buffer.from(v.ct, 'base64'); ct[0] ^= 1;
  L.lockWrite(s, Object.assign({}, v, { ct: ct.toString('base64'), fails: 0 }));
  assert.equal((await L.lockUnlock(s, PIN, 0)).ok, false);
});

test('lock: delay schedule — none for 4 wrong PINs, then 30 s doubling', () => {
  const L = load();
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(L.lockDelayMs),
    [0, 0, 0, 0, 0, 30000, 60000, 120000, 240000, 480000]);
  assert.equal(L.lockWaitMs({ fails: 5, failAt: 1000 }, 1000), 30000);
  assert.equal(L.lockWaitMs({ fails: 5, failAt: 1000 }, 21000), 10000);
  assert.equal(L.lockWaitMs({ fails: 5, failAt: 1000 }, 31000), 0);
  assert.equal(L.lockWaitMs({ fails: 5, failAt: 100000 }, 5000), 30000, 'a clock set backwards does not skip the wait');
});

test('lock: wrong PINs wait, survive a reload, and the 10th wipes everything', async () => {
  const L = load();
  const s = fakeStorage({ wealthScriptUrl: 'https://example.invalid/exec', wealthThemePref: 'dark', moneyToken: 'mt-secret' });
  await L.lockCreate(s, PIN, TOKEN, { USD: 36 });
  let now = 1e9, r;
  for (let i = 1; i <= 4; i++) {
    r = await L.lockUnlock(s, '111111', now);
    assert.equal(r.fails, i); assert.equal(r.wait, 0); assert.equal(r.left, 10 - i);
  }
  r = await L.lockUnlock(s, '111111', now);
  assert.deepEqual([r.fails, r.left, r.wait], [5, 5, 30000]);
  // while waiting, even the right PIN isn't tried and nothing is counted
  r = await L.lockUnlock(s, PIN, now + 29000);
  assert.equal(r.ok, false); assert.equal(r.wait, 1000); assert.equal(r.fails, undefined);
  // a "reload": a fresh copy of the code reading the same storage still waits
  const L2 = load();
  assert.equal(L2.lockWaitMs(L2.lockRead(s), now + 29000), 1000);
  for (let i = 6; i <= 9; i++) {
    now += 10 * 60 * 1000;
    r = await L2.lockUnlock(s, '222222', now);
    assert.equal(r.fails, i); assert.equal(r.left, 10 - i);
  }
  now += 10 * 60 * 1000;
  r = await L2.lockUnlock(s, '333333', now);
  assert.equal(r.wiped, true);
  assert.equal(L2.lockRead(s), null);
  assert.deepEqual(s.keys(), ['moneyToken', 'wealthScriptUrl', 'wealthThemePref'],
    'the vault and the encrypted cache are gone; the URL, theme and Money Tracker keys stay');
  assert.equal(s.getItem('moneyToken'), 'mt-secret');
  r = await L2.lockUnlock(s, PIN, now);
  assert.equal(r.none, true);
});

test('lock: the right PIN resets the count', async () => {
  const L = load(), s = fakeStorage();
  await L.lockCreate(s, PIN, TOKEN);
  await L.lockUnlock(s, '000000', 0); await L.lockUnlock(s, '000001', 0); await L.lockUnlock(s, '000002', 0);
  assert.equal(L.lockRead(s).fails, 3);
  const r = await L.lockUnlock(s, PIN, 0);
  assert.equal(r.ok, true);
  assert.equal(L.lockRead(s).fails, 0);
});

test('lock: migration from a plain-text token (and rates)', async () => {
  const L = load();
  const s = fakeStorage({ wealthScriptUrl: 'https://example.invalid/exec', wealthToken: TOKEN, wealthFxRates: '{"USD":36.5,"EUR":39}' });
  const made = await L.lockMigrate(s, PIN);
  assert.equal(made.token, TOKEN);
  assert.deepEqual(s.keys(), ['wealthFxRates_v1', 'wealthLock_v1', 'wealthScriptUrl']);
  const r = await L.lockUnlock(s, PIN, 0);
  assert.equal(r.token, TOKEN);
  assert.deepEqual(JSON.parse(JSON.stringify(r.rates)), { USD: 36.5, EUR: 39 });
  // nothing to migrate
  assert.equal(await L.lockMigrate(fakeStorage(), PIN), null);
});

test('lock: Change PIN — a new vault under the new PIN, the old PIN stops working', async () => {
  const L = load(), s = fakeStorage();
  await L.lockCreate(s, PIN, TOKEN, { USD: 36 });
  const old = await L.lockUnlock(s, PIN, 0);
  await L.lockCreate(s, '135790', old.token, old.rates);
  assert.equal((await L.lockUnlock(s, PIN, 0)).ok, false);
  const r = await L.lockUnlock(s, '135790', 0);
  assert.equal(r.token, TOKEN);
  assert.equal(r.rates.USD, 36);
});

test('lock: PINs must be 6 digits', async () => {
  const L = load();
  ['12345', '1234567', 'abcdef', '', null].forEach(p => assert.equal(L.lockPinOk(p), false));
  assert.equal(L.lockPinOk('012345'), true);
  await assert.rejects(L.lockCreate(fakeStorage(), '1234', TOKEN));
});

test('lock: rates cache — saved encrypted, unreadable without the key', async () => {
  const L = load(), s = fakeStorage();
  const made = await L.lockCreate(s, PIN, TOKEN);
  await L.lockSaveRates(s, made.key, { USD: 35.9 });
  assert.ok(!s.getItem('wealthFxRates_v1').includes('35.9'));
  assert.equal((await L.lockLoadRates(s, made.key)).USD, 35.9);
  const other = await L.lockDeriveKey('999999', L.lockRandom(16), 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(await L.lockLoadRates(s, other))), {});
});

test('lock: wiring — lock.js loads before core.js, the service worker caches it, nothing writes the plain token', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const order = (html.match(/<script src="js\/[^"]+"/g) || []).map(s => s.slice(13, -1));
  assert.ok(order.indexOf('js/lock.js') >= 0 && order.indexOf('js/lock.js') < order.indexOf('js/core.js'), 'lock.js before core.js');
  assert.ok(order.indexOf('js/lockscreen.js') > order.indexOf('js/core.js'), 'lockscreen.js after core.js');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const shell = (sw.match(/var SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
  order.forEach(f => assert.ok(shell.includes("'./" + f + "'"), 'sw.js SHELL is missing ' + f));
  shell.match(/'\.\/[^']+'/g).forEach(f => {
    const p = f.slice(3, -1);
    if (p) assert.ok(fs.existsSync(path.join(root, p)), 'sw.js SHELL lists a missing file: ' + p);
  });
  const js = fs.readdirSync(path.join(root, 'js')).map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');
  assert.ok(!/setItem\(\s*['"]wealthToken['"]/.test(js) && !/setItem\(\s*LOCK_PLAIN_TOKEN/.test(js), 'the token is never written in plain text');
  assert.ok(!/setItem\(\s*['"]wealthFxRates['"]/.test(js), 'rates are never written in plain text');
  assert.ok(!/console\.(log|info|debug|warn|error)\(/.test(js), 'no console logging in the front end (PIN, token, key)');
  // Every key this app writes starts with "wealth" (Money Tracker shares the origin)
  (js.match(/var LOCK_[A-Z_]*KEY = '[^']+'/g) || []).forEach(m => assert.match(m, /'wealth/));
});
