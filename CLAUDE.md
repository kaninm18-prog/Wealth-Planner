# Wealth Planner — guide for AI agents (and humans)

Investments and assets app for one user (Arm). Phone + laptop. Amounts are Thai baht (฿) unless stated.
It is being split out of **Money Tracker** (`kaninm18-prog/money-tracker`). The plan, with the decisions Arm made,
is Money Tracker's `docs/stage-4-plan.md`. Read it before changing anything here.

## Architecture

| Part | Where | Notes |
|---|---|---|
| Front end | `index.html` + `css/app.css` + `js/*.js` | Plain browser scripts, **no build step, no modules, no frameworks**. All functions are global so `onclick="…"` works. |
| PIN lock | `js/lock.js` (crypto + vault, no DOM) + `js/lockscreen.js` (screens, auto-lock) | The token and cached rates are encrypted at rest (`wealthLock_v1`, `wealthFxRates_v1`). Nothing is requested or shown until unlocked. |
| Offline shell | `sw.js` | Network-first for the app's own files. Bump `CACHE` when you add/rename a cached file. Only ever delete caches named `wealth-planner-…`. |
| Back end | `src/*.gs` (Google Apps Script) | One web app, `doPost` → `route(p)` in `src/02_api.gs` dispatches on `p.action`. Files are numbered: Apps Script loads them in name order and they share **one global scope**. |
| Database | Google Sheet "Wealth Planner" | One tab per data type. Column layout is documented at the top of `src/00_config.gs`. |
| Hosting | GitHub Pages | `https://kaninm18-prog.github.io/wealth-planner/` — pushing to `main` publishes the front end. |

**Same address as Money Tracker.** Both apps are on `kaninm18-prog.github.io`, so they share `localStorage` and service-worker
cache storage. Every `localStorage` key here starts with `wealth`, and `sw.js` only touches its own caches.

Data flow: app → `api(payload)` in `js/core.js` → POST to the Apps Script URL (with the access token) → `route()` → sheet.

## Money rules (from the Stage 4 plan — don't change them without asking Arm)

- Holding buys/sells move cash between a broker's cash and the holding; they are **not** spending or income.
- Each broker is a **linked investment account** in Money Tracker. Money Tracker reads its value from this app; this app reads
  deposits/withdrawals from Money Tracker. The two apps only talk through small export tabs (plan section 3).
- Dividends: each broker has a setting, paid to the broker account or to a chosen bank account. Every dividend is always recorded here
  **and** as Income in Money Tracker. Fees are recorded here only.
- Cost basis uses the average-cost method.
- RMF buys (`lockRule: "rmf"`) are locked until the **later** of the 55th birthday and 5 years after the fund's **first** buy, carried through fund switches (`rmfUnlockDate`, `firstBuyDates`, `src/10_holdings.gs`); the birth date is the Script Property `BIRTH_DATE`, set in Settings, held in memory only while unlocked. Saved `LockUntil` dates are never rewritten.

## Working on the code

- Commands (run from the repo root):
  - `npm ci` — install tools (ESLint) once
  - `npm test` — back-end tests: the real `src/*.gs` against a fake Google Sheet (`tests/harness.js`). No network, no real data.
  - `npm run lint` — ESLint, bug-focused. Errors fail CI; warnings don't.
  - `npm run check` — both. **Run it before every commit.**
- Style: match the surrounding code — `var`, `function(){}` callbacks, small helpers, short comments that explain *why*.
  Keep the front end working on older phones (no syntax newer than what's already used).
- PIN lock: never write the token or anything read from the sheet to `localStorage` in plain text (encrypt it with `lockKey`
  like `lockSaveRates`, or keep it in memory only). Every new variable or part of the page that holds such data must be
  emptied in `clearAppData()` (`js/core.js`), which runs on lock. Browser checks: `node tests/browser/lock.check.js` and `node tests/browser/screens.check.js` (need Playwright).
- Helpers in `src/01_helpers.gs` match Money Tracker's, so code can be ported unchanged.
- New back-end action: add a `case` in `route()` + the function in the right feature file + a test.
- New tab: add it to `SHEET` and its headers to `HEADERS` in `src/00_config.gs`; if it has an `Id` column, set `ID_COL`.
- New sheet column: append at the end and add the header with `ensureHeaders(sh, col, [...])`. Never reorder or remove columns.
- Edits/deletes find rows by `Id` via `resolveRow()`.
- Every change to money logic needs a test in `tests/*.test.js`.

## Deploying

- Front end: push to `main` → GitHub Pages.
- Back end: push to `main` → `.github/workflows/deploy-backend.yml` runs lint + tests, backs up the live Apps Script code
  (artifact, 90 days), uploads `src/*.gs` with clasp and updates the **existing** deployment (URL never changes).
  It reads `SCRIPT_ID` (repo variable), `DEPLOYMENT_ID` and `CLASPRC_JSON` (repo secrets).
- `.github/workflows/checks.yml` runs lint + tests on every push and pull request.
- **Never edit code in the Apps Script editor** — the next deploy overwrites it. The repo is the only source.

## Rules for agents

1. **Never read or write the live Google Sheet (this app's or Money Tracker's) or call either live Apps Script URL.** Test against the fake sheet only.
2. **Never commit personal files** (statements, exports, import files — see `.gitignore`). Check `git status` before committing.
3. Never put secrets (tokens, script or deployment IDs, the Apps Script URL) in code, commits or logs.
4. Work on a branch and open a pull request unless told to commit to `main`. Never force-push. Never rewrite pushed history.
5. Keep changes small and focused; one topic per commit. Say what you changed and how you checked it.
6. Don't change the money rules above without being asked — if a task seems to need it, stop and explain.
7. Add a line to `CHANGELOG.md` for anything the user would notice, and set `APP_VERSION` in `js/core.js` to the newest changelog date (a test checks they match).
8. Commit messages end with the attribution lines given in your session (if any).
