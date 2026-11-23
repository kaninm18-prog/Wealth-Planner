// Trading journal, ported from Money Tracker (Stage 4, step 3b). This is Money Tracker's trades test
// from tests/holdings.test.js without the account-balance part: this app has no accounts, and the
// broker-cash ledger comes in step 3d. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend();
  const trades = () => b.context.tradeRows();
  const byTicket = tk => trades().find(t => t.ticket === tk);
  return { api: b.api, sheets: b.sheets, context: b.context, trades, byTicket };
}
const closed = { ticket: '1', symbol: 'xauusd', side: 'BUY', volume: 0.1, openTime: '2026.02.01 10:00', openPrice: 2000,
  closeTime: '2026-02-01T12:00:00', closePrice: 2005, commission: -2, swap: -1, profit: 50, account: 'MTS Gold', currency: 'usd' };

test('Trades tab has exactly Money Tracker\'s columns, so it can be copied across as it is', () => {
  const { api, sheets } = setup();
  api(Object.assign({ action: 'addTrade' }, closed));
  assert.deepEqual([...sheets.Trades.rows[0]], ['Id', 'Ticket', 'Symbol', 'Side', 'Volume', 'OpenTime', 'OpenPrice', 'CloseTime',
    'ClosePrice', 'Commission', 'Swap', 'Profit', 'Account', 'Note', 'Currency']);
  assert.equal(sheets.Trades.rows[1].length, 15);
});

test('a closed trade\'s net is profit + commission + swap; an open trade has no close time', () => {
  const { api, byTicket } = setup();
  const r = api(Object.assign({ action: 'addTrade' }, closed));
  assert.ok(r.ok); assert.match(r.id, /^K/);
  api({ action: 'addTrade', ticket: '2', symbol: 'XAUUSD', side: 'buy', volume: 0.1, openTime: '2026-02-02 10:00', openPrice: 2000, profit: 0 });
  const t = byTicket('1');
  near(t.net, 47, '50 - 2 - 1');
  assert.equal(t.symbol, 'XAUUSD'); assert.equal(t.side, 'buy'); assert.equal(t.currency, 'USD');
  assert.equal(t.openTime, '2026-02-01 10:00', 'MT5 dots become dashes');
  assert.equal(t.closeTime, '2026-02-01 12:00');
  assert.equal(t.account, 'MTS Gold', 'account is a plain broker name');
  const open = byTicket('2');
  assert.equal(open.closeTime, ''); assert.equal(open.closePrice, 0);
  assert.equal(open.currency, 'USD', 'currency defaults to USD');
});

test('addTrade needs a symbol and volume, and the same id twice is a duplicate', () => {
  const { api, trades } = setup();
  assert.equal(api({ action: 'addTrade', symbol: 'XAUUSD', volume: 0 }).ok, false);
  assert.equal(api({ action: 'addTrade', volume: 1 }).ok, false);
  api(Object.assign({ action: 'addTrade', id: 'K1' }, closed));
  const again = api(Object.assign({ action: 'addTrade', id: 'K1' }, closed));
  assert.ok(again.duplicate);
  assert.equal(trades().length, 1);
});

test('getTrades rows are in column order; deleteTrade finds the row by Id', () => {
  const { api, trades } = setup();
  const a = api(Object.assign({ action: 'addTrade' }, closed));
  const b = api(Object.assign({ action: 'addTrade' }, closed, { ticket: '9', note: 'second' }));
  const rows = api({ action: 'getTrades' }).trades;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], [a.id, '1', 'XAUUSD', 'buy', 0.1, '2026-02-01 10:00', 2000, '2026-02-01 12:00', 2005, -2, -1, 50, 'MTS Gold', '', 'USD']);
  assert.ok(api({ action: 'deleteTrade', id: a.id, rowIndex: 3 }).ok, 'a wrong row hint still finds the row');
  assert.deepEqual([...trades().map(t => t.id)], [b.id]);
  assert.equal(api({ action: 'deleteTrade', id: a.id }).stale, true, 'already gone');
});

test('importTrades skips a ticket that is already saved; relink moves it to the new account', () => {
  const { api, byTicket, trades } = setup();
  api(Object.assign({ action: 'addTrade' }, closed));
  const imp = api({ action: 'importTrades', account: 'MTS Gold', trades: [
    { ticket: '1', symbol: 'XAUUSD', volume: 0.1, profit: 50 },
    { ticket: '5', symbol: 'XAUUSD', volume: 0.2, profit: -10 },
    { ticket: '5', symbol: 'XAUUSD', volume: 0.2, profit: -10 },
    { ticket: '6', symbol: '', volume: 0.2 }] });
  assert.equal(imp.added, 1, 'a ticket already saved is skipped');
  assert.equal(imp.skipped, 3, 'saved ticket, repeat inside the file, no symbol');
  assert.equal(byTicket('5').account, 'MTS Gold', 'imported trades get the chosen account');
  // same account + relink: nothing to move
  assert.equal(api({ action: 'importTrades', account: 'MTS Gold', relink: true, trades: [{ ticket: '1', symbol: 'XAUUSD', volume: 0.1 }] }).relinked, 0);
  // another account + relink: moved, not added
  const rel = api({ action: 'importTrades', account: '', relink: true, trades: [{ ticket: '1', symbol: 'XAUUSD', volume: 0.1 }] });
  assert.equal(rel.relinked, 1); assert.equal(rel.added, 0);
  assert.equal(byTicket('1').account, '', 'unlinked');
  near(byTicket('1').net, 47, 'the rest of the row is untouched');
  // without relink a different account changes nothing
  api({ action: 'importTrades', account: 'Other', trades: [{ ticket: '1', symbol: 'XAUUSD', volume: 0.1 }] });
  assert.equal(byTicket('1').account, '');
  assert.equal(trades().length, 2);
});

test('bootstrap returns trades like getTrades, and tradeCount is the real count', () => {
  const { api } = setup();
  let boot = api({ action: 'bootstrap' });
  assert.deepEqual(boot.trades, []);
  assert.equal(boot.portfolio.tradeCount, 0);
  api(Object.assign({ action: 'addTrade' }, closed));
  api(Object.assign({ action: 'addTrade' }, closed, { ticket: '2' }));
  boot = api({ action: 'bootstrap' });
  assert.deepEqual(boot.trades, api({ action: 'getTrades' }).trades);
  assert.equal(boot.trades.length, 2);
  assert.equal(boot.portfolio.tradeCount, 2);
});
