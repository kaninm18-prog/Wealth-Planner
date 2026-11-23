// Wealth Planner — Settings: the import-file card.
// Ported from Money Tracker's js/settings.js (onPackFile / confirmPackImport, Stage 4 step 3c).
// The file is the same "money-tracker-import" .json. Accounts in it are ignored: accounts live in Money Tracker.
// An entry's "account" becomes the broker name here.
// Loaded as a plain <script>: functions are global so onclick="..." handlers work.

var packPending = null;
function onPackFile(input) {
  var f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  f.text().then(function(txt) {
    var p; try { p = JSON.parse(txt); } catch(e) { toast('That file is not a valid import file'); return; }
    if (!p || (p.format !== 'money-tracker-import' && p.format !== 'wealth-planner-import')) { toast('That file is not an import file for this app'); return; }
    packPending = p;
    var tr = p.trades || [], hx = p.holdingTxns || [], ac = p.accounts || [];
    var closed = tr.filter(function(t){ return t.closeTime; }).map(function(t){ return String(t.closeTime).substring(0, 10).replace(/\./g, '-'); }).sort();
    var net = tr.reduce(function(s, t){ return s + (+t.profit || 0) + (+t.commission || 0) + (+t.swap || 0); }, 0);
    var lines = [];
    if (p.source) lines.push('<span class="hold-sub">From ' + recEsc(p.source) + '</span>');
    if (ac.length) lines.push('🏦 ' + ac.length + ' account' + (ac.length > 1 ? 's' : '') + ' (' + ac.map(function(a){ return recEsc(a.name); }).join(', ') + ') — ignored here: accounts live in Money Tracker');
    if (tr.length) lines.push('📈 <b>' + tr.length + ' trades</b>' + (closed.length ? ' · ' + fmtDateY(closed[0]) + ' – ' + fmtDateY(closed[closed.length - 1]) : '') +
      ' · net ' + (tr[0].currency === 'USD' || !tr[0].currency ? fmtUsd(net) : net.toFixed(2)) + (p.tradeAccount ? ' · broker ' + recEsc(p.tradeAccount) : ''));
    // investments: one line per holding (buys / sells, dates, broker)
    var byH = {};
    hx.forEach(function(t) {
      var h = t.holding || {}, k = h.name || 'Holding';
      var g = byH[k] || (byH[k] = { kind: h.kind || '', buys: 0, sells: 0, divs: 0, from: t.date, to: t.date, cur: t.currency || 'THB', acct: t.account || '', noCash: 0 });
      if (t.type === 'buy') g.buys++; else if (t.type === 'sell') g.sells++; else if (t.type === 'dividend') g.divs++;
      if (!t.account) g.noCash++;
      if (t.date < g.from) g.from = t.date;
      if (t.date > g.to) g.to = t.date;
      if (t.account) g.acct = t.account;
    });
    Object.keys(byH).forEach(function(k) {
      var g = byH[k], parts = [];
      if (g.buys) parts.push(g.buys + ' buy' + (g.buys > 1 ? 's' : ''));
      if (g.sells) parts.push(g.sells + ' sale' + (g.sells > 1 ? 's' : ''));
      if (g.divs) parts.push(g.divs + ' dividend' + (g.divs > 1 ? 's' : ''));
      lines.push(kindInfo(g.kind)[1] + ' <b>' + recEsc(k) + '</b>: ' + parts.join(', ') +
        (g.from !== g.to ? ' · ' + fmtDateY(g.from) + ' – ' + fmtDateY(g.to) : ' · ' + fmtDateY(g.from)) +
        (g.acct ? ' · broker ' + recEsc(g.acct) : '') + (g.noCash ? ' · ' + (g.noCash === g.buys + g.sells + g.divs ? 'already owned, no money moves' : g.noCash + ' without money moving') : '') +
        (g.cur !== 'THB' ? ' · ' + recEsc(g.cur) + ' converted at each day\'s rate' : ''));
    });
    if (!tr.length && !hx.length) lines.push('Nothing in this file for this app.');
    lines.push('<span class="hold-sub">Anything already in the app (same trade or entry) is skipped.</span>');
    document.getElementById('pack-summary').innerHTML = lines.join('<br>');
    document.getElementById('pack-go').textContent = 'Import';
    closeModal('settings-modal');
    openModal('pack-modal');
  });
}
function confirmPackImport() {
  if (!packPending) return;
  var btn = document.getElementById('pack-go'); btn.textContent = 'Importing… (looking up exchange rates)'; btn.disabled = true;
  var send = Object.assign({ action: 'importPack' }, packPending);
  delete send.accounts;                                   // not used here
  api(send).then(function(res) {
    btn.disabled = false; btn.textContent = 'Import';
    if (!res.ok) { apiError(res); return; }
    packPending = null; closeModal('pack-modal');
    var hs = res.holdings || { added: 0, skipped: 0, fx: [] }, tr = res.trades || null, parts = [];
    if (hs.added) parts.push(hs.added + ' investment entr' + (hs.added > 1 ? 'ies' : 'y') + ' added');
    if (tr && tr.added) parts.push(tr.added + ' trade' + (tr.added > 1 ? 's' : '') + ' added');
    var skipped = (hs.skipped || 0) + (tr ? tr.skipped || 0 : 0);
    toast((parts.length ? 'Done: ' + parts.join(' · ') : 'Nothing new to import') + (skipped ? ' · ' + skipped + ' skipped (already there)' : ''), 6000);
    if (hs.fx && hs.fx.length) setTimeout(function(){ toast(hs.fx.join(' · '), 7000); }, 6200);
    trades = null;
    loadAll();
  }).catch(function(){ btn.disabled = false; btn.textContent = 'Import'; toast('Importing needs a connection'); });
}
