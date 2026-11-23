// ============================================================
//  Wealth Planner — Google Apps Script backend
//  Investments and assets, split out of Money Tracker (see Money Tracker's docs/stage-4-plan.md).
//
//  Sheets (tabs are created with their headers the first time they are used).
//  Holdings, HoldingTxns, AllocationTargets and _Prices have exactly Money Tracker's layout,
//  so the tabs can be copied across as they are (plan step 5). Never reorder these columns.
//    Holdings          → Id | Name | Kind | Symbol | Unit | CurrentPrice (THB/unit) | PriceDate | Note | Status | QuoteCurrency | NextXD | NextDividend (per unit)
//    HoldingTxns       → Id | HoldingId | Date | Type (buy/sell/dividend) | Quantity | Price | Amount (THB) | Fee (dividends: tax withheld) | Account | Note | LinkedId | OrigAmount | Currency
//                        Account = the broker's name (plain text). LinkedId is kept for the layout but stays empty here:
//                        fees and dividends are not copied into Expenses/Income (those tabs don't exist in this app).
//                        OrigAmount/Currency = the exact amount in a foreign currency, e.g. USD paid/received.
//    AllocationTargets → Class | TargetPct
//    _Prices           → scratch sheet (hidden) where GOOGLEFINANCE formulas are evaluated
//  Script Properties: BENCH, BENCH_SYMBOL (comparison index), LAST_PRICE_REFRESH, PRICES_DAILY.
// ============================================================

var SHEET = {
  HOLDINGS:     "Holdings",
  HOLDING_TXNS: "HoldingTxns",
  TARGETS:      "AllocationTargets",
  PRICES:       "_Prices"
};

// Column headers for each tab, written when a tab is first created.
var HEADERS = {};
HEADERS[SHEET.HOLDINGS]     = ["Id","Name","Kind","Symbol","Unit","CurrentPrice","PriceDate","Note","Status","QuoteCurrency","NextXD","NextDividend"];
HEADERS[SHEET.HOLDING_TXNS] = ["Id","HoldingId","Date","Type","Quantity","Price","Amount","Fee","Account","Note","LinkedId","OrigAmount","Currency"];
HEADERS[SHEET.TARGETS]      = ["Class","TargetPct"];
HEADERS[SHEET.PRICES]       = ["Symbol","Price","Currency"];

// Tabs hidden when they are created (scratch space the user never needs to see).
var HIDDEN_TABS = {};
HIDDEN_TABS[SHEET.PRICES] = true;
