// Pure financial calculations. All money values are integer minor units.
// Transfers never count as income or expense.

import { diffDays } from './utils/dates.js';
import { FALLBACK_COLOR } from './defaults.js';

export const inRange = (t, start, end) => t.date >= start && t.date <= end;
export const within = (txns, start, end) => txns.filter((t) => inRange(t, start, end));

/** Savings rate in percent (1 decimal), or null when there is no income to measure against. */
export function savingsRate(income, expense) {
  if (!(income > 0)) return null;
  return Math.round(((income - expense) / income) * 1000) / 10;
}

export function totals(txns) {
  let income = 0, expense = 0;
  for (const t of txns) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense, net: income - expense, rate: savingsRate(income, expense) };
}

/** Opening + income - expenses, plus transfers in, minus transfers out. */
export function accountBalance(account, txns) {
  let b = account.opening || 0;
  for (const t of txns) {
    if (t.type === 'income' && t.accountId === account.id) b += t.amount;
    else if (t.type === 'expense' && t.accountId === account.id) b -= t.amount;
    else if (t.type === 'transfer') {
      if (t.accountId === account.id) b -= t.amount;
      if (t.toAccountId === account.id) b += t.amount;
    }
  }
  return b;
}

export const totalBalance = (accounts, txns) => accounts.reduce((s, a) => s + accountBalance(a, txns), 0);

/** A category plus its direct subcategories, as a Set of ids. */
export function familyIds(categories, id) {
  const s = new Set([id]);
  for (const c of categories) if (c.parentId === id) s.add(c.id);
  return s;
}

/**
 * Sum per category for one type, biggest first.
 * With `rollup`, subcategory spending is added into its parent and each row carries `children`
 * (a "No subcategory" entry covers amounts booked directly on the parent).
 */
export function categoryBreakdown(txns, type, categories, { rollup = false } = {}) {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const topOf = (id) => {
    if (!rollup) return id;
    const c = catMap.get(id);
    return c?.parentId && catMap.has(c.parentId) ? c.parentId : id;
  };
  const byTop = new Map();
  const kids = new Map();
  let sum = 0;
  for (const t of txns) {
    if (t.type !== type) continue;
    const top = topOf(t.categoryId);
    byTop.set(top, (byTop.get(top) || 0) + t.amount);
    sum += t.amount;
    if (rollup) {
      if (!kids.has(top)) kids.set(top, new Map());
      kids.get(top).set(t.categoryId, (kids.get(top).get(t.categoryId) || 0) + t.amount);
    }
  }
  const look = (id, fallbackName = 'Uncategorized') => {
    const c = catMap.get(id);
    return { name: c?.name || fallbackName, icon: c?.icon || '❔', color: c?.color || FALLBACK_COLOR };
  };
  return [...byTop.entries()]
    .map(([id, amount]) => {
      const row = { id, ...look(id), amount, share: sum ? amount / sum : 0, children: [] };
      const sub = kids.get(id);
      if (sub && [...sub.keys()].some((k) => k !== id)) {
        row.children = [...sub.entries()]
          .map(([cid, a]) => ({ id: cid, ...(cid === id ? { name: 'No subcategory', icon: '•', color: row.color } : look(cid)), amount: a, share: amount ? a / amount : 0 }))
          .sort((a, b) => b.amount - a.amount);
      }
      return row;
    })
    .sort((a, b) => b.amount - a.amount);
}

/** Spending (or income) per tag. A transaction with several tags counts toward each of them. */
export function tagBreakdown(txns, type = 'expense') {
  const m = new Map();
  for (const t of txns) {
    if (t.type !== type) continue;
    for (const tag of t.tags || []) {
      const e = m.get(tag) || { tag, amount: 0, count: 0 };
      e.amount += t.amount;
      e.count += 1;
      m.set(tag, e);
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || a.tag.localeCompare(b.tag));
}

/** One row of totals per bucket ({key,label,short,start,end}). */
export function bucketSeries(txns, buckets) {
  return buckets.map((b) => ({ ...b, ...totals(within(txns, b.start, b.end)) }));
}

/** Percent change from prev to cur, or null if prev is 0. */
export function pctChange(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/* ---------- Budgets ---------- */

/** `family` (from familyIds) lets a parent budget also count its subcategories. */
export function budgetSpent(txns, period, categoryId = null, family = null) {
  const ids = family || (categoryId ? new Set([categoryId]) : null);
  let s = 0;
  for (const t of txns) {
    if (t.type !== 'expense' || !inRange(t, period.start, period.end)) continue;
    if (ids && !ids.has(t.categoryId)) continue;
    s += t.amount;
  }
  return s;
}

/** state: ok (<80%), warn (>=80% up to the limit), over (> limit). */
export function budgetStatus(limit, spent) {
  const pct = limit > 0 ? (spent / limit) * 100 : 0;
  const state = spent > limit ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return { limit, spent, remaining: limit - spent, pct: Math.round(pct * 10) / 10, state };
}

/* ---------- Goals ---------- */

export const goalSaved = (g) => (g.initial || 0) + (g.entries || []).reduce((s, e) => s + e.amount, 0);

export function goalProgress(g) {
  return g.target > 0 ? Math.round((goalSaved(g) / g.target) * 1000) / 10 : 0;
}

/** How much to put aside each month to hit the deadline. */
export function goalPlan(g, todayISO) {
  const saved = goalSaved(g);
  const remaining = Math.max(0, g.target - saved);
  if (remaining === 0) return { status: 'reached', remaining: 0, monthly: 0, monthsLeft: 0 };
  if (!g.deadline) return { status: 'no-deadline', remaining, monthly: null, monthsLeft: null };
  const days = diffDays(todayISO, g.deadline);
  if (days <= 0) return { status: 'overdue', remaining, monthly: remaining, monthsLeft: 0, daysLeft: days };
  const monthsLeft = Math.max(1, Math.ceil(days / 30.4375));
  return { status: 'plan', remaining, monthly: Math.ceil(remaining / monthsLeft), monthsLeft, daysLeft: days };
}
