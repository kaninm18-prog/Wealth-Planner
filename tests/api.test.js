// The web-app entry point: access token, routing, start-up. Run with `npm test`.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./harness');

test('wrong or missing token is refused', () => {
  const { api } = createBackend();
  const res = api({ action: 'bootstrap', token: 'nope' });
  assert.equal(res.ok, false);
  assert.ok(res.auth);
  assert.equal(res.error, 'unauthorized');
});

test('no token set on the server yet: says how to fix it', () => {
  const b = createBackend();
  b.context.PropertiesService.getScriptProperties().deleteProperty('API_TOKEN');
  const res = b.api({ action: 'bootstrap' });
  assert.equal(res.ok, false);
  assert.match(res.error, /setupToken/);
});

test('unknown action names itself, so the app can say "redeploy"', () => {
  const { api } = createBackend();
  const res = api({ action: 'nothingLikeThis' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Unknown action: nothingLikeThis');
});

test('bootstrap answers with the sheet name and today', () => {
  const { api } = createBackend();
  const res = api({ action: 'bootstrap' });
  assert.ok(res.ok);
  assert.equal(res.sheet, 'Wealth Planner (test)');
  assert.match(res.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('setupToken keeps an existing token', () => {
  const b = createBackend();
  assert.equal(b.context.setupToken(), 'test-token');
});

test('opening the URL in a browser (GET) says it is running and returns no data', () => {
  const { context } = createBackend();
  const res = JSON.parse(context.doGet({ parameter: { action: 'bootstrap' } }).getContent());
  assert.ok(res.ok);
  assert.match(res.message, /running/);
  assert.deepEqual(Object.keys(res).sort(), ['message', 'ok']);
});
