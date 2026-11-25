#!/usr/bin/env node
// Browser check for the home screen and holding screens — not part of `npm test` (it needs Chromium + Playwright).
// Run from the repo root:   node tests/browser/screens.check.js [screenshot-dir]
// Serves the repo on localhost and stubs every Apps Script call (nothing reaches Google). Checks at 390px, light and
// dark, with no console errors: grouping by type / broker, folding a group, and that locking forgets it all.
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = process.argv[2] || '';
const FAKE_URL = 'https://script.google.com/macros/s/FAKE-FOR-TESTS/exec';
const TOKEN = 'tok-PLAINTEXT-screens';
const PIN = '123456';
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

// A holding as the backend sends it (only the fields the screens use)
function H(id, name, kind, qty, price, avg, txns, extra) {
  const inv = !['property', 'vehicle', 'electronics', 'other'].includes(kind);
  return Object.assign({ id, name, kind, group: inv ? 'investment' : 'asset', symbol: '', unit: inv ? 'units' : '', note: '', quantity: qty,
    value: qty * price, cost: qty * avg, unrealized: qty * (price - avg), realized: 0, dividends: 0, fees: 0, taxWithheld: 0, avgCost: avg,
    priced: true, currentPrice: price, priceDate: '2026-11-20', autoPrice: false, invested: qty * avg, proceeds: 0,
    firstDate: '2026-01-05', lastDate: '2026-01-05', txns }, extra || {});
}
const T = (id, type, date, quantity, price, account) => ({ id, type, date, quantity, price, amount: quantity * price, account, fee: 0, note: '' });
const holdings = [
  H('H1', 'PTT', 'stock', 100, 35, 30, [T('X1', 'buy', '2026-01-05', 100, 30, 'Kasikorn Securities')], { symbol: 'PTT.BK', unit: 'shares' }),
  // a tax fund: the 2016 lot is free since 2026-02-01, the 2026 lot is locked until 2036 (sales come from the oldest units first)
  H('H2', 'KFSSF', 'fund', 1000, 12, 11, [Object.assign(T('X3', 'buy', '2026-01-10', 600, 11, 'Kasikorn Securities'), { lockUntil: '2036-01-10' }),
    Object.assign(T('X2', 'buy', '2016-02-01', 400, 11, 'Finnomena'), { lockUntil: '2026-02-01' }),
    Object.assign(T('X8', 'sell', '2015-12-01', 50, 10, 'Kasikorn Securities'), { switchId: 'SW1', switchValue: 600 })],
    { lockedQty: 600, freeQty: 400, nextUnlock: { date: '2036-01-10', quantity: 600 },
      lots: [{ id: 'X2', date: '2016-02-01', quantity: 400, lockUntil: '2026-02-01', locked: false },
             { id: 'X3', date: '2026-01-10', quantity: 600, lockUntil: '2036-01-10', locked: true }] }),
  // switched in from KFSSF (cost carried over): SwitchId links both sides
  H('H6', 'SCBSSF', 'fund', 50, 12, 10, [Object.assign(T('X9', 'buy', '2015-12-01', 50, 10, 'Kasikorn Securities'), { switchId: 'SW1', switchValue: 600, lockUntil: '2030-06-15' })]),
  H('H3', 'Gold bar', 'gold', 1, 42000, 40000, [T('X4', 'buy', '2026-02-01', 1, 40000, '')], { unit: 'baht-weight' }),
  H('H4', 'Honda Jazz', 'vehicle', 1, 450000, 500000, [T('X5', 'buy', '2025-06-01', 1, 500000, '')]),
  H('H5', 'Sold out', 'stock', 0, 40, 0, [T('X7', 'sell', '2026-05-01', 10, 40, 'Kasikorn Securities'), T('X6', 'buy', '2026-01-02', 10, 30, 'Kasikorn Securities')],
    { realized: 100, invested: 300, proceeds: 400 }),
];
const total = holdings.reduce((a, h) => a + h.value, 0);
const bootstrap = {
  ok: true, prices: { last: '2026-11-20T07:00:00Z', daily: true },
  holdings: { ok: true, holdings, totals: { value: total, cost: 0, unrealized: 0, realized: 100, dividends: 0, investments: total - 450000, assets: 450000 } },
  portfolio: { ok: true, targets: {}, benchmarkSymbol: 'INDEXBKK:SET', benchmark: null, tradeCount: 0 },
  trades: [],
  brokers: { ok: true, flows: { status: 'ok', setUp: true },
    other: { name: 'Other assets', value: 492000, positions: [{ id: 'H3', quantity: 1 }, { id: 'H4', quantity: 1 }] },
    brokers: [
      { name: 'Finnomena', currency: 'THB', rate: 1, saved: true, dividendsTo: '', cash: 0, cashThb: 0, holdings: 4800, value: 4800, valueThb: 4800,
        positions: [{ id: 'H2', name: 'KFSSF', kind: 'fund', quantity: 400, valueThb: 4800 }], warnings: [] },
      { name: 'Kasikorn Securities', currency: 'THB', rate: 1, saved: true, dividendsTo: '', cash: 1000, cashThb: 1000, holdings: 10700, value: 11700, valueThb: 11700,
        positions: [{ id: 'H1', name: 'PTT', kind: 'stock', quantity: 100, valueThb: 3500 }, { id: 'H2', name: 'KFSSF', kind: 'fund', quantity: 600, valueThb: 7200 },
          { id: 'H6', name: 'SCBSSF', kind: 'fund', quantity: 50, valueThb: 600 }], warnings: [] },
    ] },
};

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { await fn(); results.push(name); console.log('✓ ' + name); };

  async function open(theme) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: theme });
    const page = await ctx.newPage();
    page.errors = []; page.calls = [];
    page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
    page.on('pageerror', e => page.errors.push(String(e)));
    await page.route(/script\.google(usercontent)?\.com/, async route => {
      const body = JSON.parse(route.request().postData() || '{}');
      page.calls.push(body);
      const ans = body.token !== TOKEN ? { ok: false, auth: true, error: 'unauthorized' }
        : body.action === 'bootstrap' ? bootstrap : { ok: true, updated: [], failed: [], rates: {} };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ans) });
    });
    await page.goto(BASE);
    await page.locator('#setup-screen').waitFor();
    await page.fill('#script-url-input', FAKE_URL);
    await page.fill('#script-token-input', TOKEN);
    await page.click('.setup-btn');
    for (const k of PIN + PIN) await page.keyboard.press(k);
    await page.locator('#holdings-section .hold-group').first().waitFor();
    return { ctx, page };
  }
  const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); };
  const groups = page => page.locator('#holdings-section .hold-group-name').allTextContents();
  const fits = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true, 'no sideways scroll at 390px');

  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await open(theme);
    await check(theme + ': grouped by type, in the agreed order, with value, P/L and count', async () => {
      assert.deepEqual((await groups(page)).map(t => t.replace(/^▾/, '').trim()), ['📈 Stocks 1', '🏦 Mutual funds 2', '🥇 Gold 1', '🚗 Vehicles 1']);
      const head = await page.locator('.hold-group-head').first().textContent();
      assert.match(head, /฿3,500/); assert.match(head, /\+฿500 \(\+16\.7%\)/);
      assert.equal(await page.locator('.hold-mode .type-tab.active').textContent(), 'Type');
      assert.match(await page.locator('#holdings-section').textContent(), /Closed positions.*Sold out/s, 'closed positions keep their own section');
      assert.equal(await page.locator('#header-total').textContent(), '฿' + (total + 1000).toLocaleString('th-TH'), 'totals at the top unchanged');
      await fits(page);
      await shot(page, 'group-type-' + theme, true);
    });
    await check(theme + ': fold a group, then switch to Broker (choice saved, fold state memory only)', async () => {
      await page.locator('.hold-group-head').first().click();
      assert.equal(await page.locator('.hold-group').first().evaluate(e => e.classList.contains('shut')), true);
      assert.equal(await page.locator('.hold-group').first().locator('.hold-card').isVisible(), false);
      assert.equal(await page.locator('.hold-group-head').first().getAttribute('aria-expanded'), 'false');
      await page.locator('.hold-mode .type-tab', { hasText: 'Broker' }).click();
      assert.deepEqual((await groups(page)).map(t => t.replace(/^▾/, '').trim()),
        ['🏦 Kasikorn Securities 3', '🏦 Finnomena 1', '📦 Other assets 2']);
      const ks = page.locator('.hold-group').first();
      assert.match(await ks.textContent(), /600 units of 1,000/, 'a split holding shows that broker\'s part');
      assert.match(await ks.locator('.hold-group-head').textContent(), /฿11,300/);
      await page.locator('.hold-group-head', { hasText: 'Finnomena' }).click();
      const store = await page.evaluate(() => JSON.stringify(localStorage));
      assert.equal(await page.evaluate(() => localStorage.getItem('wealthHoldGroup')), 'broker');
      assert.ok(!/Finnomena|Kasikorn|KFSSF/.test(store), 'no broker or holding names in localStorage');
      await fits(page);
      await shot(page, 'group-broker-' + theme, true);
    });
    await check(theme + ': holding detail shows locked and free units and each lot', async () => {
      await page.evaluate(() => openHolding('H2'));
      const box = await page.locator('#hd-body .lock-box').textContent();
      assert.match(box, /Locked: 600 units until 10 Jan 2036, free: 400 units\./);
      assert.match(box, /Bought 1 Feb 2016 · 400 left.*free since 1 Feb 2026/);
      assert.match(box, /Bought 10 Jan 2026 · 600 left.*until 10 Jan 2036/);
      assert.match(await page.locator('#hd-history').textContent(), /🔒 until 10 Jan 2036/);
      await fits(page);
      await page.waitForTimeout(450);
      await shot(page, 'lock-detail-' + theme);
    });
    await check(theme + ': sell more than the free units → a clear warning, but the sale can still be saved', async () => {
      await page.evaluate(() => openTrade('sell', 'H2'));
      assert.equal(await page.locator('#tr-lock-group').isVisible(), false, 'no "Locked until" on a sale');
      await page.fill('#tr-qty', '400');
      assert.equal(await page.locator('#tr-lock-warn').isVisible(), false, 'the 400 free (oldest) units: no warning');
      assert.match(await page.locator('#tr-hint').textContent(), /Locked: 600, free to sell: 400/);
      await page.fill('#tr-qty', '500');
      assert.equal(await page.locator('#tr-lock-warn').textContent(),
        '⚠ Selling 100 locked units: you may lose the tax benefit and have to pay it back. The next 600 unlock on 10 Jan 2036.');
      await page.fill('#tr-price', '12');
      await fits(page);
      await page.locator('#tr-lock-warn').scrollIntoViewIfNeeded(); await page.waitForTimeout(450);
      await shot(page, 'lock-sell-warn-' + theme);
      const n = page.calls.length;
      await page.click('#tr-save');
      await page.waitForFunction(() => !document.querySelector('#trade-modal.open'));
      const sent = page.calls.slice(n).find(c => c.action === 'addHoldingTxn');
      assert.equal(sent.type, 'sell'); assert.equal(sent.quantity, 500, 'not blocked');
      await page.evaluate(() => closeModal('holding-modal'));
    });
    await check(theme + ': buy form: "Locked until" with +10 / +8 / +5 years from the purchase date, or any date', async () => {
      await page.evaluate(() => openTrade('buy', 'H2'));
      assert.equal(await page.locator('#tr-lock-group').isVisible(), true);
      await page.fill('#tr-date', '2026-11-25'); await page.locator('#tr-date').dispatchEvent('change');
      await page.click('#tr-lock-quick >> text=+10 years');
      assert.equal(await page.inputValue('#tr-lock'), '2036-11-25');
      await page.fill('#tr-date', '2024-02-29'); await page.locator('#tr-date').dispatchEvent('change');
      assert.equal(await page.inputValue('#tr-lock'), '2034-02-28', 'follows the date; 29 Feb → 28 Feb');
      await page.click('#tr-lock-quick >> text=+5 years');
      assert.equal(await page.inputValue('#tr-lock'), '2029-02-28');
      await page.click('#tr-lock-quick >> text=+8 years');
      assert.equal(await page.locator('#tr-lock-quick .btn.active').textContent(), '+8 years');
      await page.fill('#tr-lock', '2031-12-31');
      assert.equal(await page.locator('#tr-lock-quick .btn.active').count(), 0, 'a typed date: no quick button lit');
      await page.fill('#tr-qty', '10'); await page.fill('#tr-price', '12');
      await fits(page);
      await shot(page, 'lock-buy-' + theme);
      const n = page.calls.length;
      await page.click('#tr-save');
      await page.locator('#trade-modal.open').waitFor({ state: 'detached' }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('#trade-modal.open'));
      const sent = page.calls.slice(n).find(c => c.action === 'addHoldingTxn');
      assert.equal(sent.lockUntil, '2031-12-31'); assert.equal(sent.date, '2024-02-29');
      await page.evaluate(() => { closeModal('holding-modal'); openTrade('buy', 'H4'); });
      assert.equal(await page.locator('#tr-lock-group').isVisible(), false, 'not for a car');
      await page.evaluate(() => { openTrade('sell', 'H2'); });
      await page.fill('#tr-qty', '900');
      assert.equal(await page.locator('#tr-lock-warn').isVisible(), true);
      await page.evaluate(() => closeModal('trade-modal'));
    });
    await check(theme + ': switch a fund: cost carried, lock dates carried oldest first, one action', async () => {
      await page.evaluate(() => openHolding('H2'));
      await page.locator('#hd-actions button', { hasText: 'Switch' }).click();
      assert.equal(await page.locator('#switch-modal').evaluate(e => e.classList.contains('open')), true);
      assert.equal(await page.inputValue('#sw-from'), 'H2');
      assert.equal(await page.locator('#sw-new').isVisible(), true, 'into a new fund by default');
      assert.equal(await page.inputValue('#sw-account'), 'Kasikorn Securities');
      await page.fill('#sw-out', '500'); await page.fill('#sw-in', '1000');
      const pv = await page.locator('#sw-preview').textContent();
      assert.match(pv, /Cost carried over: ฿5,500 \(avg ฿11 × 500\)\. No profit or loss is booked/);
      assert.match(pv, /400 units → 800 new\s*free/);
      assert.match(pv, /100 units → 200 new\s*🔒 until 10 Jan 2036/);
      await page.selectOption('#sw-to', 'H6');
      assert.equal(await page.locator('#sw-new').isVisible(), false);
      assert.equal(await page.locator('#sw-to option[value="H2"]').count(), 0, 'not into itself');
      await page.fill('#sw-value', '6100'); await page.fill('#sw-fee', '10');
      assert.match(await page.locator('#sw-preview').textContent(), /doesn't change except the fee/);
      await page.waitForTimeout(450);
      await fits(page);
      await page.locator('#sw-preview').scrollIntoViewIfNeeded();
      await shot(page, 'switch-form-' + theme);
      const n = page.calls.length;
      await page.click('#sw-save');
      await page.waitForFunction(() => !document.querySelector('#switch-modal.open'));
      const sent = page.calls.slice(n).find(c => c.action === 'addSwitch');
      assert.equal(sent.fromId, 'H2'); assert.equal(sent.toId, 'H6');
      assert.equal(sent.unitsOut, 500); assert.equal(sent.unitsIn, 1000); assert.equal(sent.value, 6100); assert.equal(sent.fee, 10);
      assert.equal(sent.account, 'Kasikorn Securities'); assert.match(sent.id, /^SW/);
    });
    await check(theme + ': history: "Switched to" / "Switched from" with what it was worth', async () => {
      await page.evaluate(() => openHolding('H6'));
      assert.match(await page.locator('#hd-history').textContent(), /Switched from KFSSF · 50 units · worth ฿600 · 🔒 until 15 Jun 2030/);
      await page.evaluate(() => openHolding('H2'));
      assert.match(await page.locator('#hd-history').textContent(), /Switched to SCBSSF · 50 units · worth ฿600/);
      let text = '';
      page.once('dialog', d => { text = d.message(); d.dismiss(); });
      await page.locator('#hd-history .hd-txn', { hasText: 'Switched to' }).locator('button').click();
      assert.match(text, /Delete this switch\? Both funds' entries are removed\./);
      await page.evaluate(() => closeModal('holding-modal'));
    });
    await check(theme + ': lock forgets the folded groups; the Type | Broker choice stays', async () => {
      await page.evaluate(() => openTrade('sell', 'H2'));
      await page.fill('#tr-qty', '900');
      await page.evaluate(() => lockNow());
      assert.deepEqual(await page.evaluate(() => holdCollapsed), {});
      assert.equal(await page.locator('#tr-lock-warn').textContent(), '', 'the sell warning is emptied');
      assert.equal(await page.locator('#sw-preview').textContent(), '', 'the switch preview is emptied');
      assert.equal(await page.locator('#sw-from option').count(), 0);
      assert.equal(await page.locator('#holdings-section').textContent().then(t => /Finnomena|KFSSF/.test(t)), false);
      for (const k of PIN) await page.keyboard.press(k);
      await page.locator('#holdings-section .hold-group').first().waitFor();
      assert.equal(await page.locator('.hold-mode .type-tab.active').textContent(), 'Broker');
      assert.equal(await page.locator('.hold-group.shut').count(), 0);
    });
    await check(theme + ': no console errors', async () => { assert.deepEqual(page.errors, []); });
    await ctx.close();
  }

  await browser.close(); srv.close();
  console.log('\n' + results.length + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
