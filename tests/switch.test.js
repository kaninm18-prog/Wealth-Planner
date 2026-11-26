// Fund switch (src/17_switch.gs): a sell of one fund and buys of another, linked by SwitchId. Arm's rule for
// switches only: the original cost is carried over (no realised P/L), broker cash is unchanged except a fee, and
// lock dates follow the units switched out, oldest first. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, MONEY_ID } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
const plain = x => JSON.parse(JSON.stringify(x));

function setup() {
  const b = createBackend({ now: '2026-11-25T03:00:00Z' });
  b.props.MONEY_SHEET_ID = MONEY_ID;
  b.money.setFlows([]);
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const buy = (name, qty, price, date, lockUntil, account) => {
    const h = holding(name);
    return b.api(Object.assign({ action: 'addHoldingTxn', type: 'buy', quantity: qty, price, account: account === undefined ? 'KS' : account, date, lockUntil },
      h ? { holdingId: h.id } : { holding: { name, kind: 'fund' } }));
  };
  const price = (name, p) => b.api({ action: 'updateHolding', id: holding(name).id, currentPrice: p, priceDate: '2026-11-25' });
  const sw = extra => b.api(Object.assign({ action: 'addSwitch', account: 'KS', date: '2026-11-20' }, extra));
  const ks = () => b.api({ action: 'getBrokers' }).brokers.find(x => x.name === 'KS');
  const rows = () => b.sheets.HoldingTxns.rows.slice(1);
  // KFSSF: 100 @10 (lock ended 2026-02-01), 50 @12 (locked to 2030), 30 @14 (locked to 2033) → avg 2020/180
  const kfssf = () => {
    buy('KFSSF', 100, 10, '2016-02-01', '2026-02-01');
    buy('KFSSF', 50, 12, '2020-06-15', '2030-06-15');
    buy('KFSSF', 30, 14, '2023-01-10', '2033-01-10');
    price('KFSSF', 12);
  };
  return { b, holding, buy, price, sw, ks, rows, kfssf };
}

test('a partial switch across 3 lots: cost carried, no realised P/L, lock dates carried oldest first, cash unchanged', () => {
  const { b, holding, buy, price, sw, ks, rows, kfssf } = setup();
  kfssf();
  buy('SCBSSF', 10, 6, '2025-01-01');
  price('SCBSSF', 6);
  const cash0 = ks().cash, from0 = holding('KFSSF');
  const r = sw({ fromId: from0.id, toId: holding('SCBSSF').id, unitsOut: 160, unitsIn: 320 });
  assert.ok(r.ok, r.error);
  assert.equal(r.buys, 3, 'one buy row per lock date');
  const mine = rows().filter(x => x[16] === r.id);
  assert.equal(mine.length, 4);
  assert.ok(mine.every(x => x[2] === '2026-11-20' && x[8] === 'KS'), 'same date, same broker');
  const basis = 2020 / 180 * 160;
  near(mine[0][6], basis, 'sell amount = cost out');
  near(mine.slice(1).reduce((a, x) => a + x[6], 0), basis, 'buy amounts add up to the same cost');
  assert.deepEqual(mine.slice(1).map(x => [x[4], x[15]]), [[200, ''], [100, '2030-06-15'], [20, '2033-01-10']],
    '100 free units (their lock ended before the switch), 50 to 2030, 10 of the 2033 lot');
  const from = holding('KFSSF'), to = holding('SCBSSF');
  near(from.realized, 0, 'no realised P/L on a switch');
  assert.equal(from.quantity, 20); near(from.avgCost, from0.avgCost, 'the remaining average cost is unchanged');
  near(from.cost, 2020 - basis);
  near(to.cost, 60 + basis, 'to-fund cost = carried basis (plus what it had)');
  assert.equal(to.quantity, 330);
  near(to.unrealized, to.value - to.cost, 'unrealised = market value − carried cost');
  near(to.value, 330 * 6, 'its price is untouched without a market value');
  assert.equal(to.lockedQty, 120); assert.equal(to.freeQty, 210);
  assert.deepEqual(plain(to.nextUnlock), { date: '2030-06-15', quantity: 100 });
  assert.equal(from.lockedQty, 20, 'what stays is the rest of the 2033 lot');
  near(ks().cash, cash0, 'broker cash unchanged');
});

test('a switch from free units gives free units, in one buy row', () => {
  const { b, holding, buy, sw, rows } = setup();
  buy('OLDSSF', 100, 10, '2015-01-01', '2025-01-01');
  buy('OLDSSF', 50, 10, '2025-06-01', '2035-06-01');
  const r = sw({ fromId: holding('OLDSSF').id, toHolding: { name: 'NEWSSF', symbol: 'SEC:NEWSSF' }, unitsOut: 80, unitsIn: 75 });
  assert.ok(r.ok, r.error);
  const bought = rows().filter(x => x[16] === r.id && x[3] === 'buy');
  assert.equal(bought.length, 1); assert.equal(bought[0][15], '');
  const to = holding('NEWSSF');
  assert.equal(to.kind, 'fund', 'a new fund takes the from-fund\'s kind'); assert.equal(to.symbol, 'SEC:NEWSSF');
  assert.equal(to.lockedQty, 0); assert.equal(to.freeQty, 75);
  near(to.cost, 800);
  assert.equal(b.api({ action: 'getHoldings' }).holdings.length, 2);
});

test('a fee is a normal fee on the buy side and the only cash effect; it needs a broker', () => {
  const { holding, sw, ks, rows, kfssf } = setup();
  kfssf();
  const cash0 = ks().cash;
  const r = sw({ fromId: holding('KFSSF').id, toHolding: { name: 'X' }, unitsOut: 10, unitsIn: 10, fee: 15 });
  assert.ok(r.ok, r.error);
  const mine = rows().filter(x => x[16] === r.id);
  assert.equal(mine[0][7], '', 'no fee on the sell'); assert.equal(mine[1][7], 15);
  near(ks().cash, cash0 - 15);
  near(ks().fees, 15);
  assert.match(sw({ fromId: holding('KFSSF').id, toHolding: { name: 'Y' }, unitsOut: 1, unitsIn: 1, fee: 5, account: '' }).error, /Choose an account/);
});

test('_Export_Values is unchanged by a switch with no fee (prices held fixed)', () => {
  const { b, holding, buy, price, sw, kfssf } = setup();
  kfssf();
  buy('SCBSSF', 10, 6, '2025-01-01');
  price('SCBSSF', 6);                            // 160 units × 12 = 320 units × 6
  const total = () => b.sheets._Export_Values.rows.slice(1).reduce((a, x) => a + (x[3] || 0), 0);
  b.api({ action: 'bootstrap' });
  const before = plain(b.sheets._Export_Values.rows.slice(1).map(x => x.slice(0, 4)));
  assert.ok(sw({ fromId: holding('KFSSF').id, toId: holding('SCBSSF').id, unitsOut: 160, unitsIn: 320 }).ok);
  near(total(), before.reduce((a, x) => a + x[3], 0));
  assert.deepEqual(plain(b.sheets._Export_Values.rows.slice(1).map(x => x.slice(0, 4))), before);
});

test('the market value is kept for information: SwitchValue and prices, never cost, realised or cash', () => {
  const { holding, sw, ks, rows, kfssf } = setup();
  kfssf();
  const cash0 = ks().cash;
  const r = sw({ fromId: holding('KFSSF').id, toHolding: { name: 'NEW' }, unitsOut: 100, unitsIn: 200, value: 1300 });
  assert.ok(r.ok, r.error);
  assert.ok(rows().filter(x => x[16] === r.id).every(x => x[17] === 1300), 'SwitchValue on every row');
  const from = holding('KFSSF'), to = holding('NEW');
  near(to.cost, 2020 / 180 * 100, 'cost is the carried basis, not the 1,300');
  near(from.realized, 0);
  near(to.currentPrice, 6.5, '1,300 / 200 units'); assert.equal(to.priceDate, '2026-11-20');
  assert.equal(from.priceDate, '2026-11-25', 'a newer price set by hand is kept');
  near(ks().cash, cash0);
  assert.equal(to.txns[0].switchValue, 1300); assert.ok(to.txns[0].switchId);
});

test('deleting a switch removes both sides; refused when a later sale of the new units depends on it', () => {
  const { b, holding, sw, rows, kfssf } = setup();
  kfssf();
  const before = holding('KFSSF');
  const r = sw({ fromId: before.id, toHolding: { name: 'NEW' }, unitsOut: 160, unitsIn: 160 });
  const buyRow = rows().find(x => x[16] === r.id && x[3] === 'buy');
  const to = holding('NEW');
  assert.ok(b.api({ action: 'addHoldingTxn', type: 'sell', holdingId: to.id, quantity: 150, price: 12, account: 'KS', date: '2026-11-24' }).ok);
  assert.match(b.api({ action: 'deleteHoldingTxn', id: buyRow[0] }).error, /Delete the later sale of the new fund first/);
  const sale = holding('NEW').txns.find(t => !t.switchId);
  assert.ok(b.api({ action: 'deleteHoldingTxn', id: sale.id }).ok);
  const sellRow = rows().find(x => x[16] === r.id && x[3] === 'sell');
  const del = b.api({ action: 'deleteHoldingTxn', id: sellRow[0] });          // either side deletes the whole switch
  assert.ok(del.ok, del.error); assert.equal(del.deleted, 4);
  assert.equal(rows().filter(x => x[16] === r.id).length, 0);
  const after = holding('KFSSF');
  assert.equal(after.quantity, 180); near(after.cost, before.cost); assert.equal(after.lockedQty, before.lockedQty);
  assert.equal(holding('NEW').quantity, 0);
});

test('checks: more than held, the same fund, a retried save is saved once', () => {
  const { holding, sw, rows, kfssf } = setup();
  kfssf();
  const id = holding('KFSSF').id;
  assert.match(sw({ fromId: id, toHolding: { name: 'N' }, unitsOut: 181, unitsIn: 1 }).error, /only hold 180/);
  assert.match(sw({ fromId: id, toId: id, unitsOut: 1, unitsIn: 1 }).error, /another fund/);
  assert.match(sw({ fromId: id, toHolding: { name: 'N' }, unitsOut: 1, unitsIn: 0 }).error, /units received/);
  const once = { fromId: id, toHolding: { name: 'N2' }, unitsOut: 5, unitsIn: 5, id: 'SWretry0001' };
  assert.ok(sw(once).ok);
  assert.ok(sw(once).duplicate);
  assert.equal(rows().filter(x => x[16] === 'SWretry0001').length, 2);
});

test('an old row without the SwitchId / SwitchValue columns still reads', () => {
  const { b } = setup();
  b.api({ action: 'getHoldings' });
  b.sheets.HoldingTxns.rows.push(['X1', 'H1', '2026-01-10', 'buy', 5, 10, 50, '', 'KS', '', '', '', '', '', '', '2036-01-10']);
  const t = b.context.holdingTxnRows()[0];
  assert.equal(t.switchId, ''); assert.equal(t.switchValue, 0); assert.equal(t.lockUntil, '2036-01-10');
});
