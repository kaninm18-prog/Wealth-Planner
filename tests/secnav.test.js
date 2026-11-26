// Thai mutual fund prices (NAV) from the Thai SEC Open API, after Google Finance and Yahoo (src/16_sec_nav.gs).
// UrlFetchApp is stubbed: no request leaves the machine. The key is a fake one, never a real key.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

const FAKE_KEY = 'fake-sec-key-for-tests';
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.0001, (msg || '') + ` expected ${b}, got ${a}`);

// sec: { profiles: { '<project_info or fund_class_name value>': [items] | <status code> }, nav: { '<proj_id>': [items] | code } }
function setup(opts) {
  opts = opts || {};
  const b = createBackend({ now: opts.now || '2026-11-25T03:00:00Z' });          // a Wednesday
  if (opts.key !== false) b.props.SEC_API_KEY = FAKE_KEY;
  const log = [];
  const sec = { profiles: {}, nav: {} };
  b.context.UrlFetchApp = { fetchAll(reqs) {
    return reqs.map(r => {
      const u = new URL(r.url);
      if (u.hostname !== 'api.sec.or.th') {                                     // Yahoo: nothing for a Thai fund
        log.push({ host: u.hostname });
        return { getResponseCode: () => 404, getContentText: () => '{"chart":{"result":null}}' };
      }
      log.push({ host: u.hostname, path: u.pathname, q: Object.fromEntries(u.searchParams), key: r.headers['Ocp-Apim-Subscription-Key'] });
      if (opts.status) return { getResponseCode: () => opts.status, getContentText: () => '' };
      let ans;
      if (u.pathname === '/v2/fund/general-info/profiles') ans = sec.profiles[u.searchParams.get('project_info') || ('class:' + u.searchParams.get('fund_class_name'))];
      else if (u.pathname === '/v2/fund/daily-info/nav') ans = sec.nav[u.searchParams.get('proj_id')];
      if (typeof ans === 'number') return { getResponseCode: () => ans, getContentText: () => '' };
      if (!ans || !ans.length) return { getResponseCode: () => 204, getContentText: () => '' };
      const cls = u.searchParams.get('fund_class_name');
      const items = u.pathname.endsWith('/nav') && cls ? ans.filter(x => x.fund_class_name === cls) : ans;
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ message: 'success', page_size: items.length, next_cursor: null, items }) };
    });
  } };
  // GOOGLEFINANCE has nothing (as for every Thai fund)
  b.context.evalFormulas = formulas => formulas.map(f => [f[0].replace(/^="|"$/g, ''), '', '']);
  const holding = name => b.api({ action: 'getHoldings' }).holdings.find(h => h.name === name);
  const fund = (name, symbol) => {
    const r = b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name, kind: 'fund' }, quantity: 100, price: 10, account: 'KS', date: '2026-01-10' });
    b.api({ action: 'updateHolding', id: r.holdingId, symbol });
  };
  return { b, sec, log, holding, fund, secCalls: () => log.filter(x => x.host === 'api.sec.or.th') };
}
const nav = (proj, date, val, cls) => ({ proj_id: proj, nav_date: date, fund_class_name: cls || 'KFSSF', net_asset: 1e9, last_val: val, sell_price: val, buy_price: val });
const profile = (proj, abbr, cls, status) => ({ unique_id: 'C0000000021', proj_id: proj, proj_abbr_name: abbr, fund_class_name: cls || '',
  fund_status: status || 'Registered', proj_name_en: abbr + ' fund' });

test('found and priced: the latest NAV of the last 7 days, in THB, with the key in the header', () => {
  const { b, sec, holding, fund, secCalls } = setup();
  fund('K Fixed SSF', 'SEC:KFSSF');
  sec.profiles.KFSSF = [profile('M0123_2560', 'KFSSF')];
  sec.nav['M0123_2560'] = [nav('M0123_2560', '2026-11-21', 12.1), nav('M0123_2560', '2026-11-24', 12.3456), nav('M0123_2560', '2026-11-23', 12.2)];
  const res = b.api({ action: 'refreshPrices' });
  assert.deepEqual(res.failed, []);
  assert.deepEqual(res.updated, ['K Fixed SSF']);
  assert.equal(res.sources['K Fixed SSF'], 'Thai SEC (KFSSF, NAV of 2026-11-24)');
  const h = holding('K Fixed SSF');
  near(h.currentPrice, 12.3456); assert.equal(h.priceDate, '2026-11-24', 'the NAV\'s own date');
  assert.equal(b.sheets.Holdings.rows.find(r => r[1] === 'K Fixed SSF')[9], 'THB');
  const calls = secCalls();
  assert.ok(calls.every(c => c.key === FAKE_KEY), 'Ocp-Apim-Subscription-Key on every request');
  assert.deepEqual(calls[0].q, { project_info: 'KFSSF', page_size: '100' });
  assert.deepEqual(calls[1].q, { proj_id: 'M0123_2560', start_nav_date: '2026-11-18', end_nav_date: '2026-11-25' });
});

test('weekend: on Sunday the NAV is Friday\'s; nothing for 7 days says so', () => {
  const { b, sec, holding, fund, secCalls } = setup({ now: '2026-11-22T03:00:00Z' });   // Sunday
  fund('KFSSF', 'KFSSF');                                         // plain symbol: Google → Yahoo → SEC
  fund('Dormant', 'SEC:DORM');
  sec.profiles.KFSSF = [profile('M0123_2560', 'KFSSF')];
  sec.profiles.DORM = [profile('M0999_2550', 'DORM')];
  sec.nav['M0123_2560'] = [nav('M0123_2560', '2026-11-20', 11.5)];
  const res = b.api({ action: 'refreshPrices' });
  near(holding('KFSSF').currentPrice, 11.5); assert.equal(holding('KFSSF').priceDate, '2026-11-20');
  assert.deepEqual(res.failed, ['Dormant (SEC:DORM): no price from Google Finance or Yahoo; no NAV at the SEC in the last 7 days']);
  const q = secCalls().find(c => c.path.endsWith('/nav')).q;
  assert.equal(q.start_nav_date, '2026-11-15'); assert.equal(q.end_nav_date, '2026-11-22');
});

test('multi-class: a class in the Symbol is looked up as a class and its own NAV is taken', () => {
  const { b, sec, holding, fund, secCalls } = setup();
  fund('K-USA A', 'SEC:K-USA-A(A)');
  sec.profiles['K-USA-A(A)'] = 204;                               // the class is not a project name
  sec.profiles['class:K-USA-A(A)'] = [profile('M0456_2563', 'K-USA', 'K-USA-A(A)')];
  sec.nav['M0456_2563'] = [nav('M0456_2563', '2026-11-24', 15.5, 'K-USA-A(A)'), nav('M0456_2563', '2026-11-24', 14.2, 'K-USA-A(D)')];
  const res = b.api({ action: 'refreshPrices' });
  assert.deepEqual(res.failed, []);
  near(holding('K-USA A').currentPrice, 15.5);
  const n = secCalls().find(c => c.path.endsWith('/nav'));
  assert.equal(n.q.fund_class_name, 'K-USA-A(A)', 'the class is asked for');
});

test('multi-class: the fund name alone picks nothing and says which classes exist', () => {
  const { b, sec, fund } = setup();
  fund('K-USA', 'SEC:K-USA');
  sec.profiles['K-USA'] = [profile('M0456_2563', 'K-USA', 'K-USA-A(A)'), profile('M0456_2563', 'K-USA', 'K-USA-A(D)')];
  sec.nav['M0456_2563'] = [nav('M0456_2563', '2026-11-24', 15.5, 'K-USA-A(A)'), nav('M0456_2563', '2026-11-24', 14.2, 'K-USA-A(D)')];
  const res = b.api({ action: 'refreshPrices' });
  assert.match(res.failed[0], /several classes at the SEC \(K-USA-A\(A\), K-USA-A\(D\)\) — write one in the Symbol, e.g\. SEC:K-USA-A\(A\)/);
});

test('a cancelled fund with the same abbreviation loses to the registered one', () => {
  const { b, sec, holding, fund } = setup();
  fund('SSF', 'SEC:ABSSF');
  sec.profiles.ABSSF = [profile('M0001_2550', 'ABSSF', '', 'Canceled'), profile('M0002_2562', 'ABSSF', '', 'Registered'), profile('M0003_2562', 'ABSSF-X')];
  sec.nav['M0002_2562'] = [nav('M0002_2562', '2026-11-24', 9.9, '')];
  b.api({ action: 'refreshPrices' });
  near(holding('SSF').currentPrice, 9.9);
});

test('no key yet → a clear reason and no request to the SEC', () => {
  const { b, fund, secCalls } = setup({ key: false });
  fund('KFSSF', 'SEC:KFSSF');
  const res = b.api({ action: 'refreshPrices' });
  assert.deepEqual(res.failed, ['KFSSF (SEC:KFSSF): no price from Google Finance or Yahoo; no SEC API key yet — add the Script Property SEC_API_KEY']);
  assert.equal(secCalls().length, 0);
});

test('401 → "key rejected"; 403 → not subscribed', () => {
  for (const [status, msg] of [[401, /SEC key rejected — check the Script Property SEC_API_KEY/], [403, /not subscribed/], [421, /rate limit/]]) {
    const { b, fund } = setup({ status });
    fund('KFSSF', 'SEC:KFSSF');
    const res = b.api({ action: 'refreshPrices' });
    assert.match(res.failed[0], msg);
    assert.ok(!res.failed[0].includes(FAKE_KEY), 'the key is never in a message');
  }
});

test('not found: says to check the abbreviation; nothing is cached', () => {
  const { b, fund } = setup();
  fund('Typo', 'SEC:KFSSFX');
  const res = b.api({ action: 'refreshPrices' });
  assert.match(res.failed[0], /fund not found at the SEC — check the abbreviation/);
  assert.equal(b.props.SEC_FUND_IDS, undefined);
});

test('the project id is looked up once: the second refresh uses the cache', () => {
  const { b, sec, fund, secCalls } = setup();
  fund('KFSSF', 'SEC:KFSSF');
  sec.profiles.KFSSF = [profile('M0123_2560', 'KFSSF')];
  sec.nav['M0123_2560'] = [nav('M0123_2560', '2026-11-24', 12.3)];
  b.api({ action: 'refreshPrices' });
  assert.deepEqual(JSON.parse(b.props.SEC_FUND_IDS), { KFSSF: { proj: 'M0123_2560', cls: '' } });
  const before = secCalls().length;
  sec.profiles = {};                                             // a second lookup would now fail
  const res = b.api({ action: 'refreshPrices' });
  assert.deepEqual(res.failed, []);
  const later = secCalls().slice(before);
  assert.deepEqual(later.map(c => c.path), ['/v2/fund/daily-info/nav'], 'only the NAV is asked');
});

test('order: Google Finance first, then Yahoo, then the SEC; stocks are never sent to the SEC', () => {
  const { b, sec, fund, log, secCalls } = setup();
  fund('Priced by Google', 'SEC:GOOGLED');
  b.context.evalFormulas = formulas => formulas.map(f => {
    const l = f[0].replace(/^="|"$/g, '');
    return [l, l === 'SEC:GOOGLED' ? 20 : '', l === 'SEC:GOOGLED' ? 'THB' : ''];
  });
  fund('KFSSF', 'KFSSF');
  sec.profiles.KFSSF = [profile('M0123_2560', 'KFSSF')];
  sec.nav['M0123_2560'] = [nav('M0123_2560', '2026-11-24', 12.3)];
  const r = b.api({ action: 'addHoldingTxn', type: 'buy', holding: { name: 'PTT', kind: 'stock' }, quantity: 1, price: 30, account: 'KS', date: '2026-01-10' });
  b.api({ action: 'updateHolding', id: r.holdingId, symbol: 'PTT.BK' });
  const res = b.api({ action: 'refreshPrices' });
  assert.equal(res.sources['Priced by Google'], 'Google Finance');
  const yahooFirst = log.findIndex(x => x.host !== 'api.sec.or.th'), secFirst = log.findIndex(x => x.host === 'api.sec.or.th');
  assert.ok(yahooFirst >= 0 && yahooFirst < secFirst, 'Yahoo is asked before the SEC');
  assert.deepEqual(secCalls().filter(c => c.path.endsWith('/profiles')).map(c => c.q.project_info), ['KFSSF'], 'only the fund Google and Yahoo missed');
  assert.match(res.failed[0], /^PTT \(PTT\.BK\): Yahoo answered 404$/, 'a stock keeps its own reason');
});

test('secSymbol: funds only; SEC: prefix; other exchanges are never sent', () => {
  const { b } = setup();
  const s = (symbol, kind) => b.context.secSymbol({ symbol, kind: kind || 'fund' });
  assert.equal(s('sec:kfssf'), 'KFSSF');
  assert.equal(s('KFSSF'), 'KFSSF');
  assert.equal(s('SEC:K-USA-A(A)'), 'K-USA-A(A)');
  assert.equal(s('SCBRMS&P500'), 'SCBRMS&P500');
  assert.equal(s('BKK:PTT'), '');
  assert.equal(s('PTT.BK'), '');
  assert.equal(s('KFSSF', 'stock'), '');
  assert.equal(s(''), '');
});

test('testPriceSources shows the SEC result and its raw answer per fund, never the key, and saves nothing', () => {
  const { b, sec, fund } = setup();
  fund('KFSSF', 'SEC:KFSSF');
  sec.profiles.KFSSF = [profile('M0123_2560', 'KFSSF')];
  sec.nav['M0123_2560'] = [nav('M0123_2560', '2026-11-24', 12.3)];
  const before = JSON.stringify(b.sheets.Holdings.rows);
  const lines = b.context.testPriceSources();
  assert.match(lines[0], /^KFSSF — Google Finance: none · Yahoo \(no symbol\): not asked · SEC KFSSF: 12\.3 THB \(NAV of 2026-11-24\)$/);
  assert.ok(lines.includes('SEC_API_KEY: set'));
  assert.ok(lines.some(l => /^SEC raw — KFSSF: GET general-info\/profiles\?project_info=KFSSF&page_size=100 → 200 \{"message":"success"/.test(l)));
  assert.ok(lines.some(l => /^SEC raw — KFSSF: GET daily-info\/nav\?proj_id=M0123_2560.* → 200 .*"last_val":12\.3/.test(l)));
  assert.ok(!lines.join('\n').includes(FAKE_KEY));
  assert.equal(JSON.stringify(b.sheets.Holdings.rows), before);
});
