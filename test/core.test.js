import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAmount, formatMoney, toInputString, toPlainDecimal } from '../js/utils/money.js';
import { periodOf, shiftPeriod, periodsBetween, addMonths, addDays, diffDays, isValidISO, formatDate } from '../js/utils/dates.js';
import { validateTransaction, validateGoal, validateContribution, validateBudget, validateCategory } from '../js/utils/validate.js';
import * as calc from '../js/calc.js';
import { parseCSV, toCSV, rowsToTransactions, transactionsToCSV } from '../js/csv.js';
import { parseBackup, buildBackup } from '../js/backup.js';
import { buildDemo } from '../js/demo.js';
import { DEFAULT_CATEGORIES, DEFAULT_ACCOUNT } from '../js/defaults.js';
import * as store from '../js/store.js';

/* ---------- money ---------- */
test('parseAmount: valid inputs become exact minor units', () => {
  assert.deepEqual(parseAmount('12.34'), { ok: true, minor: 1234 });
  assert.deepEqual(parseAmount('1,234,567.8'), { ok: true, minor: 123456780 });
  assert.deepEqual(parseAmount('0.1'), { ok: true, minor: 10 });
  assert.deepEqual(parseAmount('.5'), { ok: true, minor: 50 });
  assert.deepEqual(parseAmount(' 7 '), { ok: true, minor: 700 });
  // classic float traps
  assert.equal(parseAmount('0.07').minor, 7);
  assert.equal(parseAmount('19.99').minor, 1999);
  assert.equal(parseAmount('1.005'.slice(0, 4)).minor, 100);
});
test('parseAmount: rejects bad input with a message', () => {
  for (const bad of ['', 'abc', '-5', '0', '0.00', '1.234', '1e5', '1..2', '99999999999999']) {
    const r = parseAmount(bad);
    assert.equal(r.ok, false, `expected "${bad}" to fail`);
    assert.ok(r.error.length > 3);
  }
  assert.deepEqual(parseAmount('-5.25', { allowNegative: true }), { ok: true, minor: -525 });
  assert.deepEqual(parseAmount('0', { allowZero: true }), { ok: true, minor: 0 });
});
test('formatMoney: NPR uses lakh grouping, negatives use a real minus', () => {
  assert.equal(formatMoney(123456789, 'NPR'), 'Rs 12,34,567.89');
  assert.equal(formatMoney(-50, 'NPR'), '−Rs 0.50');
  assert.equal(formatMoney(100000, 'USD'), '$1,000.00');
  assert.equal(formatMoney(150000, 'NPR', { decimals: false }), 'Rs 1,500');
  assert.equal(formatMoney(2500, 'NPR', { sign: true }), '+Rs 25.00');
  assert.equal(toInputString(12300), '123');
  assert.equal(toInputString(12350), '123.50');
  assert.equal(toPlainDecimal(-5), '-0.05');
});

/* ---------- dates ---------- */
test('dates: validation and arithmetic', () => {
  assert.ok(isValidISO('2024-02-29'));
  assert.ok(!isValidISO('2023-02-29'));
  assert.ok(!isValidISO('2026-13-01'));
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2024-02-29', 12, 29), '2025-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-11-03', '2026-12-03'), 30);
  assert.equal(formatDate('2026-11-03', 'dmy'), '03 Nov 2026');
  assert.equal(formatDate('2026-11-03', 'mdy'), 'Nov 3, 2026');
});
test('financial month boundaries', () => {
  const cal = periodOf('2026-11-03', 1);
  assert.equal(cal.start, '2026-11-01');
  assert.equal(cal.end, '2026-11-30');
  assert.equal(cal.label, 'November 2026');
  // month starts on the 25th
  assert.equal(periodOf('2026-11-24', 25).start, '2026-10-25');
  assert.equal(periodOf('2026-11-24', 25).end, '2026-11-24');
  assert.equal(periodOf('2026-11-25', 25).start, '2026-11-25');
  assert.equal(periodOf('2026-11-25', 25).end, '2026-12-24');
  assert.equal(periodOf('2027-01-10', 25).start, '2026-12-25');
  assert.equal(shiftPeriod(periodOf('2026-01-15', 1), -1).start, '2025-12-01');
  assert.equal(periodsBetween('2026-09-15', '2026-11-03', 1).length, 3);
  // february, leap year
  assert.equal(periodOf('2028-02-10', 1).end, '2028-02-29');
});

/* ---------- calculations ---------- */
const acc = [{ id: 'a', name: 'A', opening: 100000 }, { id: 'b', name: 'B', opening: 0 }];
const T = (type, amount, date, accountId = 'a', extra = {}) => ({ id: Math.random().toString(36), type, amount, date, accountId, categoryId: type === 'transfer' ? null : 'c1', toAccountId: null, note: '', ...extra });

test('balance = opening + income - expenses; transfers move money but are not income/expense', () => {
  const txns = [T('income', 50000, '2026-11-01'), T('expense', 20000, '2026-11-02'), T('transfer', 30000, '2026-11-03', 'a', { toAccountId: 'b' })];
  assert.equal(calc.accountBalance(acc[0], txns), 100000 + 50000 - 20000 - 30000);
  assert.equal(calc.accountBalance(acc[1], txns), 30000);
  assert.equal(calc.totalBalance(acc, txns), 100000 + 50000 - 20000); // transfers net to zero overall
  const t = calc.totals(txns);
  assert.equal(t.income, 50000);
  assert.equal(t.expense, 20000);
  assert.equal(t.net, 30000);
  assert.equal(t.rate, 60);
});
test('savings rate handles zero income and overspending', () => {
  assert.equal(calc.savingsRate(0, 5000), null);
  assert.equal(calc.savingsRate(0, 0), null);
  assert.equal(calc.savingsRate(100000, 120000), -20);
  assert.equal(calc.savingsRate(300000, 100000), 66.7);
});
test('date range is inclusive at both boundaries', () => {
  const txns = [T('expense', 1, '2026-10-31'), T('expense', 2, '2026-11-01'), T('expense', 4, '2026-11-30'), T('expense', 8, '2026-12-01')];
  assert.equal(calc.totals(calc.within(txns, '2026-11-01', '2026-11-30')).expense, 6);
});
test('budget status thresholds and remaining', () => {
  assert.equal(calc.budgetStatus(10000, 7999).state, 'ok');
  assert.equal(calc.budgetStatus(10000, 8000).state, 'warn');
  assert.equal(calc.budgetStatus(10000, 10000).state, 'warn');
  assert.equal(calc.budgetStatus(10000, 10001).state, 'over');
  assert.equal(calc.budgetStatus(10000, 12500).remaining, -2500);
  const p = periodOf('2026-11-10', 1);
  const txns = [T('expense', 500, '2026-11-05', 'a', { categoryId: 'food' }), T('expense', 700, '2026-11-06', 'a', { categoryId: 'fun' }), T('income', 9999, '2026-11-06'), T('transfer', 4000, '2026-11-07', 'a', { toAccountId: 'b' }), T('expense', 900, '2026-10-30', 'a', { categoryId: 'food' })];
  assert.equal(calc.budgetSpent(txns, p, 'food'), 500);
  assert.equal(calc.budgetSpent(txns, p, null), 1200); // overall ignores income and transfers
});
test('goals: progress and monthly saving estimate', () => {
  const g = { target: 100000, initial: 20000, deadline: '2027-05-03', entries: [{ amount: 10000 }, { amount: -5000 }] };
  assert.equal(calc.goalSaved(g), 25000);
  assert.equal(calc.goalProgress(g), 25);
  const plan = calc.goalPlan(g, '2026-11-03');
  assert.equal(plan.status, 'plan');
  assert.equal(plan.remaining, 75000);
  assert.equal(plan.monthsLeft, 6);
  assert.equal(plan.monthly, 12500);
  assert.equal(calc.goalPlan({ ...g, entries: [{ amount: 80000 }] }, '2026-11-03').status, 'reached');
  assert.equal(calc.goalPlan({ ...g, deadline: '2026-10-01' }, '2026-11-03').status, 'overdue');
  assert.equal(calc.goalPlan({ ...g, deadline: null }, '2026-11-03').status, 'no-deadline');
  assert.equal(calc.goalPlan({ ...g, deadline: '2026-11-10' }, '2026-11-03').monthsLeft, 1);
  assert.equal(calc.pctChange(150, 100), 50);
  assert.equal(calc.pctChange(5, 0), null);
});

/* ---------- validation ---------- */
const cats = DEFAULT_CATEGORIES;
const ctx = { categories: cats, accounts: [DEFAULT_ACCOUNT, { id: 'b', name: 'Bank' }] };
test('transaction validation catches every bad field', () => {
  const ok = validateTransaction({ type: 'expense', amount: '250.50', date: '2026-11-03', categoryId: 'cat-exp-food', accountId: 'acc-cash', note: '  momo\n\tlunch ' }, ctx);
  assert.ok(ok.ok);
  assert.equal(ok.value.amount, 25050);
  assert.equal(ok.value.note, 'momo lunch');
  const bad = validateTransaction({ type: 'expense', amount: '-3', date: '2026-02-30', categoryId: 'cat-inc-salary', accountId: 'nope', note: 'x'.repeat(300) }, ctx);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['accountId', 'amount', 'categoryId', 'date', 'note']);
  const tr = validateTransaction({ type: 'transfer', amount: '10', date: '2026-11-03', accountId: 'b', toAccountId: 'b' }, ctx);
  assert.equal(tr.errors.toAccountId, 'Pick a different account');
  assert.equal(validateTransaction({ type: 'transfer', amount: '10', date: '2026-11-03', accountId: 'b', toAccountId: 'acc-cash' }, ctx).ok, true);
});
test('goal, contribution, budget and category validation', () => {
  assert.equal(validateGoal({ name: 'Trip', target: '5000', initial: '', deadline: '2020-01-01' }, { isNew: true, todayISO: '2026-11-03' }).errors.deadline, 'Choose a date in the future');
  assert.ok(validateGoal({ name: 'Trip', target: '5000', deadline: '' }, { isNew: true, todayISO: '2026-11-03' }).ok);
  assert.equal(validateContribution({ amount: '600', date: '2026-11-03' }, { saved: 50000, kind: 'withdraw' }).errors.amount, 'You cannot withdraw more than you have saved');
  assert.equal(validateContribution({ amount: '100', date: '2026-11-03' }, { saved: 50000, kind: 'withdraw' }).value.amount, -10000);
  assert.ok(validateBudget({ categoryId: 'cat-exp-food', limit: '100' }, { budgets: [], categories: cats }).ok);
  assert.equal(validateBudget({ categoryId: 'cat-exp-food', limit: '100' }, { budgets: [{ id: 'x', categoryId: 'cat-exp-food' }], categories: cats }).errors.categoryId, 'A budget for this category already exists');
  assert.equal(validateBudget({ categoryId: 'cat-inc-salary', limit: '100' }, { budgets: [], categories: cats }).errors.categoryId, 'Choose an expense category');
  assert.equal(validateCategory({ name: 'food', type: 'expense', color: '#123456' }, { categories: cats }).errors.name, 'You already have a category with this name');
  assert.ok(validateCategory({ name: 'Food', type: 'income', color: '#123456' }, { categories: cats }).ok);
});

/* ---------- CSV ---------- */
test('CSV parse handles quotes, embedded commas/newlines, semicolons and BOM', () => {
  const rows = parseCSV('﻿Date,Note\r\n2026-01-01,"a, ""quoted"" note"\r\n2026-01-02,"line1\nline2"\r\n');
  assert.deepEqual(rows, [['Date', 'Note'], ['2026-01-01', 'a, "quoted" note'], ['2026-01-02', 'line1\nline2']]);
  assert.deepEqual(parseCSV('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
});
test('CSV export neutralises spreadsheet formulas and round-trips', () => {
  const out = toCSV([['=HYPERLINK("x")', '+1', 'ok, fine', '@cmd']]);
  assert.ok(out.startsWith('"\'=HYPERLINK(""x"")"'));
  assert.ok(out.includes(",'+1,"));
  const txns = [{ id: '1', type: 'expense', amount: 12345, date: '2026-11-03', categoryId: 'cat-exp-food', accountId: 'acc-cash', note: '=SUM(A1)' }];
  const csv = transactionsToCSV(txns, { categories: cats, accounts: [DEFAULT_ACCOUNT] });
  const res = rowsToTransactions(parseCSV(csv), { categories: cats, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash' });
  assert.equal(res.errors.length, 0);
  assert.equal(res.valid.length, 1);
  assert.equal(res.valid[0].amount, 12345);
  assert.equal(res.valid[0].note, '=SUM(A1)');
  assert.equal(res.valid[0].categoryId, 'cat-exp-food');
});
test('CSV import validates rows, reports line numbers, creates categories, skips duplicates', () => {
  const csv = [
    'Date,Type,Amount,Category,Account,Note',
    '2026-11-01,expense,100.50,Food,Cash,lunch',
    '2026-11-02,income,5000,Consulting,Cash,client',
    '2026-13-45,expense,10,Food,Cash,bad date',
    '2026-11-03,expense,abc,Food,Cash,bad amount',
    '2026-11-04,gift,10,Food,Cash,bad type',
    '2026-11-01,expense,100.50,Food,Cash,lunch',
  ].join('\n');
  const existing = [{ date: '2026-11-01', type: 'expense', amount: 10050, categoryId: 'cat-exp-food', accountId: 'acc-cash', note: 'lunch' }];
  const r = rowsToTransactions(parseCSV(csv), { categories: cats, accounts: [DEFAULT_ACCOUNT], existing, defaultAccountId: 'acc-cash' });
  assert.equal(r.valid.length, 1);
  assert.equal(r.duplicates, 2);
  assert.deepEqual(r.errors.map((e) => e.line), [4, 5, 6]);
  assert.equal(r.newCategories.length, 1);
  assert.equal(r.newCategories[0].name, 'Consulting');
  const noHeader = rowsToTransactions(parseCSV('foo,bar\n1,2'), { categories: cats, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash' });
  assert.match(noHeader.errors[0].msg, /Date.*Amount/);
  // signed amounts without a Type column
  const signed = rowsToTransactions(parseCSV('date,amount\n2026-11-01,-250\n2026-11-02,900'), { categories: cats, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash' });
  assert.deepEqual(signed.valid.map((t) => [t.type, t.amount]), [['expense', 25000], ['income', 90000]]);
  // day-first vs month-first
  assert.equal(rowsToTransactions(parseCSV('date,amount\n03/11/2026,5'), { categories: cats, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash', dateStyle: 'dmy' }).valid[0].date, '2026-11-03');
  assert.equal(rowsToTransactions(parseCSV('date,amount\n03/11/2026,5'), { categories: cats, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash', dateStyle: 'mdy' }).valid[0].date, '2026-03-11');
});

/* ---------- demo data ---------- */
test('demo data is internally consistent and realistic', () => {
  const today = '2026-11-03';
  const d = buildDemo(today);
  assert.ok(d.transactions.length > 150);
  assert.ok(d.transactions.every((t) => t.date <= today && t.demo && t.amount > 0));
  assert.ok(new Set(d.transactions.map((t) => t.id)).size === d.transactions.length);
  const accounts = [{ ...DEFAULT_ACCOUNT }, ...d.accounts];
  const ids = new Set(accounts.map((a) => a.id));
  assert.ok(d.transactions.every((t) => ids.has(t.accountId) && (t.type !== 'transfer' || ids.has(t.toAccountId))));
  const catIds = new Set([...cats, ...d.categories].map((c) => c.id));
  assert.ok(d.transactions.every((t) => t.type === 'transfer' || catIds.has(t.categoryId)));
  for (const c of d.categories) {
    const p = cats.find((x) => x.id === c.parentId);
    assert.ok(p && !p.parentId && p.type === c.type && p.color === c.color, `${c.name} has a valid top-level parent of the same type`);
  }
  assert.ok(d.transactions.some((t) => (t.tags || []).length), 'demo has tagged transactions');
  for (const a of accounts) assert.ok(calc.accountBalance(a, d.transactions) >= 0, `${a.name} should never go negative`);
  assert.ok(d.recurring.every((r) => r.nextDate > today));
  const parsed = parseBackup(JSON.stringify(buildBackup({ ...d, accounts, categories: [...cats, ...d.categories] }, store.settings)));
  assert.ok(parsed.ok);
  assert.equal(parsed.dropped, 0);
});

/* ---------- backup ---------- */
test('backup round-trips and rejects hostile or broken files', () => {
  const d = buildDemo('2026-11-03');
  const snapshot = { accounts: [DEFAULT_ACCOUNT, ...d.accounts], categories: [...cats, ...d.categories], transactions: d.transactions, recurring: d.recurring, budgets: d.budgets, goals: d.goals };
  const parsed = parseBackup(JSON.stringify(buildBackup(snapshot, { theme: 'dark', currency: 'USD', monthStart: 5, dateFormat: 'iso' })));
  assert.ok(parsed.ok);
  assert.equal(parsed.data.transactions.length, d.transactions.length);
  assert.equal(parsed.data.categories.filter((c) => c.parentId).length, d.categories.length, 'subcategory links survive a backup');
  assert.ok(parsed.data.transactions.some((t) => t.tags?.length), 'tags survive a backup');
  assert.deepEqual(parsed.settings, { theme: 'dark', currency: 'USD', monthStart: 5, dateFormat: 'iso' });
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup('{"app":"other"}').ok, false);
  assert.equal(parseBackup('{"app":"paisa","version":99}').ok, false);
  const evil = parseBackup(JSON.stringify({
    app: 'paisa', version: 1, settings: { currency: 'XXX', monthStart: 99, theme: '<script>' },
    data: {
      accounts: [{ id: 'a1', name: '<img src=x onerror=alert(1)>', opening: 'lots' }, { id: 'a2', name: 'Fine', type: 'bank', opening: 500 }],
      categories: [{ id: 'c1', name: 'Food', type: 'expense', color: 'red; background:url(x)' }],
      transactions: [
        { id: 't1', type: 'expense', amount: 100, date: '2026-01-01', categoryId: 'c1', accountId: 'a2', note: 'ok' },
        { id: 't2', type: 'expense', amount: -100, date: '2026-01-01', categoryId: 'c1', accountId: 'a2' },
        { id: 't3', type: 'expense', amount: 1.5, date: '2026-01-01', categoryId: 'c1', accountId: 'a2' },
        { id: 't4', type: 'expense', amount: 100, date: '2026-01-01', categoryId: 'ghost', accountId: 'a2' },
        { id: 't5', type: 'expense', amount: 100, date: 'yesterday', categoryId: 'c1', accountId: 'a2' },
        { id: 't1', type: 'expense', amount: 100, date: '2026-01-01', categoryId: 'c1', accountId: 'a2' },
        null, 'junk',
      ],
    },
  }));
  assert.ok(evil.ok);
  assert.deepEqual(evil.settings, {});
  assert.equal(evil.data.transactions.length, 1);
  assert.equal(evil.data.accounts.length, 1);
  assert.equal(evil.data.categories.find((c) => c.id === 'c1').color, '#64748b');
  assert.ok(evil.data.categories.some((c) => c.type === 'income' && c.fallback), 'income fallback category is restored');
  assert.ok(evil.dropped >= 7);
});

/* ---------- store (real IndexedDB API via fake-indexeddb) ---------- */
test('store: first run seeds demo data, recurring posts once, edits adopt demo rows', async () => {
  const res = await store.init();
  assert.equal(res.posted, 0);
  assert.ok(store.state.transactions.length > 150);
  assert.ok(store.hasDemo());
  assert.equal(store.status.persistent, true);

  // CRUD
  const food = 'cat-exp-food';
  const created = await store.saveTransaction({ type: 'expense', amount: 4200, date: '2026-11-02', categoryId: food, accountId: 'acc-cash', toAccountId: null, note: 'test' });
  assert.ok(store.state.transactions.some((t) => t.id === created.id));
  const edited = await store.saveTransaction({ amount: 5200 }, created.id);
  assert.equal(edited.amount, 5200);
  const demoTxn = store.state.transactions.find((t) => t.demo);
  const adopted = await store.saveTransaction({ note: 'mine now' }, demoTxn.id);
  assert.equal(adopted.demo, undefined);
  const gone = await store.deleteTransaction(created.id);
  assert.equal(gone.id, created.id);
  assert.ok(!store.state.transactions.some((t) => t.id === created.id));
  await store.restoreTransaction(gone);
  assert.ok(store.state.transactions.some((t) => t.id === created.id));

  // Recurring: weekly rule that started 3 weeks ago backfills 3 occurrences, then is idempotent
  const base = { type: 'expense', amount: 1000, categoryId: food, accountId: 'acc-cash', toAccountId: null, note: 'sub', date: addDays('2026-11-03', -21) };
  const rule = await store.createRecurring(base, 'weekly');
  assert.equal(rule.nextDate, addDays('2026-11-03', -14));
  const n1 = await store.processRecurring('2026-11-03');
  assert.equal(n1, 3);
  assert.equal(await store.processRecurring('2026-11-03'), 0);
  assert.equal(store.state.recurring.find((r) => r.id === rule.id).nextDate, '2026-11-10');
  // End dates are respected and the rule deactivates
  const limited = await store.createRecurring({ ...base, date: addDays('2026-11-03', -21) }, 'weekly', addDays('2026-11-03', -7));
  assert.equal(await store.processRecurring('2026-11-03'), 2);
  assert.equal(store.state.recurring.find((r) => r.id === limited.id).active, false);
  // Monthly rule anchored to the 31st clamps correctly
  const m = await store.createRecurring({ ...base, date: '2026-01-31' }, 'monthly');
  assert.equal(m.nextDate, '2026-02-28');
  await store.processRecurring('2026-04-30');
  assert.deepEqual(store.state.transactions.filter((t) => t.recurringId === m.id).map((t) => t.date).sort(), ['2026-02-28', '2026-03-31', '2026-04-30']);

  // Persistence: a fresh load reads the same data back from IndexedDB
  const before = store.state.transactions.length;
  const db = await import('../js/db.js');
  assert.equal((await db.getAll('transactions')).length, before);
});

test('store: category/account deletion moves data safely; removeDemo keeps user data', async () => {
  const s = store;
  const mine = await s.saveTransaction({ type: 'expense', amount: 999, date: '2026-11-01', categoryId: 'cat-exp-fun', accountId: 'acc-demo-wallet', toAccountId: null, note: 'user txn on a demo account' });
  const custom = await s.saveCategory({ name: 'Pets', type: 'expense', icon: '🐶', color: '#123456' });
  const pet = await s.saveTransaction({ type: 'expense', amount: 1500, date: '2026-11-01', categoryId: custom.id, accountId: 'acc-cash', toAccountId: null, note: 'vet' });
  await s.saveBudget({ categoryId: custom.id, limit: 5000 });
  await assert.rejects(() => s.deleteCategory('cat-exp-other', 'cat-exp-food'), /cannot be deleted/);
  await assert.rejects(() => s.deleteCategory(custom.id, 'cat-inc-salary'), /same type/);
  await s.deleteCategory(custom.id, 'cat-exp-other');
  assert.equal(s.state.transactions.find((t) => t.id === pet.id).categoryId, 'cat-exp-other');
  assert.ok(!s.state.budgets.some((b) => b.categoryId === custom.id));

  const balBefore = (id) => s.state.accounts.length && id;
  void balBefore;
  await s.removeDemo();
  assert.ok(!s.hasDemo());
  assert.deepEqual(s.state.accounts.map((a) => a.id), ['acc-cash']);
  const survivor = s.state.transactions.find((t) => t.id === mine.id);
  assert.equal(survivor.accountId, 'acc-cash', "user's transaction was moved off the removed sample account");
  assert.equal(s.state.budgets.length, 0);
  assert.equal(s.state.goals.length, 0);
  assert.ok(s.state.transactions.every((t) => !t.demo));
  assert.ok(s.state.categories.length >= 15);

  const extra = await s.saveAccount({ name: 'Bank', type: 'bank', opening: 10000 });
  const mv = await s.saveTransaction({ type: 'transfer', amount: 500, date: '2026-11-01', categoryId: null, accountId: extra.id, toAccountId: 'acc-cash', note: '' });
  await s.deleteAccount(extra.id, 'acc-cash');
  assert.ok(!s.state.transactions.some((t) => t.id === mv.id), 'self-transfer produced by the move is dropped');
  await assert.rejects(() => s.deleteAccount('acc-cash', 'acc-cash'), /at least one account|another account/);
});

test('store: importTransactions, restore and clear all', async () => {
  const s = store;
  const csv = 'Date,Type,Amount,Category,Account,Note\n2026-11-01,expense,100,Snacks,Wallet X,chips\n2026-11-02,income,200,Salary,Wallet X,pay';
  const r = rowsToTransactions(parseCSV(csv), { categories: s.state.categories, accounts: s.state.accounts, defaultAccountId: 'acc-cash' });
  const count = await s.importTransactions(r);
  assert.equal(count, 2);
  assert.ok(s.state.accounts.some((a) => a.name === 'Wallet X'));
  const snack = s.state.categories.find((c) => c.name === 'Snacks');
  assert.ok(snack && s.state.transactions.some((t) => t.categoryId === snack.id));
  const salary = s.state.transactions.find((t) => t.note === 'pay');
  assert.equal(salary.categoryId, 'cat-inc-salary');

  const backup = JSON.stringify(s.exportBackup());
  await s.clearAll();
  assert.equal(s.state.transactions.length, 0);
  assert.equal(s.state.accounts.length, 1);
  assert.equal(s.state.categories.length, 15);
  assert.equal(s.settings.seeded, true);
  const parsed = parseBackup(backup);
  await s.restoreBackup(parsed);
  assert.equal(s.state.transactions.length, parsed.data.transactions.length);
  assert.ok(s.state.transactions.some((t) => t.note === 'chips'));
});


/* ---------- subcategories, tags, roll-up, move / merge ---------- */
import { normalizeTag, normalizeTags, validateCategory as vCat } from '../js/utils/validate.js';

test('tags are normalised, de-duplicated and capped', () => {
  assert.equal(normalizeTag('  #Work Trip! '), 'work-trip');
  assert.equal(normalizeTag('###'), '');
  assert.equal(normalizeTag('नेपाल'), 'नेपाल', 'Devanagari vowel signs are kept');
  assert.equal(normalizeTag('Café'), 'café');
  assert.equal(normalizeTag('a'.repeat(50)).length, 20);
  assert.deepEqual(normalizeTags(['Work', '#work', 'WORK ', '', 'trip']), ['work', 'trip']);
  const base = { type: 'expense', amount: '10', date: '2026-11-03', categoryId: 'cat-exp-food', accountId: 'acc-cash' };
  assert.deepEqual(validateTransaction({ ...base, tags: ['a', 'b'] }, ctx).value.tags, ['a', 'b']);
  assert.equal(validateTransaction({ ...base, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, ctx).errors.tags, 'Use at most 5 tags');
});

test('subcategory validation: one level, same type, unique among siblings', () => {
  const base = [...cats, { id: 'sub1', parentId: 'cat-inc-freelance', name: 'Web', type: 'income', icon: '🌐', color: '#0f766e' }];
  const ok = vCat({ name: 'Design', type: 'income', parentId: 'cat-inc-freelance', icon: '🎨' }, { categories: base });
  assert.ok(ok.ok);
  assert.equal(ok.value.color, '#2563eb', 'inherits the parent color (no color picked)');
  assert.equal(ok.value.parentId, 'cat-inc-freelance');
  assert.equal(vCat({ name: 'web', type: 'income', parentId: 'cat-inc-freelance' }, { categories: base }).errors.name, 'This parent already has a subcategory with this name');
  // same name under a different parent is fine
  assert.ok(vCat({ name: 'Web', type: 'income', parentId: 'cat-inc-business' }, { categories: base }).ok);
  assert.ok(vCat({ name: 'Others', type: 'income', parentId: 'cat-inc-business' }, { categories: base }).ok);
  assert.equal(vCat({ name: 'X', type: 'income', parentId: 'sub1' }, { categories: base }).errors.parentId, 'Choose a top-level category as the parent');
  assert.equal(vCat({ name: 'X', type: 'expense', parentId: 'cat-inc-freelance' }, { categories: base }).errors.parentId, 'The parent must be the same type');
  assert.equal(vCat({ name: 'Freelance', type: 'income', parentId: 'cat-inc-freelance' }, { categories: base, editingId: 'cat-inc-freelance' }).errors.parentId, 'A category cannot be its own parent');
  assert.equal(vCat({ name: 'Freelance', type: 'income', parentId: 'cat-inc-business', color: '#123456' }, { categories: base, editingId: 'cat-inc-freelance' }).errors.parentId, 'This category has subcategories, so it has to stay top-level');
  assert.equal(vCat({ name: 'Ghost', type: 'income', parentId: 'nope' }, { categories: base }).errors.parentId, 'Choose a top-level category as the parent');
});

test('roll-up breakdown, family budgets and tag totals', () => {
  const cs = [...cats, { id: 'g', parentId: 'cat-exp-food', name: 'Groceries', type: 'expense', icon: '🛒', color: '#c2410c' }, { id: 'd', parentId: 'cat-exp-food', name: 'Dining', type: 'expense', icon: '🍽️', color: '#c2410c' }];
  const E = (amount, categoryId, extra = {}) => T('expense', amount, '2026-11-05', 'a', { categoryId, ...extra });
  const txns = [E(3000, 'g', { tags: ['family', 'weekly'] }), E(1000, 'd', { tags: ['family'] }), E(500, 'cat-exp-food'), E(700, 'cat-exp-fun')];
  const flat = calc.categoryBreakdown(txns, 'expense', cs);
  assert.equal(flat.length, 4, 'flat mode keeps subcategories separate');
  const roll = calc.categoryBreakdown(txns, 'expense', cs, { rollup: true });
  assert.equal(roll.length, 2);
  assert.equal(roll[0].id, 'cat-exp-food');
  assert.equal(roll[0].amount, 4500);
  assert.deepEqual(roll[0].children.map((c) => [c.name, c.amount]), [['Groceries', 3000], ['Dining', 1000], ['No subcategory', 500]]);
  assert.equal(roll[0].children[0].share, 3000 / 4500);
  assert.equal(roll[1].children.length, 0, 'a category with no subs has no children');
  assert.equal(roll.reduce((s, r) => s + r.amount, 0), 5200, 'roll-up never changes the total');
  // a parent with only direct spending shows no drill-down
  assert.equal(calc.categoryBreakdown([E(500, 'cat-exp-food')], 'expense', cs, { rollup: true })[0].children.length, 0);
  // budgets: a Food budget counts its subcategories; a Groceries budget counts only Groceries
  const p = periodOf('2026-11-10', 1);
  assert.equal(calc.budgetSpent(txns, p, 'cat-exp-food', calc.familyIds(cs, 'cat-exp-food')), 4500);
  assert.equal(calc.budgetSpent(txns, p, 'cat-exp-food'), 500, 'without the family only direct spending counts');
  assert.equal(calc.budgetSpent(txns, p, 'g', calc.familyIds(cs, 'g')), 3000);
  assert.deepEqual(calc.tagBreakdown(txns).map((t) => [t.tag, t.amount, t.count]), [['family', 4000, 2], ['weekly', 3000, 1]]);
});

test('CSV: subcategory and tags round-trip, "Parent > Sub" shorthand, new parents are created', () => {
  const cs = [...cats, { id: 'w', parentId: 'cat-inc-freelance', name: 'Web', type: 'income', icon: '🌐', color: '#2563eb' }];
  const txns = [{ id: '1', type: 'income', amount: 500000, date: '2026-11-03', categoryId: 'w', accountId: 'acc-cash', note: 'site', tags: ['work', 'client-a'] }];
  const csv = transactionsToCSV(txns, { categories: cs, accounts: [DEFAULT_ACCOUNT] });
  assert.ok(csv.split('\r\n')[0].includes('Category,Subcategory,Account'));
  assert.ok(csv.includes('Freelance,Web,Cash'));
  assert.ok(csv.includes('work;client-a'));
  const back = rowsToTransactions(parseCSV(csv), { categories: cs, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash' });
  assert.equal(back.errors.length, 0);
  assert.equal(back.valid[0].categoryId, 'w');
  assert.deepEqual(back.valid[0].tags, ['work', 'client-a']);
  assert.equal(back.newCategories.length, 0, 'existing subcategory is reused');
  const mixed = [
    'Date,Type,Amount,Category,Note,Tags',
    '2026-11-01,expense,100,Food > Groceries,veg,"home, weekly"',
    '2026-11-02,expense,200,Food › Groceries,more,',
    '2026-11-03,expense,300,Pets > Vet,vet,#pets',
    '2026-11-04,income,400,Freelance > Logo,logo,',
  ].join('\n');
  const r = rowsToTransactions(parseCSV(mixed), { categories: cs, accounts: [DEFAULT_ACCOUNT], defaultAccountId: 'acc-cash' });
  assert.equal(r.errors.length, 0);
  const names = r.newCategories.map((c) => (c.parentId ? 'sub:' : 'top:') + c.name).sort();
  assert.deepEqual(names, ['sub:Groceries', 'sub:Logo', 'sub:Vet', 'top:Pets'], 'Food and Freelance are reused; Pets is created because its sub is used');
  const groceries = r.newCategories.find((c) => c.name === 'Groceries');
  assert.equal(groceries.parentId, 'cat-exp-food');
  assert.equal(groceries.color, cats.find((c) => c.id === 'cat-exp-food').color);
  assert.equal(r.valid[0].categoryId, r.valid[1].categoryId, 'both spellings hit the same new subcategory');
  const vet = r.newCategories.find((c) => c.name === 'Vet');
  assert.equal(vet.parentId, r.newCategories.find((c) => c.name === 'Pets').id);
  assert.deepEqual(r.valid[0].tags, ['home', 'weekly']);
  assert.deepEqual(r.valid[2].tags, ['pets']);
});

test('backup: bad parent links are repaired, tags are cleaned', () => {
  const res = parseBackup(JSON.stringify({
    app: 'paisa', version: 1,
    data: {
      accounts: [{ id: 'a', name: 'A', opening: 0 }],
      categories: [
        { id: 'p', name: 'Parent', type: 'expense', color: '#112233', icon: '📦' },
        { id: 'ok', name: 'Child', type: 'expense', color: '#999999', parentId: 'p' },
        { id: 'deep', name: 'Grandchild', type: 'expense', parentId: 'ok' },
        { id: 'xt', name: 'Wrong type', type: 'income', parentId: 'p' },
        { id: 'ghost', name: 'Orphan', type: 'expense', parentId: 'missing' },
      ],
      transactions: [{ id: 't', type: 'expense', amount: 100, date: '2026-01-01', categoryId: 'ok', accountId: 'a', tags: ['#Work', 'work', '<b>x</b>', 7, null, 'a', 'b', 'c', 'd', 'e'] }],
    },
  }));
  assert.ok(res.ok);
  const by = Object.fromEntries(res.data.categories.map((c) => [c.id, c]));
  assert.equal(by.ok.parentId, 'p');
  assert.equal(by.ok.color, '#112233', 'child takes the parent color');
  assert.equal(by.deep.parentId, undefined, 'no third level: grandchild becomes top-level');
  assert.equal(by.xt.parentId, undefined, 'a parent of another type is dropped');
  assert.equal(by.ghost.parentId, undefined);
  assert.deepEqual(res.data.transactions[0].tags, ['work', 'bxb', '7', 'a', 'b'], 'tags normalised, deduplicated, markup characters stripped, null dropped, capped at 5');
});

test('store: sub-categories, color follow, merge, delete-with-children', async () => {
  const s = store;
  await s.clearAll();
  const parent = await s.saveCategory({ name: 'Pets', type: 'expense', icon: '🐶', color: '#123456', parentId: null });
  const vet = await s.saveCategory({ name: 'Vet', type: 'expense', icon: '💉', color: parent.color, parentId: parent.id });
  const toys = await s.saveCategory({ name: 'Toys', type: 'expense', icon: '🧸', color: parent.color, parentId: parent.id });
  assert.equal(s.categoryLabel(vet), 'Pets › Vet');
  assert.equal(s.categoryLabel(parent), 'Pets');
  assert.deepEqual(s.childrenOf(parent.id).map((c) => c.name).sort(), ['Toys', 'Vet']);
  // editing the parent's color recolours its subcategories
  await s.saveCategory({ name: 'Pets', type: 'expense', icon: '🐶', color: '#abcdef', parentId: null }, parent.id);
  assert.equal(s.state.categories.find((c) => c.id === vet.id).color, '#abcdef');
  // "Others" can never become a sub
  await assert.rejects(() => s.saveCategory({ name: 'Others', type: 'expense', icon: '📦', color: '#000000', parentId: parent.id }, 'cat-exp-other'), /top-level/);
  const mk = (categoryId, amount, tags = []) => s.saveTransaction({ type: 'expense', amount, date: '2026-11-02', categoryId, accountId: 'acc-cash', toAccountId: null, note: '', tags });
  const t1 = await mk(vet.id, 1000, ['pets']);
  await mk(toys.id, 500, ['pets', 'fun']);
  await mk(parent.id, 200);
  assert.equal(s.categoryUsage(parent.id), 1);
  assert.equal(s.categoryUsage(parent.id, { family: true }), 3);
  assert.deepEqual(s.allTags(), ['pets', 'fun']);
  await s.saveBudget({ categoryId: toys.id, limit: 9000 });
  await s.saveBudget({ categoryId: parent.id, limit: 9000 });

  // move a sub under a different parent via saveCategory (what the Settings dialog does)
  const other = await s.saveCategory({ name: 'Family', type: 'expense', icon: '👪', color: '#778899', parentId: null });
  const moved = await s.saveCategory({ name: 'Toys', type: 'expense', icon: '🧸', color: other.color, parentId: other.id }, toys.id);
  assert.equal(moved.parentId, other.id);

  // merge Vet into Family: transactions move, budgets of the source go, source disappears
  const res = await s.mergeCategories(vet.id, other.id);
  assert.equal(res.moved, 1);
  assert.ok(!s.state.categories.some((c) => c.id === vet.id));
  assert.equal(s.state.transactions.find((t) => t.id === t1.id).categoryId, other.id);
  assert.deepEqual(s.state.transactions.find((t) => t.id === t1.id).tags, ['pets'], 'tags survive a merge');
  // merging a parent into a top-level category hands its subs over
  const sub2 = await s.saveCategory({ name: 'Food', type: 'expense', icon: '🍖', color: '#abcdef', parentId: parent.id });
  const r2 = await s.mergeCategories(parent.id, other.id);
  assert.equal(r2.subcategories, 1);
  assert.equal(s.state.categories.find((c) => c.id === sub2.id).parentId, other.id);
  assert.equal(s.state.categories.find((c) => c.id === sub2.id).color, '#778899');
  assert.ok(!s.state.budgets.some((b) => b.categoryId === parent.id), 'merged-away category budget removed');
  // guards
  await assert.rejects(() => s.mergeCategories(other.id, sub2.id), /into its parent|subcategory/);
  await assert.rejects(() => s.mergeCategories(other.id, 'cat-inc-salary'), /same type/);
  await assert.rejects(() => s.mergeCategories('cat-exp-other', other.id), /cannot be merged/);
  await assert.rejects(() => s.mergeCategories(other.id, other.id), /two different/);

  // merging a SUB into a top-level of a different family keeps one level
  const lone = await s.saveCategory({ name: 'Lone', type: 'expense', icon: '📦', color: '#111111', parentId: null });
  await s.mergeCategories(sub2.id, lone.id);
  assert.ok(s.state.categories.every((c) => !c.parentId || !s.state.categories.find((p) => p.id === c.parentId)?.parentId), 'never more than one level');

  // delete a parent with children: everything is re-homed, budgets removed
  const kid = await s.saveCategory({ name: 'Kid', type: 'expense', icon: '👶', color: '#778899', parentId: other.id });
  const tk = await mk(kid.id, 77);
  await assert.rejects(() => s.deleteCategory(other.id, kid.id), /same type/, 'cannot move into the category being deleted');
  await s.deleteCategory(other.id, 'cat-exp-other');
  assert.ok(![other.id, kid.id, toys.id].some((id) => s.state.categories.some((c) => c.id === id)), 'parent and its subs are gone');
  assert.equal(s.state.transactions.find((t) => t.id === tk.id).categoryId, 'cat-exp-other');
  assert.ok(s.state.transactions.every((t) => s.state.categories.some((c) => c.id === t.categoryId)), 'no transaction points at a missing category');
  assert.ok(s.state.budgets.every((b) => !b.categoryId || s.state.categories.some((c) => c.id === b.categoryId)));
});

test('store: importing a CSV creates parents and subs with real ids; recurring keeps tags', async () => {
  const s = store;
  await s.clearAll();
  const csv = 'Date,Type,Amount,Category,Subcategory,Account,Note,Tags\n2026-11-01,expense,100,Pets,Vet,Cash,shots,pets;health\n2026-11-02,expense,50,Pets,Toys,Cash,ball,pets';
  const r = rowsToTransactions(parseCSV(csv), { categories: s.state.categories, accounts: s.state.accounts, defaultAccountId: 'acc-cash' });
  assert.equal(await s.importTransactions(r), 2);
  const pets = s.state.categories.find((c) => c.name === 'Pets' && !c.parentId);
  const vet = s.state.categories.find((c) => c.name === 'Vet');
  assert.ok(pets && vet);
  assert.equal(vet.parentId, pets.id, 'temporary import ids were replaced by real ones');
  assert.ok(!pets.id.startsWith('imp-') && !vet.id.startsWith('imp-'));
  assert.equal(s.state.transactions.find((t) => t.note === 'shots').categoryId, vet.id);
  assert.deepEqual(s.state.transactions.find((t) => t.note === 'shots').tags, ['pets', 'health']);
  const rule = await s.createRecurring({ type: 'expense', amount: 500, categoryId: vet.id, accountId: 'acc-cash', toAccountId: null, note: 'plan', tags: ['pets'], date: '2026-10-01' }, 'monthly');
  assert.deepEqual(rule.tags, ['pets']);
  await s.processRecurring('2026-11-03');
  assert.deepEqual(s.state.transactions.find((t) => t.recurringId === rule.id).tags, ['pets'], 'posted occurrences inherit the rule tags');
});

test('store: removing sample data also removes sample subcategories unless you use them', async () => {
  const s = store;
  await s.clearAll();
  await s.seedDemo();
  assert.ok(s.state.categories.some((c) => c.demo && c.parentId), 'sample subcategories loaded');
  const mine = s.state.transactions.find((t) => t.categoryId === 'cat-sub-groceries');
  await s.saveTransaction({ note: 'mine now' }, mine.id); // adopts the transaction
  await s.removeDemo();
  assert.ok(!s.hasDemo());
  assert.ok(s.state.categories.some((c) => c.id === 'cat-sub-groceries' && !c.demo), 'a subcategory you use is kept and becomes yours');
  assert.ok(!s.state.categories.some((c) => c.id === 'cat-sub-web'), 'unused sample subcategory removed');
  assert.ok(s.state.transactions.every((t) => s.state.categories.some((c) => c.id === t.categoryId) || t.type === 'transfer'));
});


test('store: lists keep a human order after a reload (defaults first, then creation order)', async () => {
  const s = store;
  await s.clearAll();
  // names chosen so alphabetical order differs from creation order
  const a = await s.saveCategory({ name: 'Zeta', type: 'expense', icon: '📦', color: '#112233', parentId: null });
  const b = await s.saveCategory({ name: 'Alpha', type: 'expense', icon: '📦', color: '#112233', parentId: null });
  const c = await s.saveCategory({ name: 'Mid', type: 'expense', icon: '📦', color: '#112233', parentId: null });
  const bank = await s.saveAccount({ name: 'AAA Bank', type: 'bank', opening: 0 });
  const wallet = await s.saveAccount({ name: 'Wallet', type: 'wallet', opening: 0 });
  await s.init(); // reloads everything from IndexedDB, which returns records ordered by random id
  const exp = s.topCategories('expense').map((x) => x.name);
  assert.deepEqual(exp.slice(0, 9), ['Food', 'Transportation', 'Housing', 'Shopping', 'Healthcare', 'Education', 'Entertainment', 'Bills', 'Others'], 'built-in order is preserved');
  assert.deepEqual(exp.slice(9), ['Zeta', 'Alpha', 'Mid'], 'your own categories follow in creation order');
  assert.deepEqual(s.state.accounts.map((x) => x.name), ['Cash', 'AAA Bank', 'Wallet'], 'Cash stays first, then accounts in creation order');
  void [a, b, c, bank, wallet];
  // a backup keeps that order too
  const parsed = parseBackup(JSON.stringify(s.exportBackup()));
  await s.restoreBackup(parsed);
  await s.init();
  assert.deepEqual(s.topCategories('expense').slice(9).map((x) => x.name), ['Zeta', 'Alpha', 'Mid'], 'order survives backup and restore');
});
