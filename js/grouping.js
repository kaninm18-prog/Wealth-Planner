// Wealth Planner — grouping the holdings on the home screen: by type (stocks, ETFs, funds…) or by broker.
// Pure functions, no page access: tests/grouping.test.js runs this file on its own. Drawn by renderHoldings().
// By broker, a holding split across brokers shows under each one with that broker's quantity, value and cost
// (value and cost are shared out by quantity, the same way the backend values each broker's positions).
// Loaded as a plain <script> (not a module): functions are global.

// Type groups, in this order (the kinds are HOLDING_KINDS in src/10_holdings.gs; an unknown kind counts as "other").
var GROUP_KINDS = [['stock','Stocks'], ['etf','ETFs'], ['fund','Mutual funds'], ['gold','Gold'], ['crypto','Crypto'], ['bond','Bonds'],
  ['property','Property'], ['vehicle','Vehicles'], ['electronics','Electronics'], ['other','Other assets']];
var GROUP_OTHER = 'Other assets';           // by broker: things with no broker (the backend's OTHER_ASSETS row)

// A holding that is still held (or was added with no entries yet) belongs on the list; closed ones don't.
function holdingIsOpen(h) { return h.quantity > 0 || !(h.txns && h.txns.length); }

// One item of a group: the holding, plus the part of it this group holds.
function groupItem(h, qty) {
  var share = h.quantity > 0 ? qty / h.quantity : 1;
  return { h: h, qty: qty, value: h.value * share, cost: h.cost * share, split: Math.abs(share - 1) > 1e-9 };
}
function newGroup(key, label) { return { key: key, label: label, items: [], value: 0, cost: 0, count: 0 }; }
function addToGroup(g, item) { g.items.push(item); g.value += item.value; g.cost += item.cost; g.count++; }
function finishGroups(list) {
  return list.filter(function(g){ return g.count > 0; }).map(function(g) {
    g.items.sort(function(a, b){ return b.value - a.value; });
    g.value = Math.round(g.value * 100) / 100; g.cost = Math.round(g.cost * 100) / 100;
    g.unrealized = Math.round((g.value - g.cost) * 100) / 100;
    return g;
  });
}

// mode 'type' | 'broker'. brokers = the backend's broker ledger (bootstrap.brokers) or null.
function holdingGroups(holdings, mode, brokers) {
  var open = (holdings || []).filter(holdingIsOpen);
  return mode === 'broker' ? groupsByBroker(open, brokers) : groupsByType(open);
}

function groupsByType(open) {
  var by = {}, list = GROUP_KINDS.map(function(k){ return (by[k[0]] = newGroup('type:' + k[0], k[1])); });
  open.forEach(function(h){ addToGroup(by[h.kind] || by.other, groupItem(h, h.quantity)); });
  return finishGroups(list);
}

// Where each holding is held: { <holding id>: { <broker name or "">: quantity } } ("" = no broker).
// The backend's positions are used when it sent them, so this matches the Brokers section (including its rules
// for things moved without a broker). Without them (an older backend), the entries are added up per broker.
// Either way, what isn't placed at a broker (e.g. a holding with no entries) is put under Other assets.
function brokerSplits(open, brokers) {
  var at = {};
  function put(id, name, q) { var s = at[id] || (at[id] = {}); s[name] = (s[name] || 0) + q; }
  var ids = {};
  open.forEach(function(h){ ids[h.id] = true; });
  if (brokers && brokers.brokers) {
    brokers.brokers.forEach(function(b){ (b.positions || []).forEach(function(p){ if (ids[p.id]) put(p.id, b.name, p.quantity); }); });
    ((brokers.other && brokers.other.positions) || []).forEach(function(p){ if (ids[p.id]) put(p.id, '', p.quantity); });
  } else {
    open.forEach(function(h) {
      var q = {};
      (h.txns || []).forEach(function(t) {
        if (t.type !== 'buy' && t.type !== 'sell') return;
        var k = t.account || '';
        q[k] = (q[k] || 0) + (t.type === 'buy' ? 1 : -1) * (parseFloat(t.quantity) || 0);
      });
      var pos = 0;
      Object.keys(q).forEach(function(k){ if (q[k] > 1e-9) pos += q[k]; });
      // sales from another broker than the buys: share what is left in proportion to the buys
      Object.keys(q).forEach(function(k){ if (q[k] > 1e-9 && pos > 0) put(h.id, k, q[k] * h.quantity / pos); });
    });
  }
  open.forEach(function(h) {
    var s = at[h.id] || {}, placed = 0;
    Object.keys(s).forEach(function(k){ placed += s[k]; });
    if (!(h.quantity > 0)) { if (!placed) put(h.id, '', 0); }       // no entries yet: listed under Other assets
    else if (h.quantity - placed > 1e-6) put(h.id, '', h.quantity - placed);
  });
  return at;
}

function groupsByBroker(open, brokers) {
  var at = brokerSplits(open, brokers), by = {}, list = [];
  open.forEach(function(h) {
    var s = at[h.id] || {};
    Object.keys(s).forEach(function(name) {
      if (h.quantity > 0 && Math.abs(s[name]) < 1e-9) return;
      var g = by[name] || (by[name] = newGroup('broker:' + name, name || GROUP_OTHER));
      if (list.indexOf(g) < 0) list.push(g);
      addToGroup(g, groupItem(h, h.quantity > 0 ? s[name] : 0));
    });
  });
  // biggest broker first; Other assets always last
  list.sort(function(a, b) {
    if ((a.key === 'broker:') !== (b.key === 'broker:')) return a.key === 'broker:' ? 1 : -1;
    return b.value - a.value || a.label.toLowerCase().localeCompare(b.label.toLowerCase());
  });
  return finishGroups(list);
}
