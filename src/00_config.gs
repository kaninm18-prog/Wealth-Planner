// ============================================================
//  Wealth Planner — Google Apps Script backend
//  Investments and assets, split out of Money Tracker (see Money Tracker's docs/stage-4-plan.md).
//
//  Sheets (tabs are created with their headers the first time they are used).
//  Holdings, HoldingTxns, Trades, AllocationTargets and _Prices have Money Tracker's layout,
//  so the tabs can be copied across as they are (plan step 5). Never reorder these columns.
//  HoldingTxns has extra columns at the end (FeeOrig C3, TaxOrig C6, LockUntil, SwitchId, SwitchValue), so it stays a superset of Money Tracker's.
//    Holdings          → Id | Name | Kind | Symbol | Unit | CurrentPrice (THB/unit) | PriceDate | Note | Status | QuoteCurrency | NextXD | NextDividend (per unit)
//    HoldingTxns       → Id | HoldingId | Date | Type (buy/sell/dividend) | Quantity | Price | Amount (THB) | Fee (dividends: tax withheld) | Account | Note | LinkedId | OrigAmount | Currency | FeeOrig | TaxOrig | LockUntil | SwitchId | SwitchValue
//                        Account = the broker's name (plain text). LinkedId is kept for the layout but stays empty here:
//                        fees and dividends are not copied into Expenses/Income (those tabs don't exist in this app).
//                        OrigAmount/Currency = the exact amount in a foreign currency, e.g. USD paid/received.
//                        FeeOrig = the fee of a buy/sell in that Currency when it isn't THB (plan C3); Fee stays in THB.
//                        TaxOrig = the tax withheld on a dividend in that Currency when it isn't THB (plan C6); Fee stays in THB.
//                        LockUntil = on a buy of a tax fund (SSF, ThaiESG…): the units can't be sold before this date
//                        (yyyy-MM-dd, text) without losing the tax benefit. Empty = not locked.
//                        SwitchId = the same id on the sell and buy rows of one fund switch (src/17_switch.gs);
//                        SwitchValue = what the fund house said the switch was worth (THB, for information only).
//                        New dividends get an Id starting with WD (plan C8); only those are exported to Money Tracker.
//    Trades            → Id | Ticket | Symbol | Side | Volume | OpenTime | OpenPrice | CloseTime | ClosePrice | Commission | Swap | Profit | Account | Note | Currency
//                        Trading journal (e.g. XAUUSD on MT5). Profit/Commission/Swap in Currency (usually USD).
//                        Account = the broker's name (plain text); trades don't move any balance here.
//    AllocationTargets → Class | TargetPct
//    Brokers           → Name | Currency | DividendsTo | Rate | Note | OpeningCash   (src/15_brokers.gs, step 3d)
//                        OpeningCash = cash already at the broker when it was set up here, in its own currency
//                        ("start over": e.g. what Money Tracker had as the account's starting balance)
//                        Name = the broker name used in HoldingTxns.Account / Trades.Account, which is also the
//                        LinkedTo name of its linked investment account in Money Tracker. Rows are found by Name.
//                        Currency = the broker's cash currency. DividendsTo = empty (dividends are paid into the
//                        broker's cash) or the Money Tracker name of the bank account they are paid to (plan C2).
//                        Rate = THB per 1 unit of Currency (1 for THB), refreshed by refreshPrices.
//    _Prices           → scratch sheet (hidden) where GOOGLEFINANCE formulas are evaluated
//  Export tabs read by Money Tracker (hidden, rebuilt whole on every write; plan section 3):
//    _Export_Values    → Account | Currency | Value | ValueTHB | AsOf          one row per broker + "Other assets" (C7)
//    _Export_Dividends → Id | Date | Holding | Amount (THB) | OrigAmount | Currency | Tax (THB) | Account   WD… Ids only (C8)
//  Read from Money Tracker: its tab _Export_LinkedFlows → Id | Date | Account | Amount | Currency (deposits − / withdrawals).
//  Script Properties: BENCH, BENCH_SYMBOL (comparison index), LAST_PRICE_REFRESH, PRICES_DAILY,
//    MONEY_SHEET_ID (Money Tracker's spreadsheet id, set by hand, never in code), MONEY_FLOWS_CACHE (last good flows),
//    FX_RATES (THB per unit from the last price refresh).
// ============================================================

var SHEET = {
  HOLDINGS:     "Holdings",
  HOLDING_TXNS: "HoldingTxns",
  TRADES:       "Trades",
  TARGETS:      "AllocationTargets",
  BROKERS:      "Brokers",
  PRICES:       "_Prices",
  EXPORT_VALUES:    "_Export_Values",
  EXPORT_DIVIDENDS: "_Export_Dividends"
};

// Column headers for each tab, written when a tab is first created.
var HEADERS = {};
HEADERS[SHEET.HOLDINGS]     = ["Id","Name","Kind","Symbol","Unit","CurrentPrice","PriceDate","Note","Status","QuoteCurrency","NextXD","NextDividend"];
HEADERS[SHEET.HOLDING_TXNS] = ["Id","HoldingId","Date","Type","Quantity","Price","Amount","Fee","Account","Note","LinkedId","OrigAmount","Currency","FeeOrig","TaxOrig","LockUntil","SwitchId","SwitchValue"];
HEADERS[SHEET.TRADES]       = ["Id","Ticket","Symbol","Side","Volume","OpenTime","OpenPrice","CloseTime","ClosePrice","Commission","Swap","Profit","Account","Note","Currency"];
HEADERS[SHEET.TARGETS]      = ["Class","TargetPct"];
HEADERS[SHEET.BROKERS]      = ["Name","Currency","DividendsTo","Rate","Note","OpeningCash"];
HEADERS[SHEET.PRICES]       = ["Symbol","Price","Currency"];
// The export tabs' columns are the contract with Money Tracker: never reorder them.
HEADERS[SHEET.EXPORT_VALUES]    = ["Account","Currency","Value","ValueTHB","AsOf"];
HEADERS[SHEET.EXPORT_DIVIDENDS] = ["Id","Date","Holding","Amount","OrigAmount","Currency","Tax","Account"];

// Tabs hidden when they are created (scratch space the user never needs to see).
var HIDDEN_TABS = {};
HIDDEN_TABS[SHEET.PRICES] = true;
HIDDEN_TABS[SHEET.EXPORT_VALUES] = true;
HIDDEN_TABS[SHEET.EXPORT_DIVIDENDS] = true;
