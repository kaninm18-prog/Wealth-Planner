// Holdings and prices, ported from Money Tracker (Stage 4, step 3a). These are Money Tracker's
// tests/holdings.test.js with the account-balance, Expenses and Income checks taken out:
// this app has no accounts, and fees/dividends stay in HoldingTxns (plan D2/D3). Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend();
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const rows = name => (b.sheets[name] ? b.sheets[name].rows.slice(1) : []);
  // first buy creates the holding
  const buyNew = (name, kind, qty, price, account, date, extra) => b.api(Object.assign({ action: 'addHoldingTxn', type: 'buy',
    holding: { name, kind }, quantity: qty, price, account, date }, extra || {}));
  return { api: b.api, context: b.context, sheets: b.sheets, holding, rows, buyNew };
}

test('tabs have Money Tracker\'s columns, so they can be copied across as they are (HoldingTxns adds FeeOrig, TaxOrig at the end)', () => {
  const { api, sheets, buyNew } = setup();
  buyNew('PTT', 'stock', 1, 30, 'Broker', '2026-01-10');
  api({ action: 'setTargets', targets: { Gold: 20 } });
  assert.deepEqual([...sheets.Holdings.rows[0]], ['Id', 'Name', 'Kind', 'Symbol', 'Unit', 'CurrentPrice', 'PriceDate', 'Note', 'Status',
    'QuoteCurrency', 'NextXD', 'NextDividend']);
  assert.deepEqual([...sheets.HoldingTxns.rows[0]], ['Id', 'HoldingId', 'Date', 'Type', 'Quantity', 'Price', 'Amount', 'Fee', 'Account', 'Note',
    'LinkedId', 'OrigAmount', 'Currency', 'FeeOrig', 'TaxOrig']);
  assert.deepEqual([...sheets.AllocationTargets.rows[0]], ['Class', 'TargetPct']);
});

test('average cost, realised and unrealised; latest trade price becomes the current price', () => {
  const { api, holding, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  assert.ok(r.ok);
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 100, price: 40, account: 'Broker', date: '2026-02-10' });
  let h = holding('PTT');
  assert.equal(h.quantity, 200);
  near(h.cost, 7000); near(h.avgCost, 35);
  near(h.currentPrice, 40, 'latest trade price becomes the current price');
  near(h.value, 8000); near(h.unrealized, 1000);
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 50, price: 50, account: 'Broker', date: '2026-03-10' });
  h = holding('PTT');
  assert.equal(h.quantity, 150);
  near(h.cost, 5250, 'sold units leave at average cost');
  near(h.realized, 750);
  near(h.value, 7500); near(h.unrealized, 2250);
  near(h.invested, 7000); near(h.proceeds, 2500);
  assert.equal(h.firstDate, '2026-01-10'); assert.equal(h.lastDate, '2026-03-10');
});

test('an older trade does not overwrite a newer hand-set price', () => {
  const { api, holding, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  api({ action: 'updateHolding', id: r.holdingId, currentPrice: 33, priceDate: '2026-03-01' });
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 10, price: 31, account: 'Broker', date: '2026-02-01' });
  const h = holding('PTT');
  near(h.currentPrice, 33); assert.equal(h.priceDate, '2026-03-01');
});

test('quantity is rounded to 6 decimals; selling everything clears the cost', () => {
  const { api, holding, buyNew } = setup();
  const r = buyNew('BTC', 'crypto', 0.1, 1000000, 'Broker', '2026-01-10');
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 0.2, price: 1000000, account: 'Broker', date: '2026-01-11' });
  assert.equal(holding('BTC').quantity, 0.3, '0.1 + 0.2 is shown as 0.3');
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 0.3, price: 1100000, account: 'Broker', date: '2026-01-12' });
  const h = holding('BTC');
  assert.equal(h.quantity, 0); near(h.cost, 0); near(h.realized, 30000);
});

test('cannot sell more than you hold, or delete a buy a later sale needs', () => {
  const { api, holding, buyNew } = setup();
  const r = buyNew('Gold', 'gold', 2, 40000, 'Broker', '2026-01-10');
  const bad = api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 3, price: 41000, account: 'Broker', date: '2026-01-11' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /only hold 2/);
  assert.equal(holding('Gold').quantity, 2);
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 1, price: 41000, account: 'Broker', date: '2026-01-12' });
  const del = api({ action: 'deleteHoldingTxn', id: r.id });
  assert.equal(del.ok, false);
  assert.equal(holding('Gold').quantity, 1);
});

test('something you already owned: no account needed, but a fee needs one', () => {
  const { holding, buyNew } = setup();
  const r = buyNew('Car', 'vehicle', 1, 500000, '', '2026-01-10');
  assert.ok(r.ok);
  assert.equal(holding('Car').group, 'asset');
  const fee = buyNew('Watch', 'electronics', 1, 10000, '', '2026-01-10', { fee: 100 });
  assert.equal(fee.ok, false, 'a fee needs an account');
});

test('a fee stays in the Fee column; deleting the trade removes it', () => {
  const { api, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10', { fee: 15 });
  const tx = rows('HoldingTxns');
  assert.equal(tx.length, 1);
  assert.equal(tx[0][7], 15, 'Fee');
  assert.equal(tx[0][8], 'Broker', 'Account is the broker name');
  assert.equal(tx[0][10], '', 'LinkedId stays empty');
  const h = api({ action: 'getHoldings' }).holdings[0];
  near(h.fees, 15); near(h.cost, 3000, 'the fee is not added to the cost');
  assert.ok(api({ action: 'deleteHoldingTxn', id: r.id }).ok);
  assert.equal(rows('HoldingTxns').length, 0);
});

test('dividends: tax withheld is recorded in Fee; quantity unchanged; a dividend needs an account', () => {
  const { api, holding, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  const d = api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 90, tax: 10, account: 'Broker', date: '2026-04-20' });
  assert.ok(d.ok);
  const row = rows('HoldingTxns').find(t => t[0] === d.id);
  assert.equal(row[3], 'dividend'); assert.equal(row[4], '', 'no quantity on a dividend');
  assert.equal(row[6], 90); assert.equal(row[7], 10, 'tax withheld'); assert.equal(row[10], '');
  const h = holding('PTT');
  assert.equal(h.quantity, 100);
  near(h.dividends, 90); near(h.taxWithheld, 10); near(h.fees, 0);
  near(h.currentPrice, 30, 'a dividend does not change the price');
  const noAcc = api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 5, date: '2026-04-21' });
  assert.equal(noAcc.ok, false, 'a dividend needs an account');
});

test('fees and dividends write to no tab other than Holdings and HoldingTxns', () => {
  const { api, sheets, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10', { fee: 15, origAmount: 90, currency: 'USD', feeOrig: 0.45 });
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 10, price: 35, fee: 5, account: 'Broker', date: '2026-01-20' });
  api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 90, tax: 10, account: 'Broker', date: '2026-04-20',
    origAmount: 2.5, currency: 'USD' });
  assert.deepEqual(Object.keys(sheets).sort(), ['HoldingTxns', 'Holdings']);
  assert.equal(sheets.HoldingTxns.rows.length, 4);
  assert.equal(sheets.Holdings.rows.length, 2);
});

test('deleting a holding removes its entries, and only its own', () => {
  const { api, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10', { fee: 15 });
  api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 90, account: 'Broker', date: '2026-04-20' });
  const other = buyNew('Gold', 'gold', 1, 40000, 'Broker', '2026-01-11');
  assert.ok(api({ action: 'deleteHolding', id: r.holdingId }).ok);
  assert.deepEqual(rows('Holdings').map(h => h[1]), ['Gold']);
  assert.deepEqual(rows('HoldingTxns').map(t => t[0]), [other.id]);
});

test('USD amounts: the exact OrigAmount and Currency are stored; THB rows leave them empty', () => {
  const { rows, buyNew } = setup();
  const usd = buyNew('AAPL', 'stock', 1, 3600, 'USD Broker', '2026-01-10', { origAmount: 100, currency: 'usd' });
  const thb = buyNew('PTT', 'stock', 1, 30, 'Broker', '2026-01-11', { origAmount: 30, currency: 'THB' });
  const byId = id => rows('HoldingTxns').find(t => t[0] === id);
  assert.equal(byId(usd.id)[6], 3600);
  assert.equal(byId(usd.id)[11], 100); assert.equal(byId(usd.id)[12], 'USD');
  assert.equal(byId(thb.id)[11], undefined); assert.equal(byId(thb.id)[12], undefined);
});

test('adding the same entry twice (offline retry) saves it once', () => {
  const { api, rows, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  const again = { action: 'addHoldingTxn', id: 'Xretry', type: 'buy', holdingId: r.holdingId, quantity: 1, price: 30, account: 'Broker', date: '2026-01-11' };
  assert.ok(api(again).ok);
  const dup = api(again);
  assert.ok(dup.duplicate);
  assert.equal(rows('HoldingTxns').length, 2);
});

test('holdingsAt: what you held on a date, at cost, split into investments and assets', () => {
  const { api, context, buyNew } = setup();
  const r = buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  buyNew('Car', 'vehicle', 1, 500000, '', '2026-01-15');
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 100, price: 40, account: 'Broker', date: '2026-02-10' });
  api({ action: 'addHoldingTxn', type: 'sell', holdingId: r.holdingId, quantity: 100, price: 50, account: 'Broker', date: '2026-02-20' });
  const jan = context.holdingsAt('2026-01-31');
  near(jan.investments, 3000); near(jan.assets, 500000);
  near(context.holdingsAt('2026-02-15').investments, 7000);
  near(context.holdingsAt('2026-02-28').investments, 3500, 'after the sale: 100 left at average cost 35');
  near(context.holdingsAt('2025-12-31').investments, 0);
});

test('bootstrap returns holdings and portfolio', () => {
  const { api, buyNew } = setup();
  buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  api({ action: 'setTargets', targets: { 'Thai stocks': 30, Gold: 20, Cash: 0 } });
  const res = api({ action: 'bootstrap' });
  assert.ok(res.ok);
  assert.equal(res.holdings.holdings.length, 1);
  near(res.holdings.totals.investments, 3000);
  assert.deepEqual(res.portfolio.targets, { 'Thai stocks': 30, Gold: 20 }, 'a 0% target is dropped');
  assert.equal(res.portfolio.benchmarkSymbol, 'INDEXBKK:SET');
});

test('setBenchmark needs a symbol and saves it', () => {
  const { api, context } = setup();
  assert.equal(api({ action: 'setBenchmark', symbol: ' ' }).ok, false);
  const res = api({ action: 'setBenchmark', symbol: 'indexsp:.inx' });
  assert.ok(res.ok);
  assert.equal(res.benchmark.ok, false, 'no investments yet, so nothing to fetch');
  assert.equal(context.PropertiesService.getScriptProperties().getProperty('BENCH_SYMBOL'), 'INDEXSP:.INX');
});

// ── Prices: pure helpers ──────────────────────────────────────

test('goldUnit: by symbol first, else by unit for kind gold', () => {
  const { context } = setup();
  const g = context.goldUnit;
  assert.equal(g('XAUUSD', '', 'stock'), 'OZ');
  assert.equal(g('CURRENCY:XAUUSD', '', ''), 'OZ');
  assert.equal(g('gold:baht', '', ''), 'BAHT');
  assert.equal(g('GOLD:GRAM', '', ''), 'GRAM');
  assert.equal(g('', 'baht-weight', 'gold'), 'BAHT');
  assert.equal(g('', 'oz', 'gold'), 'OZ');
  assert.equal(g('', 'g', 'gold'), 'GRAM');
  assert.equal(g('', 'kg', 'gold'), '', 'unknown unit');
  assert.equal(g('', 'oz', 'stock'), '', 'only kind gold is priced by unit');
  assert.equal(g('PTT.BK', 'baht', 'gold'), '', 'any other symbol wins over the unit');
});

test('quoteSymbol: .BK becomes BKK:, exchange prefixes kept, junk refused', () => {
  const { context } = setup();
  const q = context.quoteSymbol;
  assert.equal(q('ptt.bk'), 'BKK:PTT');
  assert.equal(q('M&A-R.BK'), 'BKK:M&A-R');
  assert.equal(q('NASDAQ:AAPL'), 'NASDAQ:AAPL');
  assert.equal(q('CURRENCY:USDTHB'), 'CURRENCY:USDTHB');
  assert.equal(q('AAPL'), 'AAPL');
  assert.equal(q(''), '');
  assert.equal(q('not a symbol'), '');
});

test('priceSource: gold follows spot XAUUSD with a unit factor; CURRENCY: pairs know their currency', () => {
  const { context } = setup();
  const p = h => JSON.parse(JSON.stringify(context.priceSource(h)));
  assert.deepEqual(p({ symbol: '', unit: 'oz', kind: 'gold' }), { q: 'CURRENCY:XAUUSD', factor: 1, cur: 'USD' });
  assert.deepEqual(p({ symbol: 'GOLD:BAHT', unit: '', kind: 'gold' }), { q: 'CURRENCY:XAUUSD', factor: 0.47295, cur: 'USD' });
  near(p({ symbol: '', unit: 'gram', kind: 'gold' }).factor, 1 / 31.1035);
  assert.deepEqual(p({ symbol: 'CURRENCY:USDTHB', unit: '', kind: 'other' }), { q: 'CURRENCY:USDTHB', factor: 1, cur: 'THB' });
  assert.deepEqual(p({ symbol: 'PTT.BK', unit: 'shares', kind: 'stock' }), { q: 'BKK:PTT', factor: 1, cur: '' });
  assert.equal(context.priceSource({ symbol: '', unit: 'shares', kind: 'stock' }), null);
});

// ── Prices: refreshPrices with GOOGLEFINANCE faked ────────────

test('refreshPrices: converts to baht, applies the gold factor, records the quote currency, skips what it can\'t price', () => {
  const { api, context, sheets, holding, buyNew } = setup();
  buyNew('PTT', 'stock', 100, 30, 'Broker', '2026-01-10');
  api({ action: 'updateHolding', id: holding('PTT').id, symbol: 'PTT.BK' });
  buyNew('AAPL', 'stock', 2, 6800, 'Broker', '2026-01-10');
  api({ action: 'updateHolding', id: holding('AAPL').id, symbol: 'NASDAQ:AAPL' });
  buyNew('Gold bar', 'gold', 1, 40000, 'Broker', '2026-01-10');
  api({ action: 'updateHolding', id: holding('Gold bar').id, unit: 'baht' });
  buyNew('Mystery', 'stock', 1, 100, 'Broker', '2026-01-10');
  api({ action: 'updateHolding', id: holding('Mystery').id, symbol: 'NOPE' });
  buyNew('Car', 'vehicle', 1, 500000, '', '2026-01-10');
  // GOOGLEFINANCE stand-in: [label, price, currency] per formula row
  const quotes = { 'BKK:PTT': [32, 'THB'], 'NASDAQ:AAPL': [200, 'USD'], 'CURRENCY:XAUUSD': [2600, ''] };
  const asked = [];
  context.evalFormulas = formulas => formulas.map(f => {
    const label = f[0].replace(/^="|"$/g, '');
    asked.push(label);
    if (/CURRENCY:/.test(f[1]) && label.length === 3) return [label, label === 'USD' ? 35 : '', ''];   // FX row
    const qv = quotes[label] || ['', ''];
    return [label, qv[0], qv[1]];
  });
  const res = api({ action: 'refreshPrices' });
  assert.ok(res.ok);
  assert.deepEqual(res.updated.sort(), ['AAPL', 'Gold bar', 'PTT']);
  assert.deepEqual(res.failed, ['Mystery (NOPE)']);
  assert.deepEqual(JSON.parse(JSON.stringify(res.rates)), { USD: 35 });
  assert.ok(!asked.includes('Car'), 'assets are not priced');
  near(holding('PTT').currentPrice, 32);
  near(holding('AAPL').currentPrice, 7000, '200 USD × 35');
  near(holding('Gold bar').currentPrice, 2600 * 0.47295 * 35);
  const row = sheets.Holdings.rows.find(r => r[1] === 'AAPL');
  assert.equal(row[9], 'USD', 'QuoteCurrency');
  assert.match(row[6], /^\d{4}-\d{2}-\d{2}$/, 'PriceDate is today');
  assert.ok(!('Accounts' in sheets), 'no account exchange rates in this app');
  assert.ok(sheets._Prices.hidden, 'the scratch tab is hidden');
  assert.ok(context.PropertiesService.getScriptProperties().getProperty('LAST_PRICE_REFRESH'));
});

test('dailyRefresh refreshes prices', () => {
  const { context } = setup();
  let ran = 0;
  context.refreshPrices = () => { ran++; return { ok: true, updated: [], failed: [] }; };
  context.dailyRefresh();
  assert.equal(ran, 1);
});

test('FeeOrig (plan C3): the USD fee is kept for a USD buy, left empty for THB', () => {
  const { sheets, buyNew, context } = setup();
  buyNew('AAPL', 'stock', 1, 3500, 'IBKR', '2026-01-10', { origAmount: 100, currency: 'usd', fee: 35, feeOrig: 1.004 });
  buyNew('PTT', 'stock', 10, 30, 'Broker', '2026-01-10', { fee: 15, feeOrig: 15, currency: 'THB' });
  buyNew('MSFT', 'stock', 1, 3500, 'IBKR', '2026-01-10', { origAmount: 100, currency: 'USD', fee: 35 });
  const row = name => {
    const hid = sheets.Holdings.rows.find(r => r[1] === name)[0];
    return sheets.HoldingTxns.rows.find(r => r[1] === hid);
  };
  assert.equal(row('AAPL')[13], 1, 'rounded to 2 decimals');
  assert.equal(row('AAPL')[12], 'USD'); assert.equal(row('AAPL')[7], 35, 'Fee stays in THB');
  assert.ok(!row('PTT')[13], 'THB: no FeeOrig'); assert.ok(!row('PTT')[12], 'THB: no Currency');
  assert.ok(!row('MSFT')[13], 'no feeOrig sent: none stored');
  const t = context.holdingTxnRows();
  assert.deepEqual([...t.map(x => x.feeOrig)], [1, 0, 0]);
});

test('FeeOrig is written with its currency even when there is no OrigAmount; dividends never get one', () => {
  const { api, sheets, buyNew } = setup();
  const r = buyNew('AAPL', 'stock', 1, 3500, 'IBKR', '2026-01-10', { currency: 'USD', fee: 35, feeOrig: 1 });
  api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 70, tax: 10, account: 'IBKR', date: '2026-02-01',
    origAmount: 2, currency: 'USD', feeOrig: 0.3 });
  const [buy, div] = sheets.HoldingTxns.rows.slice(1);
  assert.equal(buy[11], undefined, 'no OrigAmount was sent');
  assert.equal(buy[12], 'USD'); assert.equal(buy[13], 1);
  assert.ok(!div[13], 'on a dividend the Fee column is tax withheld, not a fee');
});

test('old 13-column HoldingTxns rows (copied from Money Tracker) still read fine', () => {
  const { api, sheets, context, holding } = setup();
  api({ action: 'getHoldings' });                         // creates the tabs
  sheets.Holdings.rows.push(['H1', 'Gold', 'gold', '', 'baht', '', '', '', 'active']);
  sheets.HoldingTxns.rows[0] = sheets.HoldingTxns.rows[0].slice(0, 13);   // Money Tracker's header row
  sheets.HoldingTxns.rows.push(['X1', 'H1', '2026-01-10', 'buy', 2, 40000, 80000, 50, 'Broker', '', 'E1', 2300, 'USD']);
  const t = context.holdingTxnRows()[0];
  assert.equal(t.feeOrig, 0); near(t.origAmount, 2300); assert.equal(t.currency, 'USD'); near(t.fee, 50);
  near(holding('Gold').cost, 80000); near(holding('Gold').fees, 50);
  // a new USD buy with a fee adds the FeeOrig header to the old tab
  api({ action: 'addHoldingTxn', type: 'buy', holdingId: 'H1', quantity: 1, price: 41000, account: 'Broker', date: '2026-02-10',
    origAmount: 1200, currency: 'USD', fee: 35, feeOrig: 1 });
  assert.equal(sheets.HoldingTxns.rows[0][13], 'FeeOrig');
  assert.equal(context.holdingTxnRows()[1].feeOrig, 1);
});

test('new dividends get a WD… Id (plan C8), other entries X…; TaxOrig (C6) keeps the USD tax withheld', () => {
  const { api, sheets, buyNew } = setup();
  const r = buyNew('AAPL', 'stock', 1, 3500, 'IBKR', '2026-01-10', { origAmount: 100, currency: 'USD' });
  assert.match(r.id, /^X/);
  const d = api({ action: 'addHoldingTxn', type: 'dividend', holdingId: r.holdingId, amount: 70, origAmount: 2, currency: 'USD', tax: 10.5, taxOrig: 0.3,
    account: 'IBKR', date: '2026-02-01' });
  assert.match(d.id, /^WD/);
  const row = sheets.HoldingTxns.rows.find(t => t[0] === d.id);
  assert.equal(row[14], 0.3); assert.equal(row[12], 'USD'); assert.equal(row[7], 10.5, 'Fee (tax) stays in THB');
  const kept = api({ action: 'addHoldingTxn', id: 'X0000000001', type: 'dividend', holdingId: r.holdingId, amount: 5, account: 'IBKR', date: '2026-02-02' });
  assert.equal(kept.id, 'X0000000001', 'an Id sent with the entry is kept (old Ids from Money Tracker)');
});
