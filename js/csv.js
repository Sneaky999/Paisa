// CSV parsing / building plus mapping CSV rows to validated transactions.

import { toPlainDecimal, parseAmount } from './utils/money.js';
import { isValidISO, MONTHS } from './utils/dates.js';
import { clean, validDate, NOTE_MAX, normalizeTags, MAX_TAGS } from './utils/validate.js';

/** RFC-4180-ish parser. Auto-detects comma / semicolon / tab. Returns array of string arrays. */
export function parseCSV(text) {
  let s = String(text ?? '').replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Build CSV text. Cells that could be run as spreadsheet formulas get a leading apostrophe. */
export function toCSV(rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function transactionsToCSV(txns, { categories, accounts }) {
  const cat = new Map(categories.map((c) => [c.id, c]));
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const rows = [['Date', 'Type', 'Amount', 'Category', 'Subcategory', 'Account', 'To Account', 'Note', 'Tags', 'Recurring']];
  for (const t of [...txns].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = t.categoryId ? cat.get(t.categoryId) : null;
    const parent = c?.parentId ? cat.get(c.parentId) : null;
    rows.push([
      t.date, t.type, toPlainDecimal(t.amount),
      parent ? parent.name : c?.name || '', parent ? c.name : '',
      acc.get(t.accountId) || '', t.toAccountId ? acc.get(t.toAccountId) || '' : '',
      t.note || '', (t.tags || []).join(';'), t.recurringId ? 'yes' : '',
    ]);
  }
  return toCSV(rows);
}

const ALIASES = {
  date: ['date', 'transaction date', 'day'],
  type: ['type', 'kind', 'transaction type'],
  amount: ['amount', 'value', 'sum'],
  category: ['category', 'cat'],
  subcategory: ['subcategory', 'sub category', 'sub-category', 'subcat'],
  tags: ['tags', 'tag', 'labels'],
  account: ['account', 'from account', 'wallet'],
  toAccount: ['to account', 'to_account', 'destination'],
  note: ['note', 'notes', 'description', 'memo', 'details'],
};

function mapHeader(row) {
  const idx = {};
  row.forEach((h, i) => {
    const key = String(h).trim().toLowerCase();
    for (const [field, names] of Object.entries(ALIASES)) if (names.includes(key) && idx[field] === undefined) idx[field] = i;
  });
  return idx;
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, D/M/YYYY or M/D/YYYY (per `style`), and "3 Nov 2026". */
export function parseFlexibleDate(raw, style = 'dmy') {
  const s = String(raw ?? '').trim();
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) return fmt(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    return style === 'mdy' ? fmt(+m[3], +m[1], +m[2]) : fmt(+m[3], +m[2], +m[1]);
  }
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(s))) {
    const mo = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()) + 1;
    return mo ? fmt(+m[3], mo, +m[1]) : null;
  }
  return null;
  function fmt(y, mo, d) {
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidISO(iso) && validDate(iso) ? iso : null;
  }
}

const TYPE_WORDS = { income: 'income', credit: 'income', in: 'income', expense: 'expense', debit: 'expense', out: 'expense', transfer: 'transfer' };

/**
 * Turn parsed rows into transactions. Unknown categories/accounts are created (reported in newCategories/newAccounts).
 * Does not mutate anything; returns {valid, errors, newCategories, newAccounts, duplicates}.
 */
export function rowsToTransactions(rows, { categories, accounts, existing = [], dateStyle = 'dmy', skipDuplicates = true, defaultAccountId }) {
  const out = { valid: [], errors: [], newCategories: [], newAccounts: [], duplicates: 0, total: 0 };
  if (!rows.length) { out.errors.push({ line: 1, msg: 'The file is empty' }); return out; }
  const idx = mapHeader(rows[0]);
  if (idx.date === undefined || idx.amount === undefined) {
    out.errors.push({ line: 1, msg: 'Header row needs at least "Date" and "Amount" columns' });
    return out;
  }
  // Existing categories: top-level by "type|name", subcategories by "type|parentId|name".
  const catByKey = new Map(categories.filter((c) => !c.parentId).map((c) => [`${c.type}|${c.name.toLowerCase()}`, c]));
  const subByKey = new Map(categories.filter((c) => c.parentId).map((c) => [`${c.type}|${c.parentId}|${c.name.toLowerCase()}`, c]));
  const newSub = new Map();
  const accByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
  const newCat = new Map(), newAcc = new Map();
  const seen = new Set(existing.map(sig));
  const get = (r, f) => (idx[f] === undefined ? '' : String(r[idx[f]] ?? '').trim());

  function sig(t) { return [t.date, t.type, t.amount, t.categoryId || '', t.accountId, t.note || ''].join('|'); }
  const accountFor = (name) => {
    if (!name) return defaultAccountId;
    const k = name.toLowerCase();
    let a = accByName.get(k) || newAcc.get(k);
    if (!a) { a = { id: `imp-acc-${newAcc.size}-${Math.random().toString(36).slice(2, 8)}`, name: clean(name, 30), type: 'other', opening: 0 }; newAcc.set(k, a); }
    return a.id;
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    out.total++;
    const date = parseFlexibleDate(get(r, 'date'), dateStyle);
    if (!date) { out.errors.push({ line, msg: `Invalid date "${get(r, 'date')}"` }); continue; }
    const rawAmt = get(r, 'amount');
    const a = parseAmount(rawAmt, { allowNegative: true });
    if (!a.ok) { out.errors.push({ line, msg: `${a.error} ("${rawAmt}")` }); continue; }
    let type = TYPE_WORDS[get(r, 'type').toLowerCase()];
    if (!type) {
      if (get(r, 'type')) { out.errors.push({ line, msg: `Unknown type "${get(r, 'type')}"` }); continue; }
      type = a.minor < 0 ? 'expense' : 'income';
    }
    const amount = Math.abs(a.minor);
    if (amount === 0) { out.errors.push({ line, msg: 'Amount must be greater than zero' }); continue; }
    const accountId = accountFor(get(r, 'account'));
    const note = clean(get(r, 'note').replace(/^'(?=[=+\-@])/, ''), NOTE_MAX);
    const t = { type, amount, date, accountId, note, categoryId: null, toAccountId: null };
    if (type === 'transfer') {
      const toName = get(r, 'toAccount');
      if (!toName) { out.errors.push({ line, msg: 'Transfers need a "To Account"' }); continue; }
      t.toAccountId = accountFor(toName);
      if (t.toAccountId === t.accountId) { out.errors.push({ line, msg: 'Transfer accounts must differ' }); continue; }
    } else {
      let catName = get(r, 'category').replace(/›/g, '>');
      let subName = get(r, 'subcategory');
      if (!subName && catName.includes('>')) { const i = catName.indexOf('>'); subName = catName.slice(i + 1); catName = catName.slice(0, i); }
      const cname = clean(catName, 30) || 'Others';
      const sname = clean(subName, 30);
      const key = `${type}|${cname.toLowerCase()}`;
      let c = catByKey.get(key) || newCat.get(key);
      if (!c) {
        c = { id: `imp-cat-${newCat.size}-${Math.random().toString(36).slice(2, 8)}`, name: cname, type, icon: type === 'income' ? '💰' : '📦', color: '#64748b' };
        newCat.set(key, c);
      }
      let target = c;
      if (sname) {
        const skey = `${type}|${c.id}|${sname.toLowerCase()}`;
        target = subByKey.get(skey) || newSub.get(skey);
        if (!target) {
          target = { id: `imp-sub-${newSub.size}-${Math.random().toString(36).slice(2, 8)}`, name: sname, type, icon: c.icon, color: c.color, parentId: c.id };
          newSub.set(skey, target);
        }
      }
      t.categoryId = target.id;
    }
    t.tags = normalizeTags(get(r, 'tags').split(/[;,|]/)).slice(0, MAX_TAGS);
    const s = sig(t);
    if (skipDuplicates && seen.has(s)) { out.duplicates++; continue; }
    seen.add(s);
    out.valid.push(t);
  }
  // Only report categories that imported rows actually use (a new parent counts when one of its new subs is used).
  const used = new Set(out.valid.map((t) => t.categoryId));
  const all = [...newCat.values(), ...newSub.values()];
  for (const c of all) if (used.has(c.id) && c.parentId) used.add(c.parentId);
  out.newCategories = all.filter((c) => used.has(c.id));
  out.newAccounts = [...newAcc.values()].filter((a) => out.valid.some((t) => t.accountId === a.id || t.toAccountId === a.id));
  return out;
}
