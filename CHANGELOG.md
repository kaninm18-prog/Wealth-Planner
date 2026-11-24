# Changelog

One line per change the user would notice. Newest first.

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
