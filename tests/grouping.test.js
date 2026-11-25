// Grouping the holdings on the home screen (js/grouping.js): by type, or by broker with split holdings.
// The front-end file is run on its own in a sandbox: it has no page access, so no browser is needed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'grouping.js'), 'utf8'), ctx, { filename: 'grouping.js' });
  return ctx;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, (msg || '') + ` (${a} vs ${b})`);
const plain = x => JSON.parse(JSON.stringify(x));

// value = quantity × price; cost = quantity × average cost
function H(id, kind, qty, price, avg, txns, extra) {
  return Object.assign({ id, name: id, kind, group: ['property', 'vehicle', 'electronics', 'other'].includes(kind) ? 'asset' : 'investment',
    quantity: qty, value: qty * price, cost: qty * avg, txns: txns || [{ type: 'buy', quantity: qty, account: '' }] }, extra || {});
}
const buy = (q, account) => ({ type: 'buy', quantity: q, account });
const sell = (q, account) => ({ type: 'sell', quantity: q, account });

const list = () => [
  H('PTT', 'stock', 100, 35, 30, [buy(100, 'KS')]),
  H('VOO', 'etf', 2, 18000, 15000, [buy(2, 'IBKR')]),
  H('KFSSF', 'fund', 1000, 12, 11, [buy(600, 'KS'), buy(400, 'Finnomena')]),
  H('Gold bar', 'gold', 1, 42000, 40000, [buy(1, '')]),
  H('Car', 'vehicle', 1, 450000, 500000, [buy(1, '')]),
  H('Odd', 'mystery', 1, 10, 10, [buy(1, 'KS')]),
  H('Sold out', 'stock', 0, 40, 0, [buy(10, 'KS'), sell(10, 'KS')]),
  H('New', 'stock', 0, 0, 0, []),                               // added with no entries yet
];
const ledger = {
  brokers: [
    { name: 'KS', positions: [{ id: 'PTT', quantity: 100 }, { id: 'KFSSF', quantity: 600 }, { id: 'Odd', quantity: 1 }] },
    { name: 'IBKR', positions: [{ id: 'VOO', quantity: 2 }] },
    { name: 'Finnomena', positions: [{ id: 'KFSSF', quantity: 400 }] },
    { name: 'Empty broker', positions: [] },
  ],
  other: { positions: [{ id: 'Gold bar', quantity: 1 }, { id: 'Car', quantity: 1 }] },
};

test('by type: the agreed order, unknown kinds under Other assets, closed positions left out', () => {
  const g = plain(load().holdingGroups(list(), 'type', null));
  assert.deepEqual(g.map(x => x.label), ['Stocks', 'ETFs', 'Mutual funds', 'Gold', 'Vehicles', 'Other assets']);
  const stocks = g[0];
  assert.deepEqual(stocks.items.map(i => i.h.id), ['PTT', 'New'], 'biggest first; "Sold out" is a closed position');
  assert.equal(stocks.count, 2);
  near(stocks.value, 3500); near(stocks.cost, 3000); near(stocks.unrealized, 500);
  assert.deepEqual(g[5].items.map(i => i.h.id), ['Odd']);
  near(g[4].unrealized, -50000, 'assets show their gain/loss too');
});

test('by type: group values add up to the open holdings', () => {
  const g = load().holdingGroups(list(), 'type', null);
  const total = list().filter(h => h.quantity > 0 || !h.txns.length).reduce((a, h) => a + h.value, 0);
  near(g.reduce((a, x) => a + x.value, 0), total);
});

test('by broker: one group per broker from the backend positions, a split holding under each, Other assets last', () => {
  const g = plain(load().holdingGroups(list(), 'broker', ledger));
  assert.deepEqual(g.map(x => x.label), ['IBKR', 'KS', 'Finnomena', 'Other assets'], 'biggest first; an empty broker is not shown');
  const ks = g.find(x => x.label === 'KS'), fin = g.find(x => x.label === 'Finnomena');
  const kf = ks.items.find(i => i.h.id === 'KFSSF');
  assert.equal(kf.qty, 600); near(kf.value, 7200); near(kf.cost, 6600); assert.equal(kf.split, true);
  const kf2 = fin.items[0];
  assert.equal(kf2.qty, 400); near(kf2.value, 4800); near(kf2.cost, 4400);
  assert.equal(ks.count, 3);
  near(ks.value, 3500 + 7200 + 10); near(ks.unrealized, 500 + 600);
  const other = g[g.length - 1];
  assert.deepEqual(other.items.map(i => i.h.id).sort(), ['Car', 'Gold bar', 'New'], 'no-broker holdings and one with no entries');
  assert.equal(g.find(x => x.label === 'IBKR').items[0].split, false);
});

test('by broker: what the backend did not place at a broker still shows, under Other assets', () => {
  const partial = { brokers: [{ name: 'KS', positions: [{ id: 'PTT', quantity: 60 }] }], other: { positions: [] } };
  const g = plain(load().holdingGroups([H('PTT', 'stock', 100, 35, 30, [buy(100, 'KS')])], 'broker', partial));
  assert.deepEqual(g.map(x => [x.label, x.items[0].qty]), [['KS', 60], ['Other assets', 40]]);
  near(g[0].value + g[1].value, 3500, 'the parts add up to the holding');
});

test('by broker with an older backend (no positions): entries are added up per broker', () => {
  const hs = [
    H('KFSSF', 'fund', 1000, 12, 11, [buy(600, 'KS'), buy(400, 'Finnomena')]),
    H('PTT', 'stock', 50, 35, 30, [buy(100, 'KS'), sell(50, 'KS')]),
    H('Moved', 'stock', 70, 10, 10, [buy(100, 'A'), sell(30, 'B')]),     // sold from B: what is left is shared by the buys
    H('Gold bar', 'gold', 1, 42000, 40000, [buy(1, '')]),
  ];
  const g = plain(load().holdingGroups(hs, 'broker', null));
  const q = {};
  g.forEach(x => x.items.forEach(i => { q[x.label + '/' + i.h.id] = i.qty; }));
  assert.deepEqual(q, { 'KS/KFSSF': 600, 'Finnomena/KFSSF': 400, 'KS/PTT': 50, 'A/Moved': 70, 'Other assets/Gold bar': 1 });
  assert.equal(g[g.length - 1].label, 'Other assets');
});

test('by broker: the total over all groups equals the open holdings', () => {
  const g = load().holdingGroups(list(), 'broker', ledger);
  const total = list().filter(h => h.quantity > 0 || !h.txns.length).reduce((a, h) => a + h.value, 0);
  near(g.reduce((a, x) => a + x.value, 0), total);
});

test('nothing open: no groups', () => {
  const ctx = load();
  assert.equal(ctx.holdingGroups([], 'type', null).length, 0);
  assert.equal(ctx.holdingGroups([H('Sold out', 'stock', 0, 40, 0, [buy(1, 'KS'), sell(1, 'KS')])], 'broker', ledger).length, 0);
});
