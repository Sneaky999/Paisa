# Paisa — personal finance tracker

A private, local-first money tracker. Vanilla JS (ES modules) + Chart.js + IndexedDB. No backend, no account, no paid API.

## Run it

- **Easiest (phone or desktop):** open `dist/paisa.html`. It is one self-contained file (CSS, Chart.js and the app are inlined) and works offline.
- **Development:** `npm install`, then serve this folder with any static server (`npx serve .`) and open `index.html`.
- **Rebuild the single file:** `npm run build`

## What's inside (MVP, all working)

Dashboard · Transactions (add/edit/delete+undo, search, filter, sort, recurring, tags) · Categories with one level of subcategories (add them inline from the transaction form; move, merge, delete) ·
Budgets (per category + overall, 80%/100% warnings, month comparison) · Goals (contributions/withdrawals, monthly saving plan) ·
Reports (monthly/yearly, savings rate, top categories, month-over-month) · Settings (NPR + 13 currencies, dark/light,
financial-month start day, date format) · CSV import/export · JSON backup/restore · delete-all with typed confirmation.
Accounts (cash/bank/wallet) and transfers are included because balances need them; transfers never count as income/expense.

## Categories, subcategories and tags

- Category › Subcategory, one level (e.g. Freelance › Web design, Others › Charity). A transaction can use a parent or a subcategory.
- Budgets on a parent also count its subcategories; a budget on a subcategory counts only that one.
- Reports roll up by parent and expand on tap. Filtering by a parent includes its subcategories.
- Tags: up to 5 per transaction (`#client-x`), searchable, filterable, summarised in Reports. Works with Nepali/other scripts.
- CSV import understands `Subcategory` and `Tags` columns, and `Parent > Sub` in the Category column.

## Design decisions

- Money is stored as **integer paisa** (never floats). Amounts are parsed from text without floating-point maths.
- Dates are plain `YYYY-MM-DD` strings, so there are no timezone surprises.
- User text is only ever inserted as text nodes (no `innerHTML`), CSV export neutralises spreadsheet formulas, and
  backups/CSVs are validated record-by-record before anything is written.
- First run loads sample data (flagged), removable in one click without touching your own entries.

## Layout

```
index.html  css/styles.css  build.mjs
js/  main.js app.js store.js db.js calc.js csv.js backup.js demo.js defaults.js
     utils/ (money dates validate dom)   ui/ (components overlay charts txForm)   views/ (6 pages)
test/  core.test.js (29 unit/integration tests)  e2e.mjs (46 UI checks)  e2e-categories.mjs (48 UI checks)  smoke.mjs
```

`npm test` runs the unit tests. `node test/e2e.mjs <screenshot-dir>` drives the built file in Chromium (needs Playwright).

## Honest limits

Data lives only in this browser: it is **not encrypted** and **not backed up for you**. Clearing site data or switching
phones erases it — use Settings → Download backup regularly. Not yet built (advanced list): debts/loans, tags,
receipts, multi-currency conversion, PWA/offline install, cloud sync, Bikram Sambat dates.
