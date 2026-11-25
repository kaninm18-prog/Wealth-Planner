// ── Third source: the Thai SEC's daily fund NAV ──────────────
// Google Finance and Yahoo have no Thai mutual fund prices; the Thai SEC Open API does, with a free subscription key.
// A fund holding (kind "fund") whose Symbol is its SEC abbreviation ("KFSSF", or "SEC:KFSSF"; a class as "SEC:KFSSF-A")
// is priced here when Google Finance and Yahoo have nothing (refreshPrices, src/11_prices.gs).
// Key: the Script Property SEC_API_KEY (set by hand; never in code, logs or tests). It is sent in the
// Ocp-Apim-Subscription-Key header, the only way the API accepts it.
// The API (V2, https://api.sec.or.th): as described by the open-source client github.com/jwitmann/sec-go v0.6.0
// (docs/v2-schemas), because the SEC portal could not be reached when this was written. testPriceSources shows the
// raw answers, so a live run confirms it:
//   GET /v2/fund/general-info/profiles?project_info=<text>  → { items: [{ proj_id, proj_abbr_name, fund_class_name, fund_status… }] }
//       (also ?fund_class_name=<class>). One item per class. project_info searches proj_id, names and proj_abbr_name.
//   GET /v2/fund/daily-info/nav?proj_id=…&start_nav_date=yyyy-MM-dd&end_nav_date=…[&fund_class_name=…]
//       → { items: [{ proj_id, nav_date, fund_class_name, last_val (THB per unit)… }] }
//   204 = nothing found · 401 = missing/invalid key · 403 = key not subscribed · 421 = rate limit
// Each fund's project id (and class) is looked up once and kept in the Script Property SEC_FUND_IDS
// ({ "<symbol>": { proj, cls } }); delete that property to look them up again.
var SEC_API = "https://api.sec.or.th/v2/fund/";
var SEC_IDS = "SEC_FUND_IDS";
var SEC_NAV_DAYS = 7;                              // weekends and holidays: the latest NAV of the last 7 days

// The SEC abbreviation for a holding, or "" (only funds; other exchanges' symbols are never sent to the SEC)
function secSymbol(h) {
  if (!h || h.kind !== "fund") return "";
  var s = String(h.symbol || "").trim().toUpperCase(), m = s.match(/^SEC:\s*(.+)$/);
  if (m) s = m[1].trim();
  else if (s.indexOf(":") >= 0 || /\.BK$/.test(s)) return "";
  return /^[A-Z0-9][A-Z0-9&\-+.()\/ ]{0,39}$/.test(s) ? s : "";
}

function secError(code) {
  if (code === 401) return "SEC key rejected — check the Script Property SEC_API_KEY";
  if (code === 403) return "SEC key not subscribed to the fund API — subscribe on the SEC portal";
  if (code === 421 || code === 429) return "SEC rate limit — try again in a few minutes";
  return "SEC answered " + code;
}
function secUpper(v) { return String(v === null || v === undefined ? "" : v).trim().toUpperCase(); }

// GET every url at once → [{ code, items, error }]. `raw` (optional, for testPriceSources) collects what came back.
function secGetAll(urls, key, raw, label) {
  var res;
  try {
    res = UrlFetchApp.fetchAll(urls.map(function(u) {
      return { url: u, method: "get", headers: { "Ocp-Apim-Subscription-Key": key }, muteHttpExceptions: true };
    }));
  } catch (e) {
    var why = /permission|authori[sz]/i.test(String(e.message)) ? "SEC not allowed yet — run testPriceSources once in Apps Script"
                                                               : "SEC not reachable";
    return urls.map(function(){ return { error: why }; });
  }
  return res.map(function(r, i) {
    var code = r.getResponseCode(), text = code === 204 ? "" : String(r.getContentText() || "");
    if (raw) raw.push((label ? label[i] + ": " : "") + "GET " + urls[i].replace(SEC_API, "") + " → " + code + (text ? " " + text.slice(0, 400) : ""));
    if (code === 204) return { code: code, items: [] };
    if (code !== 200) return { code: code, error: secError(code) };
    try {
      var body = JSON.parse(text);
      return { code: code, items: Array.isArray(body) ? body : (body && body.items) || [] };
    } catch (e) { return { code: code, error: "unexpected answer from the SEC" }; }
  });
}

// The registered fund (or class) that matches a symbol: a class name first, then the fund's abbreviation.
function secMatch(sym, items) {
  function pick(list) {
    var reg = list.filter(function(it){ return /^(registered|rg)$/i.test(String(it.fund_status || "")); });
    return (reg.length ? reg : list)[0];
  }
  var byClass = items.filter(function(it){ return secUpper(it.fund_class_name) === sym; });
  if (byClass.length) { var c = pick(byClass); return { proj: String(c.proj_id), cls: String(c.fund_class_name).trim() }; }
  var byFund = items.filter(function(it){ return secUpper(it.proj_abbr_name) === sym; });
  if (byFund.length) return { proj: String(pick(byFund).proj_id), cls: "" };
  return null;
}

// { <symbol>: { price, date } or { error } }. Prices are THB per unit (NAV).
function secNavQuotes(syms, raw) {
  var out = {};
  if (!syms.length) return out;
  var props = PropertiesService.getScriptProperties(), key = props.getProperty("SEC_API_KEY");
  if (!key) {                                      // no request at all without a key
    syms.forEach(function(s){ out[s] = { error: "no SEC API key yet — add the Script Property SEC_API_KEY" }; });
    return out;
  }
  var ids = {};
  try { ids = JSON.parse(props.getProperty(SEC_IDS) || "{}") || {}; } catch (e) { ids = {}; }
  var found = false;
  // 1) project ids not looked up yet: search by abbreviation; a class ("KFSSF-A") is then searched as a class
  var need = syms.filter(function(s){ return !(ids[s] && ids[s].proj); });
  var left = need;
  [["project_info", need], ["fund_class_name", null]].forEach(function(step) {
    var list = step[1] || left.filter(function(s){ return s.indexOf("-") > 0 && !out[s]; });
    if (!list.length) return;
    var ans = secGetAll(list.map(function(s){ return SEC_API + "general-info/profiles?" + step[0] + "=" + encodeURIComponent(s) + "&page_size=100"; }),
      key, raw, list);
    left = [];
    list.forEach(function(s, i) {
      if (ans[i].error) { out[s] = { error: ans[i].error }; return; }
      var m = secMatch(s, ans[i].items);
      if (m) { ids[s] = m; found = true; } else left.push(s);
    });
  });
  need.forEach(function(s){ if (!out[s] && !ids[s]) out[s] = { error: "fund not found at the SEC — check the abbreviation (e.g. KFSSF, or SEC:KFSSF-A for a class)" }; });
  if (found) props.setProperty(SEC_IDS, JSON.stringify(ids));
  // 2) the latest NAV of the last 7 days (one request per fund, all at once)
  var navFor = syms.filter(function(s){ return !out[s]; });
  if (!navFor.length) return out;
  var end = todayStr(), start = Utilities.formatDate(new Date(Date.now() - SEC_NAV_DAYS * 86400000), "GMT+7", "yyyy-MM-dd");
  var ans = secGetAll(navFor.map(function(s) {
    return SEC_API + "daily-info/nav?proj_id=" + encodeURIComponent(ids[s].proj) + "&start_nav_date=" + start + "&end_nav_date=" + end +
      (ids[s].cls ? "&fund_class_name=" + encodeURIComponent(ids[s].cls) : "");
  }), key, raw, navFor);
  navFor.forEach(function(s, i) {
    if (ans[i].error) { out[s] = { error: ans[i].error }; return; }
    var cls = secUpper(ids[s].cls), rows = ans[i].items.filter(function(it){ return toFloat(it.last_val) > 0 && it.nav_date; });
    if (cls) rows = rows.filter(function(it){ return secUpper(it.fund_class_name) === cls; });
    else {
      var classes = {};
      rows.forEach(function(it){ classes[secUpper(it.fund_class_name)] = true; });
      var names = Object.keys(classes).filter(function(c){ return c && c !== "MAIN"; });
      if (classes[s]) rows = rows.filter(function(it){ return secUpper(it.fund_class_name) === s; });
      else if (names.length > 1) {
        out[s] = { error: "the fund has several classes at the SEC (" + names.sort().join(", ") + ") — write one in the Symbol, e.g. SEC:" + names[0] };
        return;
      }
    }
    if (!rows.length) { out[s] = { error: "no NAV at the SEC in the last " + SEC_NAV_DAYS + " days" }; return; }
    rows.sort(function(a, b){ return String(b.nav_date).localeCompare(String(a.nav_date)); });
    out[s] = { price: toFloat(rows[0].last_val), date: String(rows[0].nav_date).slice(0, 10) };
  });
  return out;
}
