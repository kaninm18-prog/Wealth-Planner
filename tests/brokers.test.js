// Brokers, the broker-cash ledger and the exports for Money Tracker (Stage 4 step 3d;
// Money Tracker's docs/stage-4-plan.md D2, D3, section 3, C1–C8). Money Tracker's side is the second
// fake spreadsheet (harness `money`). Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, MONEY_ID } = require('./harness');

const NOW = '2026-11-23T03:00:00Z';                 // 10:00 in Thailand
const TODAY = '2026-11-23';
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);

function setup(opts) {
  const b = createBackend(Object.assign({ now: NOW }, opts || {}));
  b.props.MONEY_SHEET_ID = MONEY_ID;
  b.money.setFlows([]);
  const buy = (name, kind, qty, price, account, date, extra) => {
    const h = b.api({ action: 'getHoldings' }).holdings.find(x => x.name === name);
    return b.api(Object.assign({ action: 'addHoldingTxn', type: 'buy', quantity: qty, price, account, date },
      h ? { holdingId: h.id } : { holding: { name, kind } }, extra || {}));
  };
  const txn = (type, name, extra) => {
    const h = b.api({ action: 'getHoldings' }).holdings.find(x => x.name === name);
    return b.api(Object.assign({ action: 'addHoldingTxn', type, holdingId: h.id }, extra));
  };
  const ledger = () => b.api({ action: 'getBrokers' });
  const broker = name => ledger().brokers.find(x => x.name === name);
  const values = () => plain(b.sheets._Export_Values.rows);
  const valueRow = name => values().find(r => r[0] === name);
  const dividends = () => plain(b.sheets._Export_Dividends.rows);
  return Object.assign(b, { buy, txn, ledger, broker, values, valueRow, dividends });
}

// ── Brokers tab ──────────────────────────────────────────────
test('Brokers tab: Name | Currency | DividendsTo | Rate | Note, added and changed by Name', () => {
  const b = setup();
  assert.ok(b.api({ action: 'setBroker', name: 'KS', currency: 'thb', note: 'Kasikorn' }).added);
  assert.ok(b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35, dividendsTo: 'Bank' }).ok);
  assert.deepEqual(plain(b.sheets.Brokers.rows), [
    ['Name', 'Currency', 'DividendsTo', 'Rate', 'Note'],
    ['KS', 'THB', '', 1, 'Kasikorn'],
    ['IBKR', 'USD', 'Bank', 35, ''],
  ]);
  // change by name: no new row; an empty rate keeps the saved one; the note is kept when not sent
  const res = b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', dividendsTo: '' });
  assert.equal(res.added, false);
  assert.deepEqual(plain(b.sheets.Brokers.rows[2]), ['IBKR', 'USD', '', 35, '']);
  b.api({ action: 'setBroker', name: 'KS', currency: 'THB', dividendsTo: 'KS' });
  assert.equal(b.sheets.Brokers.rows[1][2], '', 'dividends to itself = into the broker\'s cash');
  assert.equal(b.sheets.Brokers.rows[1][4], 'Kasikorn');
  assert.equal(b.sheets.Brokers.rows.length, 3);
});

test('setBroker refuses an empty name, "Other assets" and a bad currency; a new foreign broker says it needs a rate', () => {
  const b = setup();
  assert.equal(b.api({ action: 'setBroker', name: ' ' }).ok, false);
  assert.match(b.api({ action: 'setBroker', name: 'other assets' }).error, /kept for things with no broker/);
  assert.match(b.api({ action: 'setBroker', name: 'X', currency: 'dollars' }).error, /3-letter/);
  assert.equal(b.api({ action: 'setBroker', name: 'Dime', currency: 'USD' }).needsRate, true);
  assert.equal(b.api({ action: 'setBroker', name: 'KS' }).needsRate, false, 'THB is always 1');
});

test('deleteBroker is refused while holding entries or trades use the name', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.api({ action: 'setBroker', name: 'MTS', currency: 'USD', rate: 35 });
  b.api({ action: 'setBroker', name: 'Spare' });
  b.buy('PTT', 'stock', 10, 30, 'KS', '2026-11-01');
  b.api({ action: 'addTrade', ticket: '1', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-11-01 10:00', profit: 0, account: 'MTS' });
  assert.match(b.api({ action: 'deleteBroker', name: 'KS' }).error, /1 entry uses this broker/);
  assert.match(b.api({ action: 'deleteBroker', name: 'MTS' }).error, /1 entry uses/);
  assert.ok(b.api({ action: 'deleteBroker', name: 'Spare' }).ok);
  assert.deepEqual(b.sheets.Brokers.rows.map(r => r[0]), ['Name', 'KS', 'MTS']);
  assert.ok(b.api({ action: 'deleteBroker', name: 'Spare' }).stale, 'already gone');
});

test('bootstrap returns brokers (saved ones and names only used in entries)', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS', dividendsTo: 'Bank', note: 'n' });
  b.buy('Gold', 'gold', 1, 40000, 'Gold shop', '2026-11-01');
  const res = b.api({ action: 'bootstrap' });
  assert.ok(res.brokers.ok);
  const byName = Object.fromEntries(res.brokers.brokers.map(x => [x.name, x]));
  assert.deepEqual(Object.keys(byName), ['Gold shop', 'KS']);
  assert.equal(byName.KS.saved, true); assert.equal(byName.KS.dividendsTo, 'Bank');
  assert.equal(byName['Gold shop'].saved, false, 'not set up yet: THB, dividends into its cash');
  assert.equal(byName['Gold shop'].currency, 'THB');
  assert.equal(res.brokers.flows.status, 'ok');
  assert.deepEqual(plain(res.brokers.exported), { values: 3, dividends: 0, asOf: TODAY });
});

// ── Broker cash (D2) ─────────────────────────────────────────
test('THB broker cash = deposits − withdrawals − buys + sells − fees + dividends + closed trades', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.money.setFlows([['T1', '2026-11-01', 'KS', 100000, 'THB'], ['T2', '2026-11-10', 'KS', -5000, 'THB'],
                    ['T3', '2026-11-10', 'Someone else', 777, 'THB']]);
  b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02', { fee: 15 });
  b.txn('sell', 'PTT', { quantity: 20, price: 35, fee: 5, account: 'KS', date: '2026-11-03' });
  b.txn('dividend', 'PTT', { amount: 90, tax: 10, account: 'KS', date: '2026-11-04' });
  b.api({ action: 'addTrade', ticket: '1', symbol: 'SET50', side: 'buy', volume: 1, openTime: '2026-11-05 10:00', openPrice: 900,
    closeTime: '2026-11-05 12:00', closePrice: 905, commission: -2, swap: -1, profit: 50, account: 'KS', currency: 'THB' });
  b.api({ action: 'addTrade', ticket: '2', symbol: 'SET50', side: 'buy', volume: 1, openTime: '2026-11-06 10:00', profit: 0, account: 'KS', currency: 'THB' });
  const k = b.broker('KS');
  near(k.deposits, 100000); near(k.withdrawals, -5000);
  near(k.buys, 3000); near(k.sells, 700); near(k.fees, 20);
  near(k.dividends, 90, 'the amount received; the tax withheld is not taken off again');
  near(k.trades, 47, 'closed trades only: profit + commission + swap');
  near(k.cash, 100000 - 5000 - 3000 + 700 - 20 + 90 + 47);
  near(k.holdingsThb, 80 * 35, 'latest trade price');
  near(k.value, k.cash + 2800); near(k.valueThb, k.value);
  assert.equal(k.unknown, false); assert.deepEqual(plain(k.warnings), []);
  assert.ok(b.broker('Someone else'), 'a linked account with only deposits is a broker too');
  near(b.broker('Someone else').value, 777);
});

test('USD broker cash in USD: exact OrigAmount / FeeOrig in USD, other amounts THB ÷ Rate', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35 });
  b.money.setFlows([['T1', '2026-11-01', 'IBKR', 1000, 'USD'], ['T2', '2026-11-20', 'IBKR', -100, 'USD']]);
  b.buy('AAPL', 'stock', 1, 3600, 'IBKR', '2026-11-02', { origAmount: 100, currency: 'USD', fee: 35, feeOrig: 1 });
  b.buy('Fund', 'fund', 1, 350, 'IBKR', '2026-11-02', { fee: 35 });   // typed in baht
  b.txn('sell', 'AAPL', { quantity: 0.5, price: 3800, origAmount: 54, currency: 'USD', account: 'IBKR', date: '2026-11-03' });
  b.txn('dividend', 'AAPL', { amount: 70, origAmount: 2, currency: 'USD', tax: 7, taxOrig: 0.2, account: 'IBKR', date: '2026-11-04' });
  b.api({ action: 'addTrade', ticket: '1', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-11-05 10:00', openPrice: 2000,
    closeTime: '2026-11-05 12:00', closePrice: 2005, commission: -2, swap: -1, profit: 50, account: 'IBKR' });
  const k = b.broker('IBKR');
  near(k.deposits, 1000); near(k.withdrawals, -100);
  near(k.buys, 100 + 10, '100 USD exactly (not 3600 ÷ 35), and 350 THB ÷ 35');
  near(k.sells, 54); near(k.fees, 1 + 1, 'FeeOrig 1 USD, and 35 THB ÷ 35');
  near(k.dividends, 2); near(k.trades, 47);
  near(k.cash, 1000 - 100 - 110 + 54 - 2 + 2 + 47);
  near(k.cashThb, k.cash * 35);
  near(k.holdingsThb, 0.5 * 3800 + 350);
  near(k.holdings, (0.5 * 3800 + 350) / 35, 'market value in USD');
  near(k.value, k.cash + (1900 + 350) / 35);
  near(k.valueThb, 891 * 35 + 2250, 'cash × Rate + market value, from the unrounded value');
  const row = b.valueRow('IBKR');
  assert.equal(row[1], 'USD'); near(row[2], k.value); near(row[3], 891 * 35 + 2250);
});

test('a dividend paid to a bank (DividendsTo) does not add to broker cash; changing the setting says how many move', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02');
  b.txn('dividend', 'PTT', { amount: 90, tax: 10, account: 'KS', date: '2026-11-04' });
  near(b.broker('KS').dividends, 90);
  const res = b.api({ action: 'setBroker', name: 'KS', dividendsTo: 'Bank' });
  assert.equal(res.dividendsMoved, 1, 'the app warns that the saved dividend now goes to Bank too');
  const k = b.broker('KS');
  near(k.dividends, 0); near(k.dividendsElsewhere, 90);
  near(k.cash, -3000, 'no deposits in this test: only the buy');
  assert.equal(b.dividends()[1][7], 'Bank', 'exported to the bank (C2)');
  assert.equal(b.api({ action: 'setBroker', name: 'KS', dividendsTo: 'Bank', note: 'x' }).dividendsMoved, 0, 'unchanged setting');
});

test('C1: a transfer between two linked accounts (same Id) is a withdrawal on one broker and a deposit on the other', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.api({ action: 'setBroker', name: 'SCBS' });
  b.money.setFlows([['T1', '2026-11-01', 'KS', 50000, 'THB'], ['T2', '2026-11-02', 'KS', -20000, 'THB'], ['T2', '2026-11-02', 'SCBS', 20000, 'THB'],
                    ['T3', '2026-11-03', 'KS', -700, 'THB'], ['T3', '2026-11-03', 'KS', 700, 'THB']]);   // a transfer from KS to KS: nets 0
  const ks = b.broker('KS'), sc = b.broker('SCBS');
  near(ks.deposits, 50700); near(ks.withdrawals, -20700); near(ks.cash, 30000);
  near(sc.deposits, 20000); near(sc.cash, 20000, 'the same Id on another Account is its own row');
});

test('a flow in another currency than the broker is converted, with a warning', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35 });
  b.money.setFlows([['T1', '2026-11-01', 'IBKR', 3500, 'THB']]);
  const k = b.broker('IBKR');
  near(k.deposits, 100);
  assert.match(k.warnings[0], /Money Tracker keeps this account in THB, here it is USD/);
});

// ── Money Tracker can't be read: cache + stale, never silent zero ──
test('Money Tracker unreadable: the cached flows are used, marked stale with their date; the export says "as of" that date', () => {
  const b = setup({ now: '2026-11-20T03:00:00Z' });
  b.api({ action: 'setBroker', name: 'KS' });
  b.money.setFlows([['T1', '2026-11-01', 'KS', 100000, 'THB']]);
  b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02');
  assert.equal(b.ledger().flows.status, 'ok');
  assert.ok(b.props.MONEY_FLOWS_CACHE);
  const later = createBackend({ now: NOW });           // three days on, same sheet and properties
  Object.assign(later.sheets, b.sheets); Object.assign(later.props, b.props);
  later.money.broken = true;
  let res = later.api({ action: 'bootstrap' }).brokers;
  assert.deepEqual(plain(res.flows), { setUp: true, status: 'stale', asOf: '2026-11-20', error: "Money Tracker's sheet could not be opened" });
  const k = res.brokers.find(x => x.name === 'KS');
  near(k.deposits, 100000, 'from the cache'); near(k.value, 100000);
  assert.equal(k.unknown, false);
  const row = plain(later.sheets._Export_Values.rows).find(r => r[0] === 'KS');
  assert.deepEqual(row, ['KS', 'THB', 100000, 100000, '2026-11-20'],
    'AsOf = the day the flows were read, so Money Tracker adds the transfers made since (C4)');
  assert.equal(plain(later.sheets._Export_Values.rows).find(r => r[0] === 'Other assets')[4], TODAY);
  // the tab missing, or its columns changed, counts as unreadable too
  later.money.broken = false; later.money.removeTab('_Export_LinkedFlows');
  assert.equal(later.api({ action: 'getBrokers' }).flows.status, 'stale');
  later.money.setTab('_Export_LinkedFlows', ['Id', 'Account', 'Date', 'Amount', 'Currency'], [['T9', 'KS', '2026-11-21', 5, 'THB']]);
  res = later.api({ action: 'getBrokers' });
  assert.equal(res.flows.status, 'stale'); assert.match(res.flows.error, /unexpected columns/);
  near(res.brokers.find(x => x.name === 'KS').deposits, 100000);
  // readable again: fresh
  later.money.setFlows([['T1', '2026-11-01', 'KS', 100000, 'THB'], ['T9', '2026-11-21', 'KS', 5, 'THB']]);
  res = later.api({ action: 'getBrokers' });
  assert.equal(res.flows.status, 'ok'); near(res.brokers.find(x => x.name === 'KS').deposits, 100005);
});

test('never read and no cache: deposits unknown, every broker exported blank (never 0); Other assets still exported', () => {
  const b = setup();
  delete b.props.MONEY_SHEET_ID;
  b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02');
  b.buy('Car', 'vehicle', 1, 500000, '', '2026-11-02');
  let res = b.api({ action: 'bootstrap' }).brokers;
  assert.deepEqual(plain(res.flows), { setUp: false, status: 'unknown', asOf: '', error: 'MONEY_SHEET_ID is not set' });
  assert.equal(res.brokers[0].unknown, true);
  assert.deepEqual(b.values(), [['Account', 'Currency', 'Value', 'ValueTHB', 'AsOf'],
    ['KS', 'THB', '', '', TODAY], ['Other assets', 'THB', 500000, 500000, TODAY]]);
  b.props.MONEY_SHEET_ID = MONEY_ID; b.money.broken = true;    // set, but unreadable, and never read before
  res = b.api({ action: 'bootstrap' }).brokers;
  assert.equal(res.flows.status, 'unknown'); assert.equal(res.flows.setUp, true);
  assert.equal(b.valueRow('KS')[2], '');
  assert.ok(!b.props.MONEY_FLOWS_CACHE, 'nothing cached from a failed read');
  b.money.broken = false;                                      // an empty flows tab is a real "no deposits"
  res = b.api({ action: 'bootstrap' }).brokers;
  assert.equal(res.flows.status, 'ok');
  assert.deepEqual(b.valueRow('KS'), ['KS', 'THB', 0, 0, TODAY], '−3000 cash + 3000 of PTT');
});

test('a foreign broker with no rate is exported blank until refreshPrices fills its Rate', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD' });
  b.money.setFlows([['T1', '2026-11-01', 'IBKR', 1000, 'USD']]);
  b.buy('Fund', 'fund', 1, 350, 'IBKR', '2026-11-02');
  const k = b.broker('IBKR');
  assert.equal(k.unknown, true); assert.match(k.warnings.join(), /No exchange rate for USD/);
  assert.equal(b.valueRow('IBKR')[2], '');
  b.context.evalFormulas = formulas => formulas.map(f => [f[0].replace(/^="|"$/g, ''), /CURRENCY:USDTHB/.test(f[1]) ? 36 : '', '']);
  const r = b.api({ action: 'refreshPrices' });
  assert.deepEqual(plain(r.rates), { USD: 36 }, 'the broker currency is looked up even with no USD holding');
  assert.equal(b.sheets.Brokers.rows[1][3], 36);
  assert.deepEqual(JSON.parse(b.props.FX_RATES), { USD: 36 });
  near(b.valueRow('IBKR')[2], 1000 - 350 / 36 + 350 / 36, 'refreshPrices rebuilt the export');
  near(b.valueRow('IBKR')[3], 36000);
});

test('a USD trade on a THB broker needs a USD rate; with one it is converted', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.api({ action: 'addTrade', ticket: '1', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-11-05 10:00', closeTime: '2026-11-05 12:00',
    profit: 10, account: 'KS' });
  assert.equal(b.broker('KS').unknown, true);
  b.props.FX_RATES = JSON.stringify({ USD: 35 });
  const k = b.broker('KS');
  assert.equal(k.unknown, false); near(k.trades, 350);
});

// ── _Export_Values ──────────────────────────────────────────
test('_Export_Values: one row per broker (cash + what is held there), holdings split across brokers, the Other assets row (C7)', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35 });
  b.money.setFlows([['T1', '2026-11-01', 'KS', 10000, 'THB'], ['T2', '2026-11-01', 'IBKR', 200, 'USD']]);
  b.buy('Gold ETF', 'etf', 100, 20, 'KS', '2026-11-02');                       // 2000 THB at KS
  b.buy('Gold ETF', 'etf', 50, 21, 'IBKR', '2026-11-03', { origAmount: 30, currency: 'USD' });   // 1050 THB = 30 USD at IBKR
  b.txn('sell', 'Gold ETF', { quantity: 20, price: 25, account: 'KS', date: '2026-11-04' });   // price is now 25
  b.buy('Car', 'vehicle', 1, 500000, '', '2026-11-02');                       // no broker
  b.buy('Gold bar', 'gold', 1, 40000, '', '2026-11-02');                      // already owned, no money moved
  const L = b.ledger();
  const ks = L.brokers.find(x => x.name === 'KS'), ib = L.brokers.find(x => x.name === 'IBKR');
  assert.deepEqual(plain(ks.positions).map(p => [p.name, p.quantity, p.valueThb]), [['Gold ETF', 80, 2000]]);
  assert.deepEqual(plain(ib.positions).map(p => [p.name, p.quantity, p.valueThb]), [['Gold ETF', 50, 1250]]);
  near(ks.value, 10000 - 2000 + 500 + 80 * 25);
  near(ib.value, 200 - 30 + 50 * 25 / 35);
  assert.deepEqual(b.values(), [
    ['Account', 'Currency', 'Value', 'ValueTHB', 'AsOf'],
    ['IBKR', 'USD', Math.round((200 - 30 + 1250 / 35) * 100) / 100, Math.round((170 * 35 + 1250) * 100) / 100, TODAY],
    ['KS', 'THB', 10500, 10500, TODAY],
    ['Other assets', 'THB', 540000, 540000, TODAY],
  ]);
  assert.ok(b.sheets._Export_Values.hidden);
});

test('every holding lands in exactly one row: rows (THB) = holdings value + all broker cash', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 34.7 });
  b.money.setFlows([['T1', '2026-11-01', 'KS', 12345.67, 'THB'], ['T2', '2026-11-01', 'IBKR', 987.65, 'USD']]);
  b.buy('PTT', 'stock', 100, 31.25, 'KS', '2026-11-02', { fee: 7.5 });
  b.buy('PTT', 'stock', 33, 31.5, 'IBKR', '2026-11-02', { origAmount: 29.96, currency: 'USD' });
  b.buy('PTT', 'stock', 7, 30, '', '2026-11-02');
  b.txn('sell', 'PTT', { quantity: 40, price: 32.1, account: 'IBKR', date: '2026-11-03' });   // more than bought there
  b.buy('Unpriced fund', 'fund', 3, 1000, 'KS', '2026-11-02');
  b.api({ action: 'updateHolding', id: b.api({ action: 'getHoldings' }).holdings.find(h => h.name === 'Unpriced fund').id, currentPrice: 0 });
  b.buy('House', 'property', 1, 3000000, '', '2026-11-02');
  b.txn('dividend', 'PTT', { amount: 33.3, tax: 3.7, account: 'KS', date: '2026-11-04' });
  const L = b.ledger(), hold = b.api({ action: 'getHoldings' }).totals.value;
  near(L.check.holdingsThb, hold);
  near(L.check.diff, 0, 'rows − holdings − cash');
  const rowsThb = b.values().slice(1).reduce((a, r) => a + r[3], 0);
  const cashThb = L.brokers.reduce((a, x) => a + x.cashThb, 0);
  assert.ok(Math.abs(rowsThb - (hold + cashThb)) < 0.02, `export rows ${rowsThb} vs holdings ${hold} + cash ${cashThb}`);
  const heldThb = L.brokers.reduce((a, x) => a + x.holdingsThb, 0) + L.other.valueThb;
  near(heldThb, hold, 'the slices add up to the whole');
  assert.match(L.brokers.find(x => x.name === 'IBKR').warnings.join(), /More sold here than bought here/);
});

// ── _Export_Dividends (C2, C6, C8) ──────────────────────────
test('_Export_Dividends: only WD… dividends; Account is the broker or its DividendsTo bank; Tax in THB', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'KS' });
  b.api({ action: 'setBroker', name: 'IBKR', currency: 'USD', rate: 35, dividendsTo: 'Bank USD' });
  b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02');
  b.buy('AAPL', 'stock', 1, 7000, 'IBKR', '2026-11-02', { origAmount: 200, currency: 'USD' });
  const d1 = b.txn('dividend', 'PTT', { amount: 90, tax: 10, account: 'KS', date: '2026-11-05' });
  const d2 = b.txn('dividend', 'AAPL', { amount: 70, origAmount: 2, currency: 'USD', tax: 10.5, taxOrig: 0.3, account: 'IBKR', date: '2026-11-04' });
  b.txn('dividend', 'PTT', { id: 'X0123456789', amount: 50, account: 'KS', date: '2026-11-06' });      // an old Id (copied from Money Tracker)
  b.txn('dividend', 'PTT', { id: 'WDfromapp01', amount: 40, account: 'KS', date: '2026-11-06' });       // the app's own retry id
  assert.match(d1.id, /^WD/); assert.match(d2.id, /^WD/);
  const buyId = b.sheets.HoldingTxns.rows[1][0];
  assert.match(buyId, /^X/, 'other types keep X');
  assert.deepEqual(b.dividends(), [
    ['Id', 'Date', 'Holding', 'Amount', 'OrigAmount', 'Currency', 'Tax', 'Account'],
    [d2.id, '2026-11-04', 'AAPL', 70, 2, 'USD', 10.5, 'Bank USD'],
    [d1.id, '2026-11-05', 'PTT', 90, '', 'THB', 10, 'KS'],
    ['WDfromapp01', '2026-11-06', 'PTT', 40, '', 'THB', 0, 'KS'],
  ]);
  assert.ok(b.sheets._Export_Dividends.hidden);
  near(b.broker('KS').dividends, 90 + 50 + 40, 'old-Id dividends still count in broker cash, they are just not exported');
  // rebuilt whole: a deleted dividend disappears
  b.api({ action: 'deleteHoldingTxn', id: d1.id });
  assert.deepEqual(b.dividends().map(r => r[0]), ['Id', d2.id, 'WDfromapp01']);
});

test('TaxOrig (C6): stored for a USD dividend, empty for THB; old 13- and 14-column rows still read', () => {
  const b = setup();
  b.buy('AAPL', 'stock', 1, 7000, 'IBKR', '2026-11-02', { origAmount: 200, currency: 'USD' });
  b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02');
  b.txn('dividend', 'AAPL', { amount: 70, origAmount: 2, currency: 'usd', tax: 10.5, taxOrig: 0.3, account: 'IBKR', date: '2026-11-04' });
  b.txn('dividend', 'PTT', { amount: 90, tax: 10, taxOrig: 10, currency: 'THB', account: 'KS', date: '2026-11-04' });
  b.txn('dividend', 'AAPL', { amount: 35, origAmount: 1, currency: 'USD', account: 'IBKR', date: '2026-11-05', taxOrig: 0.1 });   // no tax: none stored
  const rows = b.sheets.HoldingTxns.rows;
  assert.equal(rows[0][14], 'TaxOrig');
  const [usd, thb, noTax] = rows.filter(r => r[3] === 'dividend');
  assert.equal(usd[14], 0.3); assert.equal(usd[12], 'USD'); assert.equal(usd[7], 10.5, 'Fee (tax) stays in THB');
  assert.ok(!usd[13], 'no FeeOrig on a dividend');
  assert.ok(!thb[14]); assert.ok(!thb[12]);
  assert.ok(!noTax[14]);
  assert.deepEqual(plain(b.context.holdingTxnRows().filter(t => t.type === 'dividend').map(t => t.taxOrig)), [0.3, 0, 0]);
  // a tab copied from Money Tracker (13 columns) and one from before this step (14 columns)
  const old = setup();
  old.api({ action: 'getHoldings' });
  old.sheets.Holdings.rows.push(['H1', 'PTT', 'stock', '', 'shares', '', '', '', 'active']);
  old.sheets.HoldingTxns.rows[0] = old.sheets.HoldingTxns.rows[0].slice(0, 13);
  old.sheets.HoldingTxns.rows.push(['X1', 'H1', '2026-01-10', 'buy', 10, 30, 300, 5, 'KS', '', 'E1', '', '']);
  old.sheets.HoldingTxns.rows.push(['X2', 'H1', '2026-01-11', 'buy', 10, 30, 300, 35, 'IBKR', '', '', 10, 'USD', 1]);
  old.sheets.HoldingTxns.rows.push(['X3', 'H1', '2026-02-10', 'dividend', '', '', 20, 2, 'KS', '', 'I1', '', '']);
  const t = old.context.holdingTxnRows();
  assert.deepEqual(plain(t.map(x => [x.feeOrig, x.taxOrig])), [[0, 0], [1, 0], [0, 0]]);
  near(old.broker('KS').cash, -300 - 5 + 20);
  old.api({ action: 'bootstrap' });
  assert.deepEqual(old.dividends().slice(1), [], 'X… dividends are never exported (C5/C8)');
  old.api({ action: 'addHoldingTxn', type: 'dividend', holdingId: 'H1', amount: 7, origAmount: 0.2, currency: 'USD', tax: 0.7, taxOrig: 0.02,
    account: 'IBKR', date: '2026-02-11' });
  assert.deepEqual(plain(old.sheets.HoldingTxns.rows[0].slice(11)), ['OrigAmount', 'Currency', 'FeeOrig', 'TaxOrig'], 'headers added to the old tab');
});

// ── When the exports are written ────────────────────────────
test('exports are rebuilt after every write that changes them, on bootstrap and on dailyRefresh', () => {
  const b = setup();
  const ks = () => (b.valueRow('KS') || [])[2];
  b.money.setFlows([['T1', '2026-11-01', 'KS', 1000, 'THB']]);
  b.api({ action: 'setBroker', name: 'KS' });
  assert.equal(ks(), 1000, 'setBroker');
  const r = b.buy('PTT', 'stock', 10, 30, 'KS', '2026-11-02', { fee: 10 });
  assert.equal(ks(), 990, 'addHoldingTxn');
  b.api({ action: 'updateHolding', id: r.holdingId, currentPrice: 40 });
  assert.equal(ks(), 1090, 'updateHolding (price)');
  b.api({ action: 'addTrade', ticket: '1', symbol: 'S50', side: 'buy', volume: 1, openTime: '2026-11-02 10:00', closeTime: '2026-11-02 11:00',
    profit: 100, account: 'KS', currency: 'THB' });
  assert.equal(ks(), 1190, 'addTrade');
  b.api({ action: 'deleteTrade', id: b.context.tradeRows()[0].id });
  assert.equal(ks(), 1090, 'deleteTrade');
  b.api({ action: 'importTrades', account: 'KS', trades: [{ ticket: '2', symbol: 'S50', side: 'buy', volume: 1, openTime: '2026-11-03 10:00',
    closeTime: '2026-11-03 11:00', profit: 5, currency: 'THB' }] });
  assert.equal(ks(), 1095, 'importTrades');
  b.api({ action: 'importPack', holdingTxns: [{ id: 'Ximp1', type: 'buy', holdingId: r.holdingId, quantity: 1, price: 40, amount: 40, account: 'KS', date: '2026-11-04' }] });
  assert.equal(ks(), 1095, 'importPack: −40 cash + 40 of PTT');
  b.api({ action: 'deleteHoldingTxn', id: 'Ximp1' });
  b.api({ action: 'deleteHoldingTxn', id: r.id });
  assert.equal(ks(), 1005, 'deleteHoldingTxn: 1000 deposit + 5 trade');
  b.money.setFlows([['T1', '2026-11-01', 'KS', 1000, 'THB'], ['T2', '2026-11-05', 'KS', 500, 'THB']]);
  b.api({ action: 'bootstrap' });
  assert.equal(ks(), 1505, 'bootstrap reads new deposits');
  b.money.setFlows([['T1', '2026-11-01', 'KS', 1000, 'THB']]);
  b.run('dailyRefresh');
  assert.equal(ks(), 1005, 'dailyRefresh');
  const h = b.api({ action: 'getHoldings' }).holdings[0];
  b.api({ action: 'deleteHolding', id: h.id });
  assert.equal(ks(), 1005, 'deleteHolding');
});

test('dailyRefresh still writes the exports when the price refresh fails', () => {
  const b = setup();
  b.money.setFlows([['T1', '2026-11-01', 'KS', 1000, 'THB']]);
  b.context.refreshPrices = () => { throw new Error('GOOGLEFINANCE down'); };
  assert.throws(() => b.run('dailyRefresh'), /GOOGLEFINANCE down/);
  assert.equal(b.valueRow('KS')[2], 1000);
});

test('reads only: the Money Tracker sheet is opened, never written', () => {
  const b = setup();
  b.money.setFlows([['T1', '2026-11-01', 'KS', 1000, 'THB']]);
  const before = JSON.stringify(b.money.sheets);
  b.api({ action: 'bootstrap' });
  b.buy('PTT', 'stock', 10, 30, 'KS', '2026-11-02');
  assert.equal(JSON.stringify(b.money.sheets), before);
  assert.ok(b.money.opened >= 2);
});

// ── Moving a holding out of / into a broker with no account (agreed rule, review of #5) ──
const allSlices = L => L.brokers.flatMap(x => x.positions).concat(L.other.positions);
function noNegative(L) { allSlices(L).forEach(p => assert.ok(p.quantity >= 0, `${p.name} has ${p.quantity} in a slice`)); }

test('MTS case: a gold bar withdrawn (no-broker sell) leaves the broker; the bar is an Other asset', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'MTS Gold' });
  b.money.setFlows([['T1', '2026-11-01', 'MTS Gold', 90000, 'THB']]);
  b.buy('MTS gold', 'gold', 2, 42000, 'MTS Gold', '2026-11-02');                     // baht-weight
  b.txn('sell', 'MTS gold', { quantity: 2, price: 42000, account: '', date: '2026-11-10' });   // bar withdrawn: no cash moves
  b.buy('Gold bar', 'gold', 1, 84000, '', '2026-11-10');
  const L = b.ledger(), mts = L.brokers.find(x => x.name === 'MTS Gold');
  assert.deepEqual(plain(mts.positions), [], 'no phantom position at the broker');
  near(mts.cash, 6000); near(mts.value, 6000, 'value = cash only');
  near(mts.sells, 0, 'the withdrawal is not cash');
  near(L.other.value, 84000, 'Other assets = the bar');
  assert.deepEqual(plain(L.other.positions).map(p => [p.name, p.quantity]), [['Gold bar', 1]]);
  near(L.check.diff, 0); noNegative(L);
  assert.deepEqual(mts.warnings, []);
  assert.deepEqual(b.valueRow('MTS Gold'), ['MTS Gold', 'THB', 6000, 6000, TODAY]);
  assert.deepEqual(b.valueRow('Other assets'), ['Other assets', 'THB', 84000, 84000, TODAY]);
});

test('a partial withdrawal comes out of the one broker; a no-broker buy of something held at one broker goes into it', () => {
  const b = setup();
  b.money.setFlows([['T1', '2026-11-01', 'MTS Gold', 300000, 'THB']]);
  b.buy('MTS gold', 'gold', 5, 42000, 'MTS Gold', '2026-11-02');
  b.txn('sell', 'MTS gold', { quantity: 2, price: 42000, account: '', date: '2026-11-10' });
  let L = b.ledger(), mts = L.brokers.find(x => x.name === 'MTS Gold');
  assert.deepEqual(plain(mts.positions).map(p => [p.name, p.quantity, p.valueThb]), [['MTS gold', 3, 126000]]);
  assert.deepEqual(plain(L.other.positions), []);
  near(mts.cash, 300000 - 210000);
  b.buy('MTS gold', 'gold', 1, 43000, '', '2026-11-12');                             // brought back in, no cash
  L = b.ledger(); mts = L.brokers.find(x => x.name === 'MTS Gold');
  assert.deepEqual(plain(mts.positions).map(p => [p.name, p.quantity, p.valueThb]), [['MTS gold', 4, 172000]]);
  near(mts.cash, 90000); near(L.check.diff, 0); noNegative(L);
  // order is by date, not by when the entry was typed
  b.buy('Coin', 'gold', 1, 1000, 'MTS Gold', '2026-11-01');
  b.buy('Coin', 'gold', 1, 1000, '', '2026-10-01');                                  // typed later, but owned before any broker held it
  L = b.ledger();
  assert.deepEqual(plain(L.other.positions).map(p => [p.name, p.quantity]), [['Coin', 1]]);
  near(L.check.diff, 0);
});

test('held at more than one broker: a no-broker move is not guessed — it stays without a broker, both brokers are warned, nothing goes negative', () => {
  const b = setup();
  b.api({ action: 'setBroker', name: 'A' }); b.api({ action: 'setBroker', name: 'B' });
  b.buy('PTT', 'stock', 20, 30, 'A', '2026-11-02');
  b.buy('PTT', 'stock', 30, 30, 'B', '2026-11-02');
  b.buy('PTT', 'stock', 5, 30, '', '2026-11-03');                                    // no-broker buy
  let L = b.ledger();
  const slices = () => Object.fromEntries([...L.brokers.map(x => [x.name, (x.positions[0] || {}).quantity || 0]), ['other', (L.other.positions[0] || {}).quantity || 0]]);
  assert.deepEqual(slices(), { A: 20, B: 30, other: 5 });
  ['A', 'B'].forEach(n => assert.match(L.brokers.find(x => x.name === n).warnings.join(), /Moved without a broker — check where it is held/));
  b.txn('sell', 'PTT', { quantity: 3, price: 30, account: '', date: '2026-11-04' });   // from the no-broker slice
  L = b.ledger();
  assert.deepEqual(slices(), { A: 20, B: 30, other: 2 });
  b.txn('sell', 'PTT', { quantity: 12, price: 30, account: '', date: '2026-11-05' });  // more than it holds: the rest from A and B
  L = b.ledger();
  const s = slices();
  near(s.other, 0); near(s.A, 20 - 10 * 20 / 50); near(s.B, 30 - 10 * 30 / 50);
  noNegative(L); near(L.check.diff, 0);
  near(L.brokers.find(x => x.name === 'A').sells, 0, 'no cash moves on a no-broker entry');
});

test('importPack: imported dividends get ordinary X Ids and are never exported; typed ones get WD', () => {
  const b = setup();
  const r = b.buy('PTT', 'stock', 100, 30, 'KS', '2026-11-02');
  const res = b.api({ action: 'importPack', holdingTxns: [
    { type: 'dividend', holdingId: r.holdingId, amount: 90, tax: 10, account: 'KS', date: '2026-05-01' },
    { type: 'buy', holdingId: r.holdingId, quantity: 1, price: 30, account: 'KS', date: '2026-05-02' }] });
  assert.equal(res.holdings.added, 2);
  const typed = b.txn('dividend', 'PTT', { amount: 50, account: 'KS', date: '2026-11-10' });
  const divs = b.sheets.HoldingTxns.rows.filter(t => t[3] === 'dividend').map(t => t[0]);
  assert.match(divs[0], /^X/, 'imported'); assert.match(divs[1], /^WD/, 'typed');
  assert.deepEqual(b.dividends().slice(1).map(d => d[0]), [typed.id]);
  near(b.broker('KS').dividends, 140, 'both still count in broker cash');
});
