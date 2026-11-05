// App state + persistence. Views read `state`/`settings` and call the async mutators below;
// every mutator writes to IndexedDB first, then updates memory and notifies subscribers.

import * as db from './db.js';
import { DEFAULT_ACCOUNT, DEFAULT_CATEGORIES } from './defaults.js';
import { CURRENCIES, formatMoney, formatShort } from './utils/money.js';
import { today, addDays, addMonths, formatDate } from './utils/dates.js';
import { buildDemo } from './demo.js';
import { buildBackup } from './backup.js';

/* ---------- Settings (LocalStorage: lightweight preferences only) ---------- */

const SETTINGS_KEY = 'paisa.settings.v1';
export const DEFAULT_SETTINGS = { theme: 'system', currency: 'NPR', monthStart: 1, dateFormat: 'dmy', seeded: false };

export function sanitizeSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  if (['system', 'light', 'dark'].includes(s.theme)) out.theme = s.theme;
  if (typeof s.currency === 'string' && CURRENCIES[s.currency]) out.currency = s.currency;
  if (Number.isInteger(s.monthStart) && s.monthStart >= 1 && s.monthStart <= 28) out.monthStart = s.monthStart;
  if (['dmy', 'mdy', 'iso'].includes(s.dateFormat)) out.dateFormat = s.dateFormat;
  out.seeded = s.seeded === true;
  return out;
}

function readSettings() {
  try { return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { return { ...DEFAULT_SETTINGS }; }
}
export const settings = readSettings();

export function setSettings(patch) {
  Object.assign(settings, sanitizeSettings({ ...settings, ...patch }));
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage may be blocked; settings then last for this session only */ }
  emit();
}

/* ---------- Formatting helpers bound to current settings ---------- */

export const fmt = (minor, opts) => formatMoney(minor, settings.currency, opts);
export const fmtShort = (minor) => formatShort(minor, settings.currency);
export const fmtDate = (iso) => formatDate(iso, settings.dateFormat);

/* ---------- State ---------- */

export const state = { accounts: [], categories: [], transactions: [], recurring: [], budgets: [], goals: [] };
export const status = { persistent: true, error: null };

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/*
 * IndexedDB hands records back ordered by id, which is meaningless for people. Keep the built-in
 * categories/account in their designed order, then everything else in the order it was created
 * (`sort` is a creation sequence number; records without one, such as sample data, come first).
 */
let lastSort = 0;
export const nextSort = () => (lastSort = Math.max(Date.now(), lastSort + 1));
function orderBy(builtIn) {
  return (a, b) => {
    const ia = builtIn.indexOf(a.id), ib = builtIn.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return ia < 0 ? 1 : ib < 0 ? -1 : ia - ib;
    return (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name));
  };
}
export function sortLists() {
  state.categories.sort(orderBy(DEFAULT_CATEGORIES.map((c) => c.id)));
  state.accounts.sort(orderBy([DEFAULT_ACCOUNT.id]));
}
function emit() {
  sortLists();
  listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`);

const byId = (list, id) => list.find((x) => x.id === id);
const upsert = (list, obj) => {
  const i = list.findIndex((x) => x.id === obj.id);
  if (i >= 0) list[i] = obj; else list.push(obj);
};
const catById = (id) => byId(state.categories, id);
const accById = (id) => byId(state.accounts, id);
export const getCategory = catById;
export const getAccount = accById;
export const childrenOf = (id) => state.categories.filter((c) => c.parentId === id);
export const topCategories = (type) => state.categories.filter((c) => c.type === type && !c.parentId);
/** "Freelance › Web design" for a subcategory, plain name otherwise. */
export function categoryLabel(c) {
  if (!c) return 'Uncategorized';
  const p = c.parentId ? catById(c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}
/** Every tag in use, most used first. */
export function allTags() {
  const n = new Map();
  for (const t of state.transactions) for (const g of t.tags || []) n.set(g, (n.get(g) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
}
export const defaultAccount = () => state.accounts.find((a) => a.isDefault) || state.accounts[0];
export const fallbackCategory = (type) => state.categories.find((c) => c.type === type && c.fallback) || state.categories.find((c) => c.type === type);
export const hasDemo = () => ['accounts', 'categories', 'transactions', 'recurring', 'budgets', 'goals'].some((k) => state[k].some((x) => x.demo));

async function loadAll() {
  const [accounts, categories, transactions, recurring, budgets, goals] = await Promise.all(db.STORES.map((s) => db.getAll(s)));
  Object.assign(state, { accounts, categories, transactions, recurring, budgets, goals });
  sortLists();
}

async function ensureDefaults() {
  if (!state.accounts.length) { state.accounts.push({ ...DEFAULT_ACCOUNT }); await db.put('accounts', DEFAULT_ACCOUNT); }
  if (!state.categories.length) { state.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c })); await db.putMany('categories', state.categories); }
}

/** Open storage, load data, seed demo on first run, and post any recurring transactions that came due. */
export async function init() {
  try {
    await db.open();
  } catch (e) {
    db.useMemory();
    status.persistent = false;
    status.error = e.message;
  }
  await loadAll();
  await ensureDefaults();
  if (!settings.seeded && !state.transactions.length) await seedDemo({ silent: true });
  settings.seeded = true;
  setSettings({ seeded: true });
  const posted = await processRecurring();
  emit();
  return { posted };
}

/* ---------- Transactions ---------- */

export async function saveTransaction(value, id = null) {
  let rec;
  if (id) {
    const old = byId(state.transactions, id);
    if (!old) throw new Error('Transaction not found');
    rec = { ...old, ...value, id };
    delete rec.demo; // an edited sample entry now belongs to the user
  } else {
    rec = { ...value, id: uid() };
  }
  await db.put('transactions', rec);
  upsert(state.transactions, rec);
  emit();
  return rec;
}

export async function deleteTransaction(id) {
  const t = byId(state.transactions, id);
  if (!t) return null;
  await db.remove('transactions', id);
  state.transactions = state.transactions.filter((x) => x.id !== id);
  emit();
  return t;
}

export async function restoreTransaction(t) {
  await db.put('transactions', t);
  upsert(state.transactions, t);
  emit();
}

/* ---------- Recurring ---------- */

export function nextOccurrence(rule, fromISO) {
  if (rule.frequency === 'weekly') return addDays(fromISO, 7);
  if (rule.frequency === 'yearly') return addMonths(fromISO, 12, rule.anchorDay);
  return addMonths(fromISO, 1, rule.anchorDay);
}

/** Create a repeating rule from a just-saved transaction. Returns null if nothing is left to repeat. */
export async function createRecurring(txn, frequency, endDate = null) {
  const rule = {
    id: uid(), type: txn.type, amount: txn.amount, categoryId: txn.categoryId, accountId: txn.accountId,
    toAccountId: txn.toAccountId || null, note: txn.note || '', tags: txn.tags || [], frequency, anchorDay: +txn.date.slice(8, 10),
    nextDate: txn.date, endDate: endDate || null, active: true,
  };
  rule.nextDate = nextOccurrence(rule, txn.date);
  if (rule.endDate && rule.nextDate > rule.endDate) return null;
  await db.put('recurring', rule);
  state.recurring.push(rule);
  emit();
  return rule;
}

export async function setRecurringActive(id, active) {
  const r = byId(state.recurring, id);
  if (!r) return;
  const next = { ...r, active };
  await db.put('recurring', next);
  upsert(state.recurring, next);
  emit();
}

export async function deleteRecurring(id) {
  await db.remove('recurring', id);
  state.recurring = state.recurring.filter((r) => r.id !== id);
  emit();
}

/** Post every occurrence that has come due (up to today). Safe to call repeatedly. */
export async function processRecurring(now = today()) {
  const newTxns = [];
  const updated = [];
  for (const r of state.recurring) {
    if (!r.active) continue;
    const refsOk = accById(r.accountId) && (r.type === 'transfer' ? accById(r.toAccountId) : catById(r.categoryId));
    let next = r.nextDate, guard = 0;
    while (next <= now && (!r.endDate || next <= r.endDate) && guard++ < 400) {
      if (refsOk) {
        newTxns.push({ id: uid(), type: r.type, amount: r.amount, date: next, categoryId: r.categoryId, accountId: r.accountId, toAccountId: r.toAccountId || null, note: r.note, tags: r.tags || [], recurringId: r.id, ...(r.demo ? { demo: true } : {}) });
      }
      next = nextOccurrence(r, next);
    }
    const ended = !!r.endDate && next > r.endDate;
    if (next !== r.nextDate || (ended && r.active)) updated.push({ ...r, nextDate: next, active: !ended });
  }
  if (newTxns.length) { await db.putMany('transactions', newTxns); state.transactions.push(...newTxns); }
  if (updated.length) { await db.putMany('recurring', updated); updated.forEach((u) => upsert(state.recurring, u)); }
  if (newTxns.length || updated.length) emit();
  return newTxns.length;
}

/* ---------- Categories ---------- */

export async function saveCategory(value, id = null) {
  const old = id ? byId(state.categories, id) : null;
  if (id && !old) throw new Error('Category not found');
  const rec = id ? { ...old, ...value, id } : { ...value, id: uid(), sort: nextSort() };
  if (id) rec.type = old.type; // type is fixed once created
  if (!rec.parentId) delete rec.parentId;
  if (rec.parentId && (old?.fallback || rec.fallback)) throw new Error('"Others" must stay a top-level category');
  await db.put('categories', rec);
  upsert(state.categories, rec);
  // Subcategories follow their parent's color.
  if (!rec.parentId) {
    const kids = state.categories.filter((c) => c.parentId === rec.id && c.color !== rec.color).map((c) => ({ ...c, color: rec.color }));
    if (kids.length) { await db.putMany('categories', kids); kids.forEach((k) => upsert(state.categories, k)); }
  }
  emit();
  return rec;
}

/** Delete a category and its subcategories, moving every transaction/rule to `moveToId`; their budgets are removed. */
export async function deleteCategory(id, moveToId) {
  const cat = catById(id);
  if (!cat) return;
  if (cat.fallback) throw new Error('The "Others" category cannot be deleted');
  const doomed = new Set([id, ...childrenOf(id).map((c) => c.id)]);
  const target = catById(moveToId);
  if (!target || target.type !== cat.type || doomed.has(moveToId)) throw new Error('Choose a category of the same type to move transactions to');
  const moved = state.transactions.filter((t) => doomed.has(t.categoryId)).map((t) => ({ ...t, categoryId: moveToId }));
  const rules = state.recurring.filter((r) => doomed.has(r.categoryId)).map((r) => ({ ...r, categoryId: moveToId }));
  const dropBudgets = state.budgets.filter((b) => doomed.has(b.categoryId)).map((b) => b.id);
  await db.putMany('transactions', moved);
  await db.putMany('recurring', rules);
  await db.removeMany('budgets', dropBudgets);
  await db.removeMany('categories', [...doomed]);
  moved.forEach((m) => upsert(state.transactions, m));
  rules.forEach((m) => upsert(state.recurring, m));
  state.budgets = state.budgets.filter((b) => !doomed.has(b.categoryId));
  state.categories = state.categories.filter((c) => !doomed.has(c.id));
  emit();
}

/**
 * Merge `sourceId` into `targetId`: its transactions and rules move over and the source disappears.
 * Its subcategories join the target's family (one level only). The source's own budget is removed.
 */
export async function mergeCategories(sourceId, targetId) {
  const src = catById(sourceId), tgt = catById(targetId);
  if (!src || !tgt || src.id === tgt.id) throw new Error('Choose two different categories');
  if (src.type !== tgt.type) throw new Error('You can only merge categories of the same type');
  if (src.fallback) throw new Error('The "Others" category cannot be merged away');
  if (tgt.parentId === src.id) throw new Error('Merge the subcategory into its parent instead');
  const heir = tgt.parentId ? catById(tgt.parentId) : tgt;
  const kids = childrenOf(src.id).map((k) => ({ ...k, parentId: heir.id, color: heir.color }));
  const moved = state.transactions.filter((t) => t.categoryId === src.id).map((t) => ({ ...t, categoryId: tgt.id }));
  const rules = state.recurring.filter((r) => r.categoryId === src.id).map((r) => ({ ...r, categoryId: tgt.id }));
  const dropBudgets = state.budgets.filter((b) => b.categoryId === src.id).map((b) => b.id);
  await db.putMany('categories', kids);
  await db.putMany('transactions', moved);
  await db.putMany('recurring', rules);
  await db.removeMany('budgets', dropBudgets);
  await db.remove('categories', src.id);
  kids.forEach((k) => upsert(state.categories, k));
  moved.forEach((m) => upsert(state.transactions, m));
  rules.forEach((m) => upsert(state.recurring, m));
  state.budgets = state.budgets.filter((b) => b.categoryId !== src.id);
  state.categories = state.categories.filter((c) => c.id !== src.id);
  emit();
  return { moved: moved.length, subcategories: kids.length };
}

export const categoryUsage = (id, { family = false } = {}) => {
  const ids = family ? new Set([id, ...childrenOf(id).map((c) => c.id)]) : new Set([id]);
  return state.transactions.filter((t) => ids.has(t.categoryId)).length;
};

/* ---------- Accounts ---------- */

export async function saveAccount(value, id = null) {
  const rec = id ? { ...byId(state.accounts, id), ...value, id } : { ...value, id: uid(), sort: nextSort() };
  if (id) delete rec.demo;
  await db.put('accounts', rec);
  upsert(state.accounts, rec);
  emit();
  return rec;
}

export const accountUsage = (id) => state.transactions.filter((t) => t.accountId === id || t.toAccountId === id).length;

/** Delete an account, moving its transactions to `moveToId`. Transfers that would become self-transfers are dropped. */
export async function deleteAccount(id, moveToId) {
  if (state.accounts.length <= 1) throw new Error('You need at least one account');
  const target = accById(moveToId);
  if (!target || moveToId === id) throw new Error('Choose another account to move transactions to');
  const affected = state.transactions.filter((t) => t.accountId === id || t.toAccountId === id);
  const moved = [], dropped = [];
  for (const t of affected) {
    const n = { ...t, accountId: t.accountId === id ? moveToId : t.accountId, toAccountId: t.toAccountId === id ? moveToId : t.toAccountId };
    if (n.type === 'transfer' && n.accountId === n.toAccountId) dropped.push(t.id); else moved.push(n);
  }
  const rules = state.recurring.filter((r) => r.accountId === id || r.toAccountId === id);
  const ruleMoved = [], ruleDropped = [];
  for (const r of rules) {
    const n = { ...r, accountId: r.accountId === id ? moveToId : r.accountId, toAccountId: r.toAccountId === id ? moveToId : r.toAccountId };
    if (n.type === 'transfer' && n.accountId === n.toAccountId) ruleDropped.push(r.id); else ruleMoved.push(n);
  }
  await db.putMany('transactions', moved);
  await db.removeMany('transactions', dropped);
  await db.putMany('recurring', ruleMoved);
  await db.removeMany('recurring', ruleDropped);
  await db.remove('accounts', id);
  moved.forEach((m) => upsert(state.transactions, m));
  state.transactions = state.transactions.filter((t) => !dropped.includes(t.id));
  ruleMoved.forEach((m) => upsert(state.recurring, m));
  state.recurring = state.recurring.filter((r) => !ruleDropped.includes(r.id));
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (!state.accounts.some((a) => a.isDefault)) {
    const first = { ...state.accounts[0], isDefault: true };
    await db.put('accounts', first);
    upsert(state.accounts, first);
  }
  emit();
}

/* ---------- Budgets ---------- */

export async function saveBudget(value, id = null) {
  const rec = id ? { ...byId(state.budgets, id), ...value, id } : { ...value, id: uid() };
  if (id) delete rec.demo;
  await db.put('budgets', rec);
  upsert(state.budgets, rec);
  emit();
}
export async function deleteBudget(id) {
  await db.remove('budgets', id);
  state.budgets = state.budgets.filter((b) => b.id !== id);
  emit();
}

/* ---------- Goals ---------- */

export async function saveGoal(value, id = null) {
  let rec;
  if (id) { rec = { ...byId(state.goals, id), ...value, id }; delete rec.demo; }
  else rec = { ...value, id: uid(), entries: [] };
  await db.put('goals', rec);
  upsert(state.goals, rec);
  emit();
}
export async function deleteGoal(id) {
  await db.remove('goals', id);
  state.goals = state.goals.filter((g) => g.id !== id);
  emit();
}
export async function addGoalEntry(goalId, entry) {
  const g = byId(state.goals, goalId);
  if (!g) throw new Error('Goal not found');
  const next = { ...g, entries: [...g.entries, { id: uid(), ...entry }] };
  delete next.demo;
  await db.put('goals', next);
  upsert(state.goals, next);
  emit();
}

/* ---------- Import / backup / demo / clear ---------- */

/** `result` comes from csv.rowsToTransactions (already validated). Temporary ids are swapped for real ones. */
export async function importTransactions(result) {
  const catMap = new Map(), accMap = new Map();
  result.newCategories.forEach((c) => catMap.set(c.id, uid()));
  const newCats = result.newCategories.map((c) => {
    const rec = { ...c, id: catMap.get(c.id), sort: nextSort() };
    if (c.parentId) rec.parentId = catMap.get(c.parentId) || c.parentId;
    return rec;
  });
  const newAccs = result.newAccounts.map((a) => { const rec = { ...a, id: uid(), sort: nextSort() }; accMap.set(a.id, rec.id); return rec; });
  const txns = result.valid.map((t) => ({
    ...t, id: uid(),
    categoryId: t.categoryId ? catMap.get(t.categoryId) || t.categoryId : null,
    accountId: accMap.get(t.accountId) || t.accountId,
    toAccountId: t.toAccountId ? accMap.get(t.toAccountId) || t.toAccountId : null,
  }));
  await db.putMany('categories', newCats);
  await db.putMany('accounts', newAccs);
  await db.putMany('transactions', txns);
  state.categories.push(...newCats);
  state.accounts.push(...newAccs);
  state.transactions.push(...txns);
  emit();
  return txns.length;
}

export const exportBackup = () => buildBackup(state, settings);

/** `parsed` is the output of backup.parseBackup (already sanitised). Replaces everything. */
export async function restoreBackup(parsed) {
  await db.replaceAll(parsed.data);
  Object.assign(state, parsed.data);
  setSettings({ ...parsed.settings, seeded: true });
}

export async function clearAll() {
  const fresh = { accounts: [{ ...DEFAULT_ACCOUNT }], categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), transactions: [], recurring: [], budgets: [], goals: [] };
  await db.replaceAll(fresh);
  Object.assign(state, fresh);
  setSettings({ seeded: true });
}

export async function seedDemo({ silent = false } = {}) {
  const demo = buildDemo(today());
  const haveCat = new Set(state.categories.map((c) => c.id));
  const demoCats = demo.categories.filter((c) => !haveCat.has(c.id));
  await db.putMany('categories', demoCats);
  await db.putMany('accounts', demo.accounts);
  await db.putMany('transactions', demo.transactions);
  await db.putMany('recurring', demo.recurring);
  await db.putMany('budgets', demo.budgets);
  await db.putMany('goals', demo.goals);
  state.categories.push(...demoCats);
  state.accounts.push(...demo.accounts);
  state.transactions.push(...demo.transactions);
  state.recurring.push(...demo.recurring);
  state.budgets.push(...demo.budgets);
  state.goals.push(...demo.goals);
  if (!silent) emit();
}

/** Remove only sample records. Your own transactions on sample accounts are moved to the default account first. */
export async function removeDemo() {
  const demoAcc = new Set(state.accounts.filter((a) => a.demo).map((a) => a.id));
  const home = state.accounts.find((a) => !a.demo && a.isDefault) || state.accounts.find((a) => !a.demo);
  if (!home) throw new Error('Create a non-sample account first');
  const remap = (id) => (demoAcc.has(id) ? home.id : id);
  const keep = [], drop = [];
  for (const t of state.transactions) {
    if (t.demo) { drop.push(t.id); continue; }
    if (demoAcc.has(t.accountId) || demoAcc.has(t.toAccountId)) {
      const n = { ...t, accountId: remap(t.accountId), toAccountId: t.toAccountId ? remap(t.toAccountId) : null };
      if (n.type === 'transfer' && n.accountId === n.toAccountId) drop.push(t.id); else keep.push(n);
    }
  }
  const ruleKeep = [], ruleDrop = [];
  for (const r of state.recurring) {
    if (r.demo) { ruleDrop.push(r.id); continue; }
    if (demoAcc.has(r.accountId) || demoAcc.has(r.toAccountId)) {
      const n = { ...r, accountId: remap(r.accountId), toAccountId: r.toAccountId ? remap(r.toAccountId) : null };
      if (n.type === 'transfer' && n.accountId === n.toAccountId) ruleDrop.push(r.id); else ruleKeep.push(n);
    }
  }
  await db.putMany('transactions', keep);
  await db.removeMany('transactions', drop);
  await db.putMany('recurring', ruleKeep);
  await db.removeMany('recurring', ruleDrop);
  await db.removeMany('budgets', state.budgets.filter((b) => b.demo).map((b) => b.id));
  await db.removeMany('goals', state.goals.filter((g) => g.demo).map((g) => g.id));
  await db.removeMany('accounts', [...demoAcc]);
  // Sample subcategories go too, unless one of your own transactions uses it (then it stays as yours).
  const stillUsed = new Set([...state.transactions.filter((t) => !drop.includes(t.id)).map((t) => t.categoryId), ...state.recurring.filter((r) => !ruleDrop.includes(r.id)).map((r) => r.categoryId)]);
  const demoCatsAll = state.categories.filter((c) => c.demo);
  const catDrop = demoCatsAll.filter((c) => !stillUsed.has(c.id)).map((c) => c.id);
  const catKeep = demoCatsAll.filter((c) => stillUsed.has(c.id)).map((c) => { const k = { ...c }; delete k.demo; return k; });
  await db.removeMany('categories', catDrop);
  await db.putMany('categories', catKeep);
  catKeep.forEach((k) => upsert(state.categories, k));
  state.categories = state.categories.filter((c) => !catDrop.includes(c.id));
  keep.forEach((k) => upsert(state.transactions, k));
  state.transactions = state.transactions.filter((t) => !drop.includes(t.id));
  ruleKeep.forEach((k) => upsert(state.recurring, k));
  state.recurring = state.recurring.filter((r) => !ruleDrop.includes(r.id));
  state.budgets = state.budgets.filter((b) => !b.demo);
  state.goals = state.goals.filter((g) => !g.demo);
  state.accounts = state.accounts.filter((a) => !demoAcc.has(a.id));
  emit();
}
