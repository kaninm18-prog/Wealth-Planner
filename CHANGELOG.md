# Changelog

One line per change the user would notice. Newest first.

## 2026-11-26
- RMF: add your birth date in Settings, then on the buy form of a mutual fund tap **RMF**. The buy is locked until the later of age 55 and 5 years after the fund's first purchase (shown as 🔒 on the holding, with the usual warning before selling locked units). A buy that is already past both dates simply isn't locked. Needs the backend redeployed (it deploys from `main` automatically).
- Mutual funds are now priced from Google Finance, then the Thai SEC — never from Yahoo, so a Thai fund code can't pick up a foreign share's price.
- "Locked until" on the buy form now only shows for mutual funds.

## 2026-11-25
- Thai mutual funds now get their price automatically: the daily NAV from the Thai SEC (the latest of the last 7 days, so weekends and holidays are covered), when Google Finance and Yahoo have none. Give the fund its short name as the symbol (e.g. KFSSF, or SEC:K-USA-A(A) for one class). Needs a free SEC API key in the backend; until then the reason is shown.
- Switch a fund into another (e.g. SSF → SSF, ThaiESG → ThaiESG) in one step: Holding → Switch. The original cost is carried over, so no profit or loss is booked and the broker's cash doesn't change (except a fee). Locked units keep their lock dates in the new fund, oldest units first. The history shows "Switched to / from" and what the switch was worth; deleting it removes both sides.
- Tax funds (SSF, ThaiESG): a buy can have a "Locked until" date (quick +10 / +8 / +5 years, or any date). A holding shows how many units are locked and until when, how many are free, and each purchase with its date. Selling more than the free units shows a warning (you may lose the tax benefit), but you can still save the sale.
- Home screen: the holdings are grouped by type (stocks, ETFs, funds, gold…) or by broker — switch with Type | Broker at the top of the list. Each group shows its value, unrealised gain/loss and how many holdings it has, and can be folded away. By broker, a holding held at two brokers shows under each with that broker's part.
- Each investment now shows today's price per share (or per unit), next to your average cost; foreign stocks also in their own currency.
- Refresh prices now works for Thai stocks and gold: when Google Finance has no price (it has none for SET stocks or gold), it comes from Yahoo Finance. Anything still not found says why.

## 2026-11-24
- PIN lock: the app opens with a 6-digit PIN, and locks again after 5 minutes in the background (or with "Lock now" in Settings). The access token and the saved exchange rates are kept encrypted on the device. After 5 wrong PINs you wait before the next try; after 10 the app is reset on that device (your data in Google Sheets is untouched). Settings → Change PIN. After this update you are asked to set a PIN once.

## 2026-11-23
- Brokers: an opening cash amount, for cash that was already at the broker when you set it up here.
- Brokers: each broker's cash and total value, its currency, exchange rate and where its dividends are paid (the broker or a Money Tracker bank account). Add, edit and delete brokers.
- Broker cash uses the deposits and withdrawals from Money Tracker; a note shows when they couldn't be read (deposits as of a date) or aren't connected yet. The total at the top now includes broker cash once deposits are known.
- Each broker's value, other assets and every new dividend are sent to Money Tracker. A USD dividend also keeps its tax in USD.
- Taking something out of a broker with no account (e.g. withdrawing a gold bar) moves it from that broker to Other assets, with no cash. If it is held at more than one broker, a warning asks you to check where it is.
- Home screen: your investments and assets with total value, cost, unrealised and realised gains, dividends, and a "Refresh prices" button.
- Add, edit and delete holdings and their buys, sales and dividends. The broker is a plain name; foreign amounts are typed with their currency and rate.
- Portfolio: allocation and targets, returns compared with an index, dividends, and the trading journal (with MT5 import). The journal stays hidden until the backend has it.
- Settings: import investments and trades from an import file. Accounts in the file are ignored.

## 2026-11-22
- Opening the backend URL in a browser now says it is running, instead of "Script function not found: doGet".
- New app: Wealth Planner shell — connect to its Google Sheet, version shown in Settings. Holdings move here from Money Tracker next.
