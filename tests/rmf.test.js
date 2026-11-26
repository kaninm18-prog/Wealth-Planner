// RMF lock: a retirement mutual fund can be sold without losing the tax benefit once you are 55 AND 5 years have
// passed since the fund's first purchase. The birth date is set in Settings (setBirthDate). Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

function setup(birth) {
  const b = createBackend({ now: '2026-11-25T05:00:00Z' });
  if (birth) assert.ok(b.api({ action: 'setBirthDate', birthDate: birth }).ok);
  const buy = (name, date, extra) => b.api(Object.assign({ action: 'addHoldingTxn', type: 'buy', holding: { name, kind: 'fund' },
    quantity: 100, price: 10, account: 'KS', date, lockRule: 'rmf' }, extra || {}));
  const buyMore = (hid, date, extra) => b.api(Object.assign({ action: 'addHoldingTxn', type: 'buy', holdingId: hid,
    quantity: 50, price: 10, account: 'KS', date, lockRule: 'rmf' }, extra || {}));
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const stored = row => b.sheets.HoldingTxns.rows[row][15];
  return { b, buy, buyMore, holding, stored };
}

test('birth date: saved, returned with the portfolio settings, cleared by an empty value, bad ones refused', () => {
  const { b } = setup();
  assert.equal(b.api({ action: 'bootstrap', month: 11, year: 2026 }).portfolio.birthDate, '');
  assert.equal(b.api({ action: 'setBirthDate', birthDate: '1980-06-15' }).birthDate, '1980-06-15');
  assert.equal(b.api({ action: 'bootstrap', month: 11, year: 2026 }).portfolio.birthDate, '1980-06-15');
  ['15/06/1980', '1980-02-31', '2999-01-01', '1800-01-01', 'abc'].forEach(v => assert.equal(b.api({ action: 'setBirthDate', birthDate: v }).ok, false, v));
  assert.equal(b.api({ action: 'bootstrap', month: 11, year: 2026 }).portfolio.birthDate, '1980-06-15', 'a refused value changes nothing');
  assert.equal(b.api({ action: 'setBirthDate', birthDate: '' }).birthDate, '');
  assert.equal(b.api({ action: 'bootstrap', month: 11, year: 2026 }).portfolio.birthDate, '');
});

test('an RMF buy without a birth date is refused and nothing is saved', () => {
  const { b, buy } = setup();
  const r = buy('KFRMF', '2026-11-25');
  assert.equal(r.ok, false);
  assert.match(r.error, /birth date/i);
  assert.equal(b.api({ action: 'getHoldings' }).holdings.length, 0, 'not even the fund is created');
});

test('locked until the later of age 55 and 5 years after the first buy', () => {
  const young = setup('1990-06-15');                                      // 55 on 2045-06-15, long after 5 years
  const r1 = young.buy('KFRMF', '2026-11-25');
  assert.ok(r1.ok, r1.error); assert.equal(r1.lockUntil, '2045-06-15');
  assert.equal(young.stored(1), '2045-06-15');
  const h = young.holding('KFRMF');
  assert.equal(h.lockedQty, 100); assert.equal(h.nextUnlock.date, '2045-06-15');

  const old = setup('1965-01-10');                                        // already 55, so 5 years decide
  const r2 = old.buy('KFRMF', '2026-11-25');
  assert.equal(r2.lockUntil, '2031-11-25');
  assert.equal(old.holding('KFRMF').lockedQty, 100);
});

test('the 5 years count from the fund\'s first buy, not from each buy', () => {
  const { buy, buyMore, stored } = setup('1965-01-10');                  // 55 since 2020
  const first = buy('KFRMF', '2024-03-01');
  assert.equal(first.lockUntil, '2029-03-01');
  const later = buyMore(first.holdingId, '2026-11-25');
  assert.equal(later.lockUntil, '2029-03-01', 'same date as the first buy, not 2031');
  assert.equal(stored(2), '2029-03-01');
  const earlier = buyMore(first.holdingId, '2022-05-02');                // backdated before the first
  assert.equal(earlier.lockUntil, '2027-05-02');
});

test('already 55 and held 5 years: nothing to lock (no error, no LockUntil)', () => {
  const { buy, buyMore, holding, stored } = setup('1960-01-01');
  const first = buy('KFRMF', '2019-01-01');                              // 5 years: 2024-01-01 → nothing locks on 2019? 55 passed, 5y after
  assert.equal(first.lockUntil, '2024-01-01', 'a 2019 buy is locked until 2024');
  const later = buyMore(first.holdingId, '2026-11-25');
  assert.ok(later.ok, later.error);
  assert.equal(later.lockUntil, '', '2024-01-01 has passed');
  assert.ok(!stored(2));
  const h = holding('KFRMF');
  assert.equal(h.lockedQty, 0); assert.equal(h.freeQty, 150);
});

test('29 Feb birthday: the 55th birthday is 1 March in a non-leap year (the later day)', () => {
  const { buy } = setup('1980-02-29');
  assert.equal(buy('KFRMF', '2026-11-25').lockUntil, '2035-03-01');
});

test('the rule only applies to buys; an explicit date without the rule is kept as typed', () => {
  const { b, buy, buyMore } = setup('1990-06-15');
  const first = buy('KFRMF', '2026-11-25');
  const sell = b.api({ action: 'addHoldingTxn', type: 'sell', holdingId: first.holdingId, quantity: 10, price: 10, account: 'KS',
    date: '2026-11-25', lockRule: 'rmf' });
  assert.ok(sell.ok, sell.error); assert.ok(!b.sheets.HoldingTxns.rows[2][15], 'a sale gets no lock');
  const typed = buyMore(first.holdingId, '2026-11-25', { lockRule: undefined, lockUntil: '2030-01-01' });
  assert.equal(typed.lockUntil, '2030-01-01');
});

test('selling locked RMF units takes the oldest first; a switch keeps their lock dates', () => {
  const { b, buy, holding } = setup('1990-06-15');
  const first = buy('KFRMF', '2026-11-25');
  const h = holding('KFRMF');
  assert.equal(h.lots.length, 1); assert.equal(h.lots[0].lockUntil, '2045-06-15'); assert.equal(h.lots[0].locked, true);
  assert.equal(first.ok, true);
  assert.equal(b.api({ action: 'setBirthDate', birthDate: '1990-06-16' }).ok, true);
  assert.equal(holding('KFRMF').lots[0].lockUntil, '2045-06-15', 'changing the birth date later never rewrites saved buys');
});
