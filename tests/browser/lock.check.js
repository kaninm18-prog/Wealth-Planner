#!/usr/bin/env node
// Browser check for the PIN lock — not part of `npm test` (it needs Chromium + Playwright, which CI doesn't have).
// Run from the repo root where Playwright is available:   node tests/browser/lock.check.js [screenshot-dir]
// It serves the repo on localhost, stubs every Apps Script call with page.route (nothing reaches Google),
// and walks through: first run → set PIN, reload → locked, wrong PINs, auto-lock, 10 wrong → wiped,
// Forgot PIN, Change PIN, keyboard, no Web Crypto, 390px light/dark, no console errors, Money Tracker keys untouched.
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || '';
const FAKE_URL = 'https://script.google.com/macros/s/FAKE-FOR-TESTS/exec';
const TOKEN = 'tok-PLAINTEXT-7c1e93';
const NAME = 'Gold bar FAKEHOLDING';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      rsp.end(fs.readFileSync(f));
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

const bootstrap = {
  ok: true, prices: { last: '2026-11-20T07:00:00Z', daily: true },
  holdings: { ok: true, totals: { value: 80000, cost: 70000, unrealized: 10000, realized: 0, dividends: 0, investments: 80000, assets: 0 },
    holdings: [{ id: 'H1', name: NAME, kind: 'gold', group: 'investment', symbol: '', unit: 'baht-weight', note: '', quantity: 2, value: 80000, cost: 70000,
      unrealized: 10000, realized: 0, dividends: 0, fees: 0, taxWithheld: 0, avgCost: 35000, priced: true, currentPrice: 40000, priceDate: '2026-11-20',
      autoPrice: false, invested: 70000, proceeds: 0, firstDate: '2026-01-05', lastDate: '2026-01-05',
      txns: [{ id: 'X1', type: 'buy', date: '2026-01-05', quantity: 2, price: 35000, amount: 70000, account: 'FakeBroker', fee: 0, note: '' }] }] },
  portfolio: { ok: true, targets: {}, benchmarkSymbol: 'INDEXBKK:SET', benchmark: null, tradeCount: 0 },
  trades: [],
  brokers: { ok: true, other: { positions: [] }, flows: { status: 'ok', setUp: true },
    brokers: [{ name: 'FakeBroker', currency: 'THB', rate: 1, saved: true, dividendsTo: '', note: '', opening: 0, cash: 5000, cashThb: 5000,
      holdings: 80000, holdingsThb: 80000, value: 85000, valueThb: 85000, deposits: 75000, withdrawals: 0, buys: 70000, sells: 0, fees: 0,
      dividends: 0, trades: 0, positions: [], warnings: [] }] }
};

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { await fn(); results.push(name); console.log('✓ ' + name); };

  async function newPage(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }, opts || {}));
    const page = await ctx.newPage();
    page.errors = []; page.calls = []; page.delay = 0;
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.on('pageerror', e => page.errors.push(String(e)));
    // A movable clock (Date.now only) to fake time spent in the background and the waits after wrong PINs.
    await page.addInitScript(() => {
      const real = Date.now.bind(Date); let off = 0;
      Date.now = () => real() + off;
      window.__advance = ms => { off += ms; };
    });
    await page.route(/script\.google(usercontent)?\.com/, async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      page.calls.push(body);
      if (page.delay) await new Promise(r => setTimeout(r, page.delay));
      const ans = body.token !== TOKEN ? { ok: false, auth: true, error: 'unauthorized' }
        : body.action === 'bootstrap' ? bootstrap : { ok: true, updated: [], failed: [], rates: { USD: 36.2 } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ans) }).catch(() => {});
    });
    return { ctx, page };
  }
  const visible = (page, sel) => page.locator(sel).isVisible();
  const storage = page => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  const tap = async (page, pin) => { for (const d of pin) await page.locator('#pin-pad .pin-key', { hasText: new RegExp('^' + d + '$') }).click(); };
  const type = async (page, pin) => { for (const d of pin) await page.keyboard.press(d); };
  const msg = page => page.locator('#lock-msg').textContent();
  const waitOpen = page => page.locator('#holdings-section', { hasText: NAME }).waitFor({ timeout: 5000 });
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const noSecretsAtRest = async page => {
    const s = await storage(page), all = Object.values(s).join('\n');
    assert.ok(!('wealthToken' in s) && !('wealthFxRates' in s), 'plain-text keys removed');
    for (const secret of [TOKEN, NAME, '123456', '36.1', 'FakeBroker']) assert.ok(!all.includes(secret), 'storage holds ' + secret);
    assert.equal(s.moneyToken, 'mt-fake-token', "Money Tracker's key untouched");
    assert.equal(s.moneyScriptUrl, 'https://example.invalid/mt', "Money Tracker's key untouched");
  };

  const { ctx, page } = await newPage();
  // Before the update: plain-text token and rates, plus Money Tracker's keys on the same origin.
  await page.goto(BASE + 'manifest.json');
  await page.evaluate(([url, tok]) => {
    localStorage.setItem('moneyToken', 'mt-fake-token'); localStorage.setItem('moneyScriptUrl', 'https://example.invalid/mt');
    localStorage.setItem('wealthScriptUrl', url); localStorage.setItem('wealthToken', tok); localStorage.setItem('wealthFxRates', '{"USD":36.1}');
  }, [FAKE_URL, TOKEN]);
  await page.goto(BASE);

  await check('first run after the update asks to set a PIN, with no skip, before any request', async () => {
    await page.locator('#lock-screen').waitFor();
    assert.equal(await page.locator('#lock-title').textContent(), 'Set a PIN');
    assert.equal(await visible(page, '#lock-cancel'), false);
    assert.equal(await visible(page, '#lock-forgot'), false);
    assert.equal(await visible(page, '#app'), false);
    assert.equal(page.calls.length, 0);
    await shot(page, 'set-pin-light');
  });
  await check('set PIN (enter + confirm, mismatch first) → unlocked; nothing secret left in localStorage', async () => {
    await tap(page, '123456'); await tap(page, '999999');
    assert.match(await msg(page), /didn.t match/);
    await tap(page, '123456'); await tap(page, '123456');
    await waitOpen(page);
    assert.equal(page.calls[0].token, TOKEN, 'the decrypted token is sent');
    await noSecretsAtRest(page);
    const s = await storage(page);
    assert.ok(s.wealthLock_v1 && s.wealthFxRates_v1 && s.wealthScriptUrl === FAKE_URL);
    assert.deepEqual(await page.evaluate(() => savedRates()), { USD: 36.1 }, 'old rates moved into the encrypted cache');
    await shot(page, 'app-light');
  });
  await check('rates saved by "Refresh prices" are encrypted', async () => {
    await page.evaluate(() => saveRates({ USD: 36.2 }));
    await page.waitForFunction(() => true);
    await page.waitForTimeout(200);
    const s = await storage(page);
    assert.ok(!s.wealthFxRates_v1.includes('36.2'));
  });
  await check('reload → locked, no request until the PIN', async () => {
    page.calls.length = 0;
    await page.reload();
    await page.locator('#lock-screen').waitFor();
    assert.equal(await page.locator('#lock-title').textContent(), 'Enter your PIN');
    assert.equal(await visible(page, '#lock-forgot'), true);
    assert.equal(await visible(page, '#app'), false);
    assert.equal(await page.locator('body').textContent().then(t => t.includes(NAME)), false);
    assert.equal(page.calls.length, 0);
    await shot(page, 'locked-light');
  });
  await check('wrong PIN ×3 (laptop keyboard, with Backspace) then the right one', async () => {
    for (let i = 1; i <= 3; i++) {
      await type(page, '00000'); await page.keyboard.press('9'); await page.locator('#lock-msg', { hasText: 'Wrong PIN' }).waitFor();
      assert.match(await msg(page), new RegExp((10 - i) + ' tries left'));
    }
    await type(page, '12345'); await page.keyboard.press('7'); // 6 digits → submits; wrong (4th)
    await page.locator('#lock-msg', { hasText: '6 tries left' }).waitFor();
    await type(page, '12345'); await page.keyboard.press('Backspace');   // not submitted: 4 digits after Backspace
    await type(page, '56'); // now 123456
    await waitOpen(page);
    const v = JSON.parse((await storage(page)).wealthLock_v1);
    assert.equal(v.fails, 0, 'the right PIN resets the count');
  });
  await check('hidden < 5 minutes → still open; hidden ≥ 5 minutes → locked and cleared', async () => {
    const away = ms => page.evaluate(ms => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__advance(ms);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    }, ms);
    await page.evaluate(() => openHolding('H1'));
    await away(4 * 60 * 1000);
    assert.equal(await visible(page, '#app'), true);
    await away(5 * 60 * 1000 + 1000);
    assert.equal(await visible(page, '#lock-screen'), true);
    assert.equal(await visible(page, '#app'), false);
    const state = await page.evaluate(() => ({ key: lockKey, tok: API_TOKEN, n: holdings.length, b: brokerData, rates: savedRates(),
      open: document.querySelectorAll('.modal-overlay.open').length, html: document.getElementById('app').innerHTML + document.getElementById('holding-modal').innerHTML }));
    assert.deepEqual([state.key, state.tok, state.n, state.b, state.open], [null, '', 0, null, 0]);
    assert.deepEqual(state.rates, {});
    assert.ok(!state.html.includes(NAME) && !state.html.includes('FakeBroker') && !state.html.includes('80,000'), 'data cleared from the page');
  });
  await check('an answer that arrives after locking is not shown', async () => {
    await tap(page, '123456'); await waitOpen(page);
    page.delay = 1500;
    await page.evaluate(() => { loadAll(); refreshPricesNow(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => lockNow());
    await page.waitForTimeout(2000);
    page.delay = 0;
    const html = await page.locator('body').innerHTML();
    assert.ok(!html.includes(NAME));
    assert.equal(await page.locator('#toast.show').count(), 0, 'no toast on the lock screen');
    assert.equal(await page.evaluate(() => loaded), false);
  });
  await check('5 wrong → 30 s wait (kept over a reload) with tries left shown', async () => {
    for (let i = 0; i < 5; i++) { await tap(page, '000000'); await page.waitForFunction(() => !pinBusy); }
    assert.match(await msg(page), /Try again in 0:(30|29) · 5 tries left/);
    await type(page, '123456');     // ignored while waiting (the buttons can't be pressed either)
    await page.waitForTimeout(300);
    assert.equal(await visible(page, '#app'), false, 'the pad is blocked while waiting');
    assert.equal(JSON.parse((await storage(page)).wealthLock_v1).fails, 5, 'tries while waiting are not counted');
    await page.reload(); await page.locator('#lock-screen').waitFor();
    assert.match(await msg(page), /Try again in 0:\d\d · 5 tries left/);
    await shot(page, 'wait-light');
  });
  await check('10 wrong → vault and cache wiped, back to setup; URL and Money Tracker keys kept', async () => {
    for (let i = 6; i <= 10; i++) {
      await page.evaluate(() => window.__advance(10 * 60 * 1000));
      await page.waitForTimeout(1100);       // the countdown ticks and frees the pad
      await tap(page, '000000'); await page.waitForFunction(() => !pinBusy);
    }
    await page.locator('#setup-screen').waitFor();
    const s = await storage(page);
    assert.ok(!s.wealthLock_v1 && !s.wealthFxRates_v1 && !s.wealthToken);
    assert.equal(s.wealthScriptUrl, FAKE_URL);
    assert.equal(await page.locator('#script-url-input').inputValue(), FAKE_URL);
    assert.equal(s.moneyToken, 'mt-fake-token');
    assert.equal(await page.locator('#toast.show').textContent().then(t => /10 wrong PINs/.test(t)), true);
  });
  await check('first-time setup: URL + token, then set a PIN (cancel goes back)', async () => {
    await page.reload(); await page.locator('#setup-screen').waitFor();
    await page.fill('#script-token-input', TOKEN);
    await page.click('.setup-btn');
    assert.equal(await page.locator('#lock-title').textContent(), 'Set a PIN');
    await page.keyboard.press('Escape');
    await page.locator('#setup-screen').waitFor();
    assert.equal(await page.locator('#script-token-input').inputValue(), '');
    await page.fill('#script-token-input', TOKEN); await page.click('.setup-btn');
    await type(page, '246810'); await type(page, '246810');
    await waitOpen(page);
    await noSecretsAtRest(page);
  });
  await check('Change PIN: needs the current PIN; old PIN stops working, new one opens', async () => {
    await page.evaluate(() => saveRates({ USD: 36.3 })); await page.waitForTimeout(200);
    await page.click('.header-settings-btn');
    assert.equal(await page.locator('#settings-token').inputValue(), '', 'the token is never put back in the page');
    await page.getByText('Change PIN').click();
    assert.equal(await page.locator('#lock-title').textContent(), 'Current PIN');
    await tap(page, '111111'); await page.locator('#lock-msg', { hasText: 'Wrong PIN' }).waitFor();
    await tap(page, '246810'); await page.locator('#lock-title', { hasText: 'New PIN' }).waitFor();
    await tap(page, '975310'); await tap(page, '975310');
    await page.locator('#toast.show', { hasText: 'PIN changed' }).waitFor();
    assert.equal(await visible(page, '#app'), true);
    await noSecretsAtRest(page);
    await page.reload(); await page.locator('#lock-screen').waitFor();
    await type(page, '246810'); await page.locator('#lock-msg', { hasText: 'Wrong PIN' }).waitFor();
    await type(page, '975310'); await waitOpen(page);
    assert.deepEqual(await page.evaluate(() => savedRates()), { USD: 36.3 }, 'the encrypted cache moved to the new PIN');
  });
  await check('Settings → new token is re-encrypted; empty keeps the saved one', async () => {
    const iv0 = JSON.parse((await storage(page)).wealthLock_v1).iv;
    await page.click('.header-settings-btn'); await page.click('#settings-modal button.btn-primary');
    await page.locator('#toast.show', { hasText: 'Connection saved' }).waitFor();
    assert.equal(page.calls[page.calls.length - 1].token, TOKEN);
    assert.equal(JSON.parse((await storage(page)).wealthLock_v1).iv, iv0, 'empty field: token unchanged');
    await page.click('.header-settings-btn'); await page.fill('#settings-token', TOKEN); await page.click('#settings-modal button.btn-primary');
    await page.locator('#toast.show', { hasText: 'Connection saved' }).waitFor();
    assert.notEqual(JSON.parse((await storage(page)).wealthLock_v1).iv, iv0, 'typed token: re-encrypted');
    assert.equal(await page.locator('#settings-token').inputValue(), '');
    await noSecretsAtRest(page);
  });
  await check('Forgot PIN: cancel keeps it; confirm wipes and goes to setup', async () => {
    await page.reload(); await page.locator('#lock-screen').waitFor();
    page.once('dialog', d => d.dismiss());
    await page.click('#lock-forgot');
    assert.ok((await storage(page)).wealthLock_v1);
    let text = '';
    page.once('dialog', d => { text = d.message(); d.accept(); });
    await page.click('#lock-forgot');
    await page.locator('#setup-screen').waitFor();
    assert.match(text, /Google Sheets is not touched/);
    const s = await storage(page);
    assert.ok(!s.wealthLock_v1 && !s.wealthFxRates_v1);
    assert.equal(s.moneyToken, 'mt-fake-token');
  });
  await check('dark theme at 390px', async () => {
    await page.evaluate(() => localStorage.setItem('wealthThemePref', 'dark'));
    await page.reload(); await page.locator('#setup-screen').waitFor();     // the theme is applied on load
    await page.fill('#script-token-input', TOKEN); await page.click('.setup-btn');
    await shot(page, 'set-pin-dark');
    await type(page, '123456'); await type(page, '123456'); await waitOpen(page);
    await shot(page, 'app-dark');
    await page.reload(); await page.locator('#lock-screen').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    await type(page, '000000'); await page.locator('#lock-msg', { hasText: 'Wrong PIN' }).waitFor();
    assert.equal(await page.locator('#pin-dots span.on').count(), 0, 'dots empty again after a wrong PIN');
    await page.waitForTimeout(300);     // let the dots' fade finish before the screenshot
    await shot(page, 'locked-dark');
    const box = await page.locator('#pin-pad').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'keypad fits at 390px');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true, 'no sideways scroll');
  });
  await check('no console errors', async () => { assert.deepEqual(page.errors, []); });
  await ctx.close();

  await check('no Web Crypto → a clear message, never opens unprotected', async () => {
    const { ctx: c2, page: p2 } = await newPage();
    await p2.addInitScript(() => { Object.defineProperty(window.crypto, 'subtle', { configurable: true, get: () => undefined }); });
    await p2.goto(BASE + 'manifest.json');
    await p2.evaluate(([url, tok]) => { localStorage.setItem('wealthScriptUrl', url); localStorage.setItem('wealthToken', tok); }, [FAKE_URL, TOKEN]);
    await p2.goto(BASE);
    await p2.locator('#nocrypto-screen').waitFor();
    assert.equal(await visible(p2, '#app'), false);
    assert.equal(await visible(p2, '#lock-screen'), false);
    assert.equal(p2.calls.length, 0);
    await shot(p2, 'nocrypto');
    await c2.close();
  });

  await check('unlock time with the CPU slowed 6× (PBKDF2 300k)', async () => {
    const { ctx: c3, page: p3 } = await newPage();
    await p3.goto(BASE);
    const cdp = await c3.newCDPSession(p3);
    const t = async () => p3.evaluate(() => { const t0 = performance.now(); return lockDeriveKey('123456', lockRandom(16), LOCK_ITER).then(() => performance.now() - t0); });
    const normal = await t();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const slow = await t();
    console.log('   derive: ' + Math.round(normal) + ' ms normal, ' + Math.round(slow) + ' ms at 6× slower CPU');
    await c3.close();
  });

  await browser.close(); srv.close();
  console.log('\n' + results.length + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
