import { parseAmount } from './money.js';
import { isValidISO } from './dates.js';

export const NOTE_MAX = 200;
export const NAME_MAX = 30;
export const GOAL_NAME_MAX = 40;

/** Strip control characters, collapse whitespace, cap length. Output is always rendered with textContent. */
export const clean = (s, max = 200) =>
  String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const TAG_MAX = 20;
export const MAX_TAGS = 5;

/** "#Work Trip " -> "work-trip". Letters, combining marks (needed for Devanagari etc.), digits, "-" and "_" only. */
export function normalizeTag(raw) {
  return String(raw ?? '').normalize('NFKC').toLowerCase().replace(/^#+/, '').trim()
    .replace(/\s+/g, '-').replace(/[^\p{L}\p{M}\p{N}_-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, TAG_MAX);
}
export function normalizeTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const n = normalizeTag(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export const validDate = (s) => isValidISO(s) && s >= '1970-01-01' && s <= '2100-12-31';

const result = (errors, value) => ({ ok: Object.keys(errors).length === 0, errors, value });

export function validateTransaction(input, { categories, accounts }) {
  const errors = {};
  const v = {};
  v.type = ['income', 'expense', 'transfer'].includes(input.type) ? input.type : null;
  if (!v.type) errors.type = 'Choose a type';

  const a = parseAmount(input.amount);
  if (!a.ok) errors.amount = a.error; else v.amount = a.minor;

  if (!validDate(input.date)) errors.date = 'Enter a valid date'; else v.date = input.date;

  v.accountId = input.accountId;
  if (!accounts.some((x) => x.id === v.accountId)) errors.accountId = v.type === 'transfer' ? 'Choose the source account' : 'Choose an account';

  if (v.type === 'transfer') {
    v.categoryId = null;
    v.toAccountId = input.toAccountId;
    if (!accounts.some((x) => x.id === v.toAccountId)) errors.toAccountId = 'Choose the destination account';
    else if (v.toAccountId === v.accountId) errors.toAccountId = 'Pick a different account';
  } else if (v.type) {
    v.toAccountId = null;
    const cat = categories.find((c) => c.id === input.categoryId);
    if (!cat) errors.categoryId = 'Choose a category';
    else if (cat.type !== v.type) errors.categoryId = 'Category does not match the type';
    v.categoryId = input.categoryId;
  }

  if (String(input.note ?? '').trim().length > NOTE_MAX) errors.note = `Keep notes under ${NOTE_MAX} characters`;
  v.note = clean(input.note, NOTE_MAX);
  const tags = normalizeTags(input.tags);
  if (tags.length > MAX_TAGS) errors.tags = `Use at most ${MAX_TAGS} tags`;
  v.tags = tags.slice(0, MAX_TAGS);
  return result(errors, v);
}

export function validateCategory(input, { categories, editingId = null }) {
  const errors = {};
  const type = input.type === 'income' ? 'income' : input.type === 'expense' ? 'expense' : null;
  if (!type) errors.type = 'Choose a type';
  // One level only: a parent must itself be top-level, of the same type, and a category with children cannot become a child.
  const parentId = input.parentId || null;
  let parent = null;
  if (parentId) {
    parent = categories.find((c) => c.id === parentId) || null;
    if (!parent || parent.parentId) errors.parentId = 'Choose a top-level category as the parent';
    else if (parent.id === editingId) errors.parentId = 'A category cannot be its own parent';
    else if (parent.type !== type) errors.parentId = 'The parent must be the same type';
    else if (editingId && categories.some((c) => c.parentId === editingId)) errors.parentId = 'This category has subcategories, so it has to stay top-level';
  }
  const name = clean(input.name, 100);
  if (!name) errors.name = 'Enter a name';
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer`;
  else if (categories.some((c) => c.id !== editingId && c.type === type && (c.parentId || null) === parentId && c.name.toLowerCase() === name.toLowerCase())) {
    errors.name = parentId ? 'This parent already has a subcategory with this name' : 'You already have a category with this name';
  }
  // Subcategories always take their parent's color.
  const color = parent && !errors.parentId ? parent.color : /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : null;
  if (!color) errors.color = 'Pick a color';
  return result(errors, { name, type, icon: clean(input.icon, 8) || '📦', color, parentId: errors.parentId ? null : parentId });
}

export function validateAccount(input, { accounts, editingId = null }) {
  const errors = {};
  const name = clean(input.name, 100);
  if (!name) errors.name = 'Enter a name';
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer`;
  else if (accounts.some((a) => a.id !== editingId && a.name.toLowerCase() === name.toLowerCase())) errors.name = 'You already have an account with this name';
  const type = ['cash', 'bank', 'wallet', 'other'].includes(input.type) ? input.type : 'other';
  const o = parseAmount(input.opening === '' || input.opening == null ? '0' : input.opening, { allowZero: true, allowNegative: true });
  if (!o.ok) errors.opening = o.error;
  return result(errors, { name, type, opening: o.ok ? o.minor : 0 });
}

export function validateBudget(input, { budgets, categories, editingId = null }) {
  const errors = {};
  const categoryId = input.categoryId || null;
  if (categoryId && !categories.some((c) => c.id === categoryId && c.type === 'expense')) errors.categoryId = 'Choose an expense category';
  else if (budgets.some((b) => b.id !== editingId && (b.categoryId || null) === categoryId)) errors.categoryId = 'A budget for this category already exists';
  const l = parseAmount(input.limit);
  if (!l.ok) errors.limit = l.error;
  return result(errors, { categoryId, limit: l.ok ? l.minor : 0 });
}

export function validateGoal(input, { isNew, todayISO }) {
  const errors = {};
  const name = clean(input.name, 100);
  if (!name) errors.name = 'Give your goal a name';
  else if (name.length > GOAL_NAME_MAX) errors.name = `Use ${GOAL_NAME_MAX} characters or fewer`;
  const t = parseAmount(input.target);
  if (!t.ok) errors.target = t.error;
  const v = { name, target: t.ok ? t.minor : 0, deadline: null };
  if (isNew) {
    const s = parseAmount(input.initial === '' || input.initial == null ? '0' : input.initial, { allowZero: true });
    if (!s.ok) errors.initial = s.error; else v.initial = s.minor;
  }
  if (input.deadline) {
    if (!validDate(input.deadline)) errors.deadline = 'Enter a valid date';
    else if (isNew && input.deadline < todayISO) errors.deadline = 'Choose a date in the future';
    else v.deadline = input.deadline;
  }
  return result(errors, v);
}

export function validateContribution(input, { saved, kind }) {
  const errors = {};
  const a = parseAmount(input.amount);
  if (!a.ok) errors.amount = a.error;
  else if (kind === 'withdraw' && a.minor > saved) errors.amount = 'You cannot withdraw more than you have saved';
  if (!validDate(input.date)) errors.date = 'Enter a valid date';
  return result(errors, {
    amount: a.ok ? (kind === 'withdraw' ? -a.minor : a.minor) : 0,
    date: input.date,
    note: clean(input.note, NOTE_MAX),
  });
}
