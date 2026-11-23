// The contract with Money Tracker (its docs/stage-4-plan.md section 3, C1–C8), checked from both ends.
//  1. Always: the exports are read with a copy of the column mapping in Money Tracker's
//     src/25_linked_accounts.gs (wealthValues, syncDividends; copied at money-tracker 149cde2).
//  2. When a Money Tracker checkout is next to this repo (or MONEY_TRACKER_DIR points at one): a round trip
//     through Money Tracker's REAL code, using its own test harness. No network. Skipped otherwise (e.g. in CI).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createBackend, MONEY_ID } = require('./harness');

const NOW = '2026-11-23T03:00:00Z';
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
const plain = x => JSON.parse(JSON.stringify(x));
// Money Tracker's tests/linked.test.js: the headers it builds the Wealth Planner tabs with
const MT_VALUES = ['Account', 'Currency', 'Value', 'ValueTHB', 'AsOf'];
const MT_DIVS = ['Id', 'Date', 'Holding', 'Amount', 'OrigAmount', 'Currency', 'Tax', 'Account'];

// ── 1. Copy of Money Tracker's reading code (keep in step with src/25_linked_accounts.gs) ──
const toFloat = v => parseFloat(v) || 0;
const round2 = n => Math.round(n * 100) / 100;
const numberCell = v => v !== '' && v !== null && v !== undefined && isFinite(parseFloat(v));
const fxFields = p => { const o = toFloat(p.origAmount), c = String(p.currency || '').trim().toUpperCase(); return (o > 0 && c && c !== 'THB') ? [o, c] : ['', '']; };
function mtValues(rows) {                       // wealthValues(), fresh rows only
  const out = {};
  rows.forEach(d => {
    const name = String(d[0] || '').trim();
    if (!name || !numberCell(d[2])) return;
    out[name] = { value: toFloat(d[2]), valueThb: numberCell(d[3]) ? toFloat(d[3]) : null,
      currency: String(d[1] || '').trim().toUpperCase(), asOf: String(d[4]).slice(0, 10) };
  });
  return out;
}
function mtDividends(rows, byLinked) {          // syncDividends(): the Income row it wants per Id
  const want = {};
  rows.forEach(d => {
    const id = String(d[0] || '').trim();
    if (!/^WD/.test(id) || want[id]) return;
    const acct = String(d[7] || '').trim(), f = fxFields({ origAmount: d[4], currency: d[5] });
    want[id] = [String(d[1]).slice(0, 10), round2(toFloat(d[3])), 'Investment Returns', 'Dividend · ' + String(d[2] || '').trim(),
      byLinked[acct] || acct, f[0], f[1], id];
  });
  return want;
}

function wealthWithData() {
  const b = createBackend({ now: NOW });
  b.props.MONEY_SHEET_ID = MONEY_ID;
  b.money.setFlows([['T1', '2026-11-01', 'Kasikorn Securities', 50000, 'THB'], ['T2', '2026-11-01', 'IBKR', 100, 'USD']]);
  b.api({ action: 'setBroker', name: 'Kasikorn Securities', dividendsTo: 'Bank' });
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35 });
  const ptt = b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 1000, price: 30, account: 'Kasikorn Securities', date: '2026-11-02' });
  const aapl = b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'AAPL', kind: 'stock' }, quantity: 1, price: 1750, account: 'IBKR', date: '2026-11-02',
    origAmount: 50, currency: 'USD' });
  b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Car', kind: 'vehicle' }, quantity: 1, price: 500000, account: '', date: '2026-01-01' });
  b.api({ action: 'addHoldingTxn', type: 'dividend', holdingId: ptt.holdingId, amount: 900, tax: 100, account: 'Kasikorn Securities', date: '2026-11-10' });
  b.api({ action: 'addHoldingTxn', type: 'dividend', holdingId: aapl.holdingId, amount: 70, origAmount: 2, currency: 'USD', tax: 10.5, taxOrig: 0.3,
    account: 'IBKR', date: '2026-11-11' });
  b.api({ action: 'bootstrap' });
  return b;
}

test('export headers are exactly the ones Money Tracker reads (column positions are the contract)', () => {
  const b = wealthWithData();
  assert.deepEqual(plain(b.sheets._Export_Values.rows[0]), MT_VALUES);
  assert.deepEqual(plain(b.sheets._Export_Dividends.rows[0]), MT_DIVS);
  b.sheets._Export_Values.rows.forEach(r => assert.equal(r.length, 5));
  b.sheets._Export_Dividends.rows.forEach(r => assert.equal(r.length, 8));
});

test('Money Tracker\'s wealthValues() mapping reads each broker and Other assets', () => {
  const b = wealthWithData();
  const v = mtValues(b.sheets._Export_Values.rows.slice(1));
  assert.deepEqual(Object.keys(v).sort(), ['IBKR', 'Kasikorn Securities', 'Other assets']);
  assert.deepEqual(v['Kasikorn Securities'], { value: 50000, valueThb: 50000, currency: 'THB', asOf: '2026-11-23' },
    '50000 in − 30000 PTT + 30000 of PTT; the dividend went to Bank');
  near(v.IBKR.value, 100 - 50 + 50 + 2); near(v.IBKR.valueThb, 102 * 35); assert.equal(v.IBKR.currency, 'USD');
  assert.deepEqual(v['Other assets'], { value: 500000, valueThb: 500000, currency: 'THB', asOf: '2026-11-23' });
});

test('Money Tracker\'s syncDividends() mapping: one Income row per WD dividend, to the bank or the linked account (C2)', () => {
  const b = wealthWithData();
  const ids = b.sheets.HoldingTxns.rows.filter(r => r[3] === 'dividend').map(r => r[0]);
  const want = mtDividends(b.sheets._Export_Dividends.rows.slice(1), { IBKR: 'IB' });
  assert.deepEqual(want, {
    [ids[0]]: ['2026-11-10', 900, 'Investment Returns', 'Dividend · PTT', 'Bank', '', '', ids[0]],
    [ids[1]]: ['2026-11-11', 70, 'Investment Returns', 'Dividend · AAPL', 'IB', 2, 'USD', ids[1]],
  });
});

// ── 2. Round trip through Money Tracker's real code ──────────
function moneyTrackerDir() {
  const root = path.join(__dirname, '..');
  const tries = [process.env.MONEY_TRACKER_DIR, path.join(root, '..', 'money-tracker'), path.join(root, '..', 'kaninm18-prog', 'money-tracker')];
  return tries.find(d => d && fs.existsSync(path.join(d, 'src', '25_linked_accounts.gs')) && fs.existsSync(path.join(d, 'tests', 'harness.js')));
}
const MT_DIR = moneyTrackerDir();
const copyTab = (from, to, name) => { const rows = plain(from[name].rows); to.setTab(name, rows[0], rows.slice(1)); };

test('round trip through Money Tracker\'s real code: flows → Wealth Planner → values + dividends → balances and Income', { skip: MT_DIR ? false : 'no Money Tracker checkout next to this repo (set MONEY_TRACKER_DIR)' }, () => {
  const mtHarness = require(path.join(MT_DIR, 'tests', 'harness.js'));
  const mt = mtHarness.createBackend({ now: NOW });
  mt.api({ action: 'addAccount', name: 'Bank', type: 'bank', startingBalance: 100000 });
  mt.api({ action: 'addAccount', name: 'KS', type: 'investment', startingBalance: 0, linkedTo: 'Kasikorn Securities' });
  mt.api({ action: 'addAccount', name: 'IB', type: 'investment', startingBalance: 0, currency: 'USD', rate: 35, linkedTo: 'IBKR' });
  mt.api({ action: 'addAccount', name: 'Assets', type: 'investment', startingBalance: 0, linkedTo: 'Other assets' });
  mt.props.WEALTH_SHEET_ID = mtHarness.WEALTH_ID;
  mt.api({ action: 'addTransfer', date: '2026-11-01', amount: 50000, fromAccount: 'Bank', toAccount: 'KS', id: 'T1' });
  mt.api({ action: 'addTransfer', date: '2026-11-01', amount: 3500, fromAccount: 'Bank', toAccount: 'IB', receivedAmount: 100, id: 'T2' });
  mt.api({ action: 'addTransfer', date: '2026-11-02', amount: 5000, fromAccount: 'KS', toAccount: 'IB', receivedAmount: 140, id: 'T3' });   // linked → linked (C1)
  mt.api({ action: 'bootstrap', month: 11, year: 2026 });              // writes _Export_LinkedFlows
  const totalBefore = mt.api({ action: 'getAccounts' }).totalBalance;

  // Wealth Planner reads those flows
  const wp = createBackend({ now: NOW });
  wp.props.MONEY_SHEET_ID = MONEY_ID;
  copyTab(mt.sheets, wp.money, '_Export_LinkedFlows');
  wp.api({ action: 'setBroker', name: 'Kasikorn Securities', dividendsTo: 'Bank' });
  wp.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35 });
  const ptt = wp.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 1000, price: 30, fee: 50,
    account: 'Kasikorn Securities', date: '2026-11-02' });
  const aapl = wp.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'AAPL', kind: 'stock' }, quantity: 1, price: 1750, account: 'IBKR',
    date: '2026-11-02', origAmount: 50, currency: 'USD', fee: 35, feeOrig: 1 });
  wp.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Car', kind: 'vehicle' }, quantity: 1, price: 500000, account: '', date: '2026-01-01' });
  wp.api({ action: 'addHoldingTxn', type: 'dividend', holdingId: ptt.holdingId, amount: 900, tax: 100, account: 'Kasikorn Securities', date: '2026-11-10' });
  wp.api({ action: 'addHoldingTxn', type: 'dividend', holdingId: aapl.holdingId, amount: 70, origAmount: 2, currency: 'USD', tax: 10.5, taxOrig: 0.3,
    account: 'IBKR', date: '2026-11-11' });
  const L = wp.api({ action: 'bootstrap' }).brokers;
  near(L.brokers.find(x => x.name === 'Kasikorn Securities').deposits, 50000);
  near(L.brokers.find(x => x.name === 'Kasikorn Securities').withdrawals, -5000, 'T3 out of KS');
  near(L.brokers.find(x => x.name === 'IBKR').deposits, 240, 'T2 + T3 into IB (same Id T3 on two accounts)');

  // Money Tracker reads the exports with its real wealthValues() / syncDividends()
  copyTab(wp.sheets, mt.wealth, '_Export_Values');
  copyTab(wp.sheets, mt.wealth, '_Export_Dividends');
  mt.api({ action: 'bootstrap', month: 11, year: 2026 });
  const acc = name => mt.api({ action: 'getAccounts' }).accounts.find(a => a.name === name);
  const ks = acc('KS'), ib = acc('IB'), assets = acc('Assets'), bank = acc('Bank');
  assert.equal(ks.stale, false); assert.equal(ks.valueAsOf, '2026-11-23');
  near(ks.balance, 50000 - 5000 - 30000 - 50 + 30000, 'cash + PTT; the dividend went to Bank');
  near(ib.balance, 240 - 50 - 1 + 2 + 50, 'USD cash + AAPL in USD');
  near(ib.balanceThb, ib.balance * 35);
  near(assets.balance, 500000, 'Other assets (C7)');
  near(bank.balance, 100000 - 50000 - 3500 + 900, 'the bank got the PTT dividend as Income');
  const income = plain(mt.sheets.Income.rows.slice(1)).filter(r => /^WD/.test(r[7]));
  assert.deepEqual(income.map(r => [r[0], r[1], r[3], r[4], r[5], r[6]]), [
    ['2026-11-10', 900, 'Dividend · PTT', 'Bank', '', ''],
    ['2026-11-11', 70, 'Dividend · AAPL', 'IB', 2, 'USD'],
  ]);
  // Net worth: what moved since the transfers is only fees, dividends, the exchange-rate difference on T3 and the car
  const totalAfter = mt.api({ action: 'getAccounts' }).totalBalance;
  near(totalAfter - totalBefore, -50 - 35 + 900 + 70 + 500000);
});
