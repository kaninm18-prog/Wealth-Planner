// "Locked until" dates for tax funds (SSF, ThaiESG…): each buy can be locked until a date. Which units are still
// locked is worked out with sells taken from the oldest units first (FIFO by date). Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const TODAY = '2026-11-25';
function setup(now) {
  const b = createBackend({ now: now || TODAY + 'T05:00:00Z' });
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const buyNew = (name, qty, date, lockUntil) => b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name, kind: 'fund' },
    quantity: qty, price: 10, account: 'KS', date, lockUntil });
  const txn = (type, hid, qty, date, extra) => b.api(Object.assign({ action: 'addHoldingTxn', type, holdingId: hid, quantity: qty, price: 10,
    account: 'KS', date }, extra || {}));
  return { b, holding, buyNew, txn };
}
const plain = x => JSON.parse(JSON.stringify(x));

test('LockUntil is the last HoldingTxns column, after TaxOrig; stored as text on buys only', () => {
  const { b, buyNew, txn } = setup();
  const r = buyNew('KFSSF', 100, '2024-03-01', '2034-03-01');
  assert.ok(r.ok, r.error);
  const head = b.sheets.HoldingTxns.rows[0];
  assert.equal(head[14], 'TaxOrig'); assert.equal(head[15], 'LockUntil'); assert.equal(head.length, 16);
  assert.equal(b.sheets.HoldingTxns.rows[1][15], '2034-03-01');
  const s = txn('sell', r.holdingId, 1, '2026-01-01', { lockUntil: '2040-01-01' });
  assert.ok(s.ok);
  assert.ok(!b.sheets.HoldingTxns.rows[2][15], 'a sell never gets a LockUntil');
  assert.equal(b.context.holdingTxnRows()[0].lockUntil, '2034-03-01');
});

test('FIFO: sells come out of the oldest units first; locked, free and the next unlock', () => {
  const { holding, buyNew, txn } = setup();
  const r = buyNew('KFSSF', 100, '2016-02-01', '2026-02-01');           // already free (10 years passed)
  txn('buy', r.holdingId, 50, '2020-06-15', { lockUntil: '2030-06-15' });
  txn('buy', r.holdingId, 30, '2023-01-10', { lockUntil: '2033-01-10' });
  txn('buy', r.holdingId, 20, '2025-05-05', { lockUntil: '2030-06-15' });
  txn('buy', r.holdingId, 10, '2025-07-01');                              // not a tax fund buy: never locked
  txn('sell', r.holdingId, 120, '2026-03-01');                            // all 100 free units, then 20 of the 2020 lot
  const h = holding('KFSSF');
  assert.equal(h.quantity, 90);
  assert.equal(h.lockedQty, 80, '30 left of 2020 + 30 + 20');
  assert.equal(h.freeQty, 10);
  assert.deepEqual(plain(h.nextUnlock), { date: '2030-06-15', quantity: 50 }, 'both lots unlocking that day');
  assert.deepEqual(plain(h.lots).map(l => [l.date, l.quantity, l.lockUntil, l.locked]), [
    ['2020-06-15', 30, '2030-06-15', true], ['2023-01-10', 30, '2033-01-10', true],
    ['2025-05-05', 20, '2030-06-15', true], ['2025-07-01', 10, '', false]]);
  assert.equal(h.avgCost, 10, 'cost still uses the average-cost method');
});

test('sells are taken in date order, not in the order they were typed', () => {
  const { holding, buyNew, txn } = setup();
  const r = buyNew('ThaiESG', 40, '2025-02-01', '2030-02-01');
  txn('buy', r.holdingId, 60, '2024-01-15', { lockUntil: '2025-01-15' });  // typed later, bought earlier: free
  txn('sell', r.holdingId, 50, '2026-05-01');
  const h = holding('ThaiESG');
  assert.equal(h.lockedQty, 40, 'the 50 came out of the older (already free) lot, typed second');
  assert.equal(h.freeQty, 10);
});

test('today\'s boundary: locked while LockUntil > today, free on the day itself', () => {
  const mk = now => {
    const { holding, buyNew } = setup(now);
    buyNew('SSF', 10, '2016-11-25', '2026-11-25');
    return holding('SSF');
  };
  const before = mk('2026-11-24T16:59:00Z');            // the day before (the test clock reads dates in UTC)
  assert.equal(before.lockedQty, 10); assert.equal(before.freeQty, 0);
  assert.deepEqual(plain(before.nextUnlock), { date: '2026-11-25', quantity: 10 });
  const on = mk('2026-11-25T05:00:00Z');
  assert.equal(on.lockedQty, 0); assert.equal(on.freeQty, 10); assert.equal(on.nextUnlock, null);
});

test('an old row without the LockUntil column (and a holding with no lock) reads as free', () => {
  const { b, holding } = setup();
  b.api({ action: 'getHoldings' });
  b.sheets.Holdings.rows.push(['H1', 'Old fund', 'fund', '', 'units', 10, '2026-01-01', '', 'active']);
  b.sheets.HoldingTxns.rows[0] = b.sheets.HoldingTxns.rows[0].slice(0, 13);          // Money Tracker's 13 columns
  b.sheets.HoldingTxns.rows.push(['X1', 'H1', '2026-01-10', 'buy', 5, 10, 50, '', 'KS', '', '', '', '']);
  assert.equal(b.context.holdingTxnRows()[0].lockUntil, '');
  const h = holding('Old fund');
  assert.equal(h.lockedQty, 0); assert.equal(h.freeQty, 5); assert.equal(h.nextUnlock, null);
  assert.deepEqual(plain(h.lots), [], 'no lots sent when nothing was ever locked');
  // the first locked buy adds the missing headers, without touching the old ones
  const r = b.api({ action: 'addHoldingTxn', type: 'buy', holdingId: 'H1', quantity: 2, price: 10, account: 'KS', date: '2026-02-01', lockUntil: '2036-02-01' });
  assert.ok(r.ok, r.error);
  assert.deepEqual([...b.sheets.HoldingTxns.rows[0]].slice(11), ['OrigAmount', 'Currency', 'FeeOrig', 'TaxOrig', 'LockUntil']);
  assert.equal(holding('Old fund').lockedQty, 2);
});

test('a bad or too-early date is refused', () => {
  const { buyNew } = setup();
  assert.match(buyNew('A', 1, '2026-01-01', '01/02/2036').error, /should be a date/);
  assert.match(buyNew('B', 1, '2026-01-01', '2026-01-01').error, /after the purchase date/);
  assert.ok(buyNew('C', 1, '2026-01-01', '').ok, 'empty = not locked');
});

test('the API returns lockedQty, freeQty, nextUnlock and lots (bootstrap and getHoldings)', () => {
  const { b, buyNew } = setup();
  buyNew('KFSSF', 100, '2024-03-01', '2034-03-01');
  buyNew('PTT', 10, '2024-03-01');
  for (const res of [b.api({ action: 'bootstrap' }).holdings, b.api({ action: 'getHoldings' })]) {
    const f = res.holdings.find(h => h.name === 'KFSSF'), p = res.holdings.find(h => h.name === 'PTT');
    assert.equal(f.lockedQty, 100); assert.equal(f.freeQty, 0);
    assert.deepEqual(f.nextUnlock, { date: '2034-03-01', quantity: 100 });
    assert.deepEqual(f.lots, [{ id: f.txns[0].id, date: '2024-03-01', quantity: 100, lockUntil: '2034-03-01', locked: true }]);
    assert.equal(p.lockedQty, 0); assert.equal(p.freeQty, 10); assert.equal(p.nextUnlock, null); assert.deepEqual(p.lots, []);
    assert.equal(f.txns[0].lockUntil, '2034-03-01', 'each buy entry carries its date too');
  }
});

test('selling locked units is allowed (the app warns; the backend does not block)', () => {
  const { holding, buyNew, txn } = setup();
  const r = buyNew('KFSSF', 100, '2024-03-01', '2034-03-01');
  assert.ok(txn('sell', r.holdingId, 30, '2026-06-01').ok);
  const h = holding('KFSSF');
  assert.equal(h.quantity, 70); assert.equal(h.lockedQty, 70); assert.equal(h.freeQty, 0);
});
