// Where a holding's current price came from (Holdings.PriceSource): "trade" (copied from your latest buy/sale, a
// placeholder), "manual" (typed in the app) or "market" (a price refresh). The app labels a "trade" price so a
// purchase price is never mistaken for today's market price. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, (msg || '') + ` expected ${b}, got ${a}`);
function setup() {
  const b = createBackend({ now: '2026-11-27T05:00:00Z' });
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const goldBar = () => {
    const r = b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'Gold bar 96.5%', kind: 'gold', unit: 'baht-weight' },
      quantity: 0.5, price: 70000, amount: 35000, account: '', date: '2026-02-20' });
    assert.ok(r.ok, r.error);
    return r;
  };
  // GOOGLEFINANCE stand-in: gold and the USD rate, or nothing at all
  const google = (gold, usd) => { b.context.evalFormulas = fs => fs.map(f => {
    const label = f[0].replace(/^="|"$/g, '');
    if (label === 'USD') return [label, usd || '', ''];
    return [label, label === 'CURRENCY:XAUUSD' ? (gold || '') : '', ''];
  }); };
  return { b, holding, goldBar, google };
}

test('a buy sets a "trade" price: the purchase price, labelled as a placeholder', () => {
  const { b, holding, goldBar } = setup();
  goldBar();
  const h = holding('Gold bar 96.5%');
  near(h.currentPrice, 70000); assert.equal(h.priceDate, '2026-02-20');
  assert.equal(h.priceSource, 'trade');
  assert.equal(h.priceError, '', 'no refresh tried yet');
  assert.equal(b.sheets.Holdings.rows[0][12], 'PriceSource');
  near(h.value, 35000, 'valued at what was paid until a market price arrives');
});

test('a refresh that finds no price keeps the placeholder and says why', () => {
  const { b, holding, goldBar, google } = setup();
  goldBar();
  google('', 34.05);                                  // Google has no gold; Yahoo is unreachable in tests
  const res = b.api({ action: 'refreshPrices' });
  assert.equal(res.updated.length, 0);
  const h = holding('Gold bar 96.5%');
  assert.equal(h.priceSource, 'trade');
  near(h.currentPrice, 70000);
  assert.match(h.priceError, /Yahoo/, 'the reason from the refresh: ' + h.priceError);
});

test('a refresh that finds the market price replaces the placeholder and clears the reason', () => {
  const { b, holding, goldBar, google } = setup();
  goldBar();
  google('', 34.05); b.api({ action: 'refreshPrices' });
  google(3568.60, 34.0475); b.api({ action: 'refreshPrices' });
  const h = holding('Gold bar 96.5%');
  assert.equal(h.priceSource, 'market');
  assert.equal(h.priceError, '');
  near(h.currentPrice, 3568.60 * 0.47295 * 34.0475);
  assert.equal(h.priceDate, '2026-11-27');
});

test('a price typed in the app is "manual"; a later buy dated before it does not replace it', () => {
  const { b, holding, goldBar } = setup();
  const r = goldBar();
  b.api({ action: 'updateHolding', id: r.holdingId, currentPrice: 57350, priceDate: '2026-11-27' });
  assert.equal(holding('Gold bar 96.5%').priceSource, 'manual');
  b.api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 0.25, price: 60000, account: '', date: '2026-06-01' });
  const h = holding('Gold bar 96.5%');
  assert.equal(h.priceSource, 'manual'); near(h.currentPrice, 57350);
  b.api({ action: 'updateHolding', id: r.holdingId, unit: 'baht' });               // not a price change
  assert.equal(holding('Gold bar 96.5%').priceSource, 'manual');
});

test('a newer buy makes it a "trade" price again; a failure reason only shows on a trade price', () => {
  const { b, holding, goldBar, google } = setup();
  const r = goldBar();
  b.api({ action: 'updateHolding', id: r.holdingId, currentPrice: 57350, priceDate: '2026-11-20' });
  google('', 34.05); b.api({ action: 'refreshPrices' });
  assert.equal(holding('Gold bar 96.5%').priceError, '', 'typed price: no warning');
  b.api({ action: 'addHoldingTxn', type: 'buy', holdingId: r.holdingId, quantity: 0.25, price: 58000, account: '', date: '2026-11-27' });
  const h = holding('Gold bar 96.5%');
  assert.equal(h.priceSource, 'trade'); near(h.currentPrice, 58000);
  assert.match(h.priceError, /Yahoo/);
});

test('rows saved before the column: a price equal to a trade on its date is a "trade" price; others are unknown', () => {
  const { b, holding, goldBar } = setup();
  const r = goldBar();
  const row = b.sheets.Holdings.rows.findIndex(x => x[0] === r.holdingId);
  b.sheets.Holdings.rows[row][12] = '';                                         // as before this change
  assert.equal(holding('Gold bar 96.5%').priceSource, 'trade');
  b.sheets.Holdings.rows[row][5] = 57000;                                       // a different price, typed long ago
  assert.equal(holding('Gold bar 96.5%').priceSource, '');
});
