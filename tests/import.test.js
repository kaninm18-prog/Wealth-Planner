// Import data file, ported from Money Tracker (Stage 4, step 3b). Holdings and trades work as in
// Money Tracker; accounts in the file are reported as skipped, since accounts live in Money Tracker.
// The fake sheet has no GOOGLEFINANCE, so foreign-currency rates are never found unless a test
// stands in for fxSeries. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
const plain = x => JSON.parse(JSON.stringify(x));       // objects from the backend's realm, for deepEqual
function setup() {
  const b = createBackend();
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const txns = () => b.context.holdingTxnRows();
  return { api: b.api, sheets: b.sheets, context: b.context, holding, txns };
}
const pack = () => ({
  action: 'importPack',
  accounts: [{ name: 'KBank', type: 'bank', startingBalance: 1000 }, { name: 'Broker', setStartingBalance: true, startingBalance: 5 }, { name: ' ' }],
  holdingTxns: [
    { id: 'X1', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 100, price: 30, fee: 15, account: 'Broker', date: '2026-01-10' },
    { id: 'X2', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 100, amount: 4000, extraThb: 10, account: 'Broker', date: '2026-02-10' },
    { id: 'X3', type: 'sell', holding: { name: 'PTT' }, quantity: 50, price: 50, account: 'Broker', date: '2026-03-10' },
    { id: 'X4', type: 'dividend', holding: { name: 'PTT' }, amount: 200, tax: 20, account: 'Broker', date: '2026-04-10' },
  ],
  tradeAccount: 'MTS Gold',
  trades: [{ ticket: '11', symbol: 'XAUUSD', side: 'buy', volume: 0.1, profit: 30, commission: -1 },
           { ticket: '12', symbol: 'XAUUSD', side: 'sell', volume: 0.2, profit: -5 }],
});

test('importPack adds holdings (THB) and trades', () => {
  const { api, holding, txns, context } = setup();
  const r = api(pack());
  assert.ok(r.ok);
  assert.equal(r.holdings.added, 4); assert.equal(r.holdings.skipped, 0);
  assert.deepEqual(plain(r.holdings.fx), []);
  assert.equal(r.trades.added, 2);
  const h = holding('PTT');
  assert.equal(h.quantity, 150, 'one holding, found by name for the later entries');
  near(h.cost, (3000 + 4010) * 150 / 200, 'extraThb is added to the amount; average cost');
  near(h.realized, 2500 - 7010 / 4);
  near(h.dividends, 200); near(h.taxWithheld, 20); near(h.fees, 15);
  const x2 = txns().find(t => t.id === 'X2');
  near(x2.amount, 4010); near(x2.price, 40.1, 'price = amount / quantity');
  assert.equal(x2.note, '', 'THB entries get no rate note');
  const tr = context.tradeRows();
  assert.deepEqual([...tr.map(t => t.account)], ['MTS Gold', 'MTS Gold'], 'trades get the file\'s trade account');
  near(tr[0].net, 29);
});

test('importing the same file twice adds nothing new', () => {
  const { api, holding, txns, context } = setup();
  api(pack());
  const again = api(pack());
  assert.ok(again.ok);
  assert.equal(again.holdings.added, 0); assert.equal(again.holdings.skipped, 4);
  assert.equal(again.trades.added, 0); assert.equal(again.trades.skipped, 2);
  assert.equal(txns().length, 4); assert.equal(context.tradeRows().length, 2);
  assert.equal(holding('PTT').quantity, 150);
});

test('accounts in the file are skipped, not failed, and nothing is written for them', () => {
  const { api, sheets } = setup();
  const r = api(pack());
  assert.ok(r.ok);
  assert.deepEqual(plain(r.accounts.added), []);
  assert.deepEqual(plain(r.accounts.skipped), ['KBank', 'Broker'], 'blank names are ignored, as in Money Tracker');
  assert.match(r.accounts.note, /Money Tracker/);
  assert.equal(sheets.Accounts, undefined, 'no Accounts tab is created');
  // a file with only accounts still answers ok
  const only = api({ action: 'importPack', accounts: [{ name: 'KBank' }] });
  assert.ok(only.ok); assert.equal(only.holdings.added, 0); assert.equal(only.trades, null);
});

test('a foreign-currency entry with no reachable rate is skipped with a message; the rest still imports', () => {
  const { api, txns } = setup();
  const r = api({ action: 'importPack', holdingTxns: [
    { id: 'U1', type: 'buy', holding: { name: 'AAPL', kind: 'stock' }, quantity: 1, priceForeign: 100, currency: 'usd', account: 'IBKR', date: '2026-01-10' },
    { id: 'T1', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 10, price: 30, account: 'Broker', date: '2026-01-10' }] });
  assert.ok(r.ok);
  assert.equal(r.holdings.added, 1); assert.equal(r.holdings.skipped, 1);
  assert.deepEqual(plain(r.holdings.fx), ['USD rate not found for 2026-01-10']);
  assert.deepEqual([...txns().map(t => t.id)], ['T1']);
});

test('a foreign-currency entry uses that day\'s rate and keeps the exact foreign amount', () => {
  const { api, txns, context } = setup();
  context.fxSeries = () => [['2026-01-08', 34], ['2026-01-09', 35], ['2026-01-12', 36]];   // stands in for GOOGLEFINANCE
  const r = api({ action: 'importPack', holdingTxns: [
    { id: 'U1', type: 'buy', holding: { name: 'AAPL', kind: 'stock' }, quantity: 2, priceForeign: 100, currency: 'USD', account: 'IBKR', date: '2026-01-10' }] });
  assert.equal(r.holdings.added, 1);
  assert.match(r.holdings.fx[0], /AAPL: USD at each day's rate/);
  const t = txns()[0];
  near(t.amount, 7000, '2 × 100 USD at the last close on/before the day (35)');
  near(t.origAmount, 200); assert.equal(t.currency, 'USD');
  assert.match(t.note, /USD @ 35 THB/);
});

test('an entry addHoldingTxn refuses is skipped with its reason', () => {
  const { api } = setup();
  const r = api({ action: 'importPack', holdingTxns: [
    { id: 'S1', type: 'sell', holding: { name: 'Nothing' }, quantity: 1, price: 10, account: 'Broker', date: '2026-01-10' }] });
  assert.ok(r.ok);
  assert.equal(r.holdings.skipped, 1);
  assert.match(r.holdings.fx[0], /Nothing: Choose what you are selling/);
});
