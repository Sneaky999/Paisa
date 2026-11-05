// JSON backup: build, and parse + sanitise. Anything that doesn't validate is dropped (and counted) rather than trusted.

import { clean, validDate, normalizeTags, MAX_TAGS } from './utils/validate.js';
import { CURRENCIES } from './utils/money.js';
import { DEFAULT_ACCOUNT, DEFAULT_CATEGORIES } from './defaults.js';
import { STORES } from './db.js';

export const BACKUP_VERSION = 1;
const MAX_MINOR = 1e13;

export function buildBackup(state, settings, now = new Date()) {
  const data = {};
  for (const s of STORES) data[s] = state[s];
  const { theme, currency, monthStart, dateFormat } = settings;
  return { app: 'paisa', version: BACKUP_VERSION, exportedAt: now.toISOString(), settings: { theme, currency, monthStart, dateFormat }, data };
}

const str = (v) => typeof v === 'string';
const safeId = (v) => (str(v) && v.length > 0 && v.length <= 64 ? v : null);
const money = (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_MINOR;
const arr = (v) => (Array.isArray(v) ? v : []);
const HEX = /^#[0-9a-f]{6}$/i;

export function parseBackup(text) {
  let json;
  try { json = JSON.parse(text); } catch { return { ok: false, error: 'This file is not valid JSON.' }; }
  if (!json || typeof json !== 'object' || json.app !== 'paisa') return { ok: false, error: 'This is not a Paisa backup file.' };
  if (!Number.isInteger(json.version) || json.version > BACKUP_VERSION) return { ok: false, error: 'This backup was made by a newer version of Paisa.' };
  const d = json.data && typeof json.data === 'object' ? json.data : {};
  let dropped = 0;
  const ids = new Set();
  const take = (list, fn) => {
    const out = [];
    const local = new Set();
    for (const raw of arr(list)) {
      const rec = raw && typeof raw === 'object' ? fn(raw) : null;
      if (rec && !local.has(rec.id)) { local.add(rec.id); out.push(rec); } else dropped++;
    }
    return out;
  };
  const flag = (raw, rec) => { if (raw.demo === true) rec.demo = true; return rec; };

  const accounts = take(d.accounts, (r) => {
    const id = safeId(r.id), name = clean(r.name, 30);
    if (!id || !name || !money(r.opening ?? 0)) return null;
    const rec = { id, name, type: ['cash', 'bank', 'wallet', 'other'].includes(r.type) ? r.type : 'other', opening: r.opening ?? 0 };
    if (r.isDefault === true) rec.isDefault = true;
    if (Number.isFinite(r.sort)) rec.sort = r.sort;
    return flag(r, rec);
  });
  const categories = take(d.categories, (r) => {
    const id = safeId(r.id), name = clean(r.name, 30);
    if (!id || !name || !['income', 'expense'].includes(r.type)) return null;
    const rec = { id, name, type: r.type, icon: clean(r.icon, 8) || '📦', color: HEX.test(r.color || '') ? r.color : '#64748b' };
    if (r.fallback === true) rec.fallback = true;
    if (safeId(r.parentId)) rec.parentId = r.parentId;
    if (Number.isFinite(r.sort)) rec.sort = r.sort;
    return flag(r, rec);
  });
  // One level only: keep a parent link only if it points to a top-level category of the same type.
  {
    const top = new Map(categories.filter((c) => !c.parentId).map((c) => [c.id, c]));
    for (const c of categories) {
      if (!c.parentId) continue;
      const p = top.get(c.parentId);
      if (!p || p.type !== c.type || c.fallback) delete c.parentId;
      else c.color = p.color;
    }
  }
  // Guarantee a usable base: at least one account and an "Others" category for each type.
  if (!accounts.length) accounts.push({ ...DEFAULT_ACCOUNT });
  for (const type of ['expense', 'income']) {
    if (!categories.some((c) => c.type === type)) categories.push(...DEFAULT_CATEGORIES.filter((c) => c.type === type));
    else if (!categories.some((c) => c.type === type && c.fallback)) {
      const def = DEFAULT_CATEGORIES.find((c) => c.type === type && c.fallback);
      if (!categories.some((c) => c.id === def.id)) categories.push({ ...def });
    }
  }
  const accIds = new Set(accounts.map((a) => a.id));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const refsOk = (r, type) => {
    if (!accIds.has(r.accountId)) return false;
    if (type === 'transfer') return accIds.has(r.toAccountId) && r.toAccountId !== r.accountId;
    const c = catById.get(r.categoryId);
    return !!c && c.type === type;
  };

  const transactions = take(d.transactions, (r) => {
    const id = safeId(r.id);
    if (!id || !['income', 'expense', 'transfer'].includes(r.type) || !money(r.amount) || r.amount <= 0 || !validDate(r.date) || !refsOk(r, r.type)) return null;
    const rec = {
      id, type: r.type, amount: r.amount, date: r.date, accountId: r.accountId,
      categoryId: r.type === 'transfer' ? null : r.categoryId,
      toAccountId: r.type === 'transfer' ? r.toAccountId : null,
      note: clean(r.note, 200),
    };
    const tags = normalizeTags(r.tags).slice(0, MAX_TAGS);
    if (tags.length) rec.tags = tags;
    if (safeId(r.recurringId)) rec.recurringId = r.recurringId;
    return flag(r, rec);
  });
  const recurring = take(d.recurring, (r) => {
    const id = safeId(r.id);
    if (!id || !['income', 'expense', 'transfer'].includes(r.type) || !money(r.amount) || r.amount <= 0 || !validDate(r.nextDate) || !refsOk(r, r.type)) return null;
    if (!['weekly', 'monthly', 'yearly'].includes(r.frequency)) return null;
    const anchor = Number.isInteger(r.anchorDay) && r.anchorDay >= 1 && r.anchorDay <= 31 ? r.anchorDay : +r.nextDate.slice(8, 10);
    return flag(r, {
      id, type: r.type, amount: r.amount, accountId: r.accountId,
      categoryId: r.type === 'transfer' ? null : r.categoryId,
      toAccountId: r.type === 'transfer' ? r.toAccountId : null,
      note: clean(r.note, 200), tags: normalizeTags(r.tags).slice(0, MAX_TAGS), frequency: r.frequency, anchorDay: anchor, nextDate: r.nextDate,
      endDate: validDate(r.endDate) ? r.endDate : null, active: r.active !== false,
    });
  });
  const budgets = take(d.budgets, (r) => {
    const id = safeId(r.id);
    if (!id || !money(r.limit) || r.limit <= 0) return null;
    const categoryId = r.categoryId ?? null;
    if (categoryId !== null && catById.get(categoryId)?.type !== 'expense') return null;
    return flag(r, { id, categoryId, limit: r.limit });
  });
  const goals = take(d.goals, (r) => {
    const id = safeId(r.id), name = clean(r.name, 40);
    if (!id || !name || !money(r.target) || r.target <= 0 || !money(r.initial ?? 0) || (r.initial ?? 0) < 0) return null;
    const entries = [];
    for (const e of arr(r.entries)) {
      if (e && safeId(e.id) && money(e.amount) && e.amount !== 0 && validDate(e.date)) entries.push({ id: e.id, amount: e.amount, date: e.date, note: clean(e.note, 200) });
      else dropped++;
    }
    return flag(r, { id, name, target: r.target, initial: r.initial ?? 0, deadline: validDate(r.deadline) ? r.deadline : null, entries });
  });

  const s = json.settings && typeof json.settings === 'object' ? json.settings : {};
  const settings = {};
  if (['system', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
  if (str(s.currency) && CURRENCIES[s.currency]) settings.currency = s.currency;
  if (Number.isInteger(s.monthStart) && s.monthStart >= 1 && s.monthStart <= 28) settings.monthStart = s.monthStart;
  if (['dmy', 'mdy', 'iso'].includes(s.dateFormat)) settings.dateFormat = s.dateFormat;

  void ids;
  return { ok: true, data: { accounts, categories, transactions, recurring, budgets, goals }, settings, dropped, exportedAt: str(json.exportedAt) ? json.exportedAt : null };
}
