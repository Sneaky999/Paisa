import { h, icon, download, readFileText } from '../utils/dom.js';
import * as store from '../store.js';
import { state, settings, setSettings, fmt, status } from '../store.js';
import { CURRENCIES, toInputString } from '../utils/money.js';
import { today } from '../utils/dates.js';
import { validateAccount } from '../utils/validate.js';
import { ACCOUNT_TYPES } from '../defaults.js';
import { parseCSV, transactionsToCSV, rowsToTransactions } from '../csv.js';
import { parseBackup } from '../backup.js';
import * as calc from '../calc.js';
import { pageHeader, btn, field, showErrors, clearFieldError, selectEl, seg, catBadge, iconBtn } from '../ui/components.js';
import { openModal, confirmDialog, toast } from '../ui/overlay.js';
import { openCategoryDialog } from '../ui/categoryForm.js';

/* ---------- Accounts ---------- */

function openAccountForm(existing = null) {
  const s = { name: existing?.name || '', type: existing?.type || 'bank', opening: existing ? toInputString(existing.opening) : '' };
  const root = h('form', { class: 'form', novalidate: true });
  root.append(
    field({ label: 'Account name', name: 'name', control: h('input', { class: 'input', id: 'a-name', type: 'text', placeholder: 'e.g. Global IME Bank', value: s.name, autofocus: true, oninput: (e) => { s.name = e.target.value; clearFieldError(root, 'name'); } }) }),
    field({ label: 'Type', name: 'type', control: selectEl(Object.entries(ACCOUNT_TYPES).map(([k, v]) => [k, `${v.icon} ${v.label}`]), s.type, { id: 'a-type', onchange: (e) => { s.type = e.target.value; } }) }),
    field({ label: 'Opening balance', name: 'opening', optional: true, hint: 'What the account held before your first transaction here. Can be negative for a credit card.', control: h('input', { class: 'input', id: 'a-open', type: 'text', inputmode: 'decimal', placeholder: '0.00', value: s.opening, oninput: (e) => { s.opening = e.target.value; clearFieldError(root, 'opening'); } }) }));
  async function submit() {
    const v = validateAccount(s, { accounts: state.accounts, editingId: existing?.id });
    if (!v.ok) { showErrors(root, v.errors); return; }
    try { await store.saveAccount(v.value, existing?.id || null); m.close(); toast(existing ? 'Account updated' : 'Account added'); } catch (e) { toast(`Could not save: ${e.message}`, { type: 'error' }); }
  }
  root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const m = openModal({ title: existing ? 'Edit account' : 'New account', content: root, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, existing ? 'Save' : 'Add account')] });
}

async function removeAccount(a) {
  if (state.accounts.length <= 1) { toast('You need at least one account.', { type: 'error' }); return; }
  const used = store.accountUsage(a.id);
  const others = state.accounts.filter((x) => x.id !== a.id);
  let target = (others.find((x) => x.isDefault) || others[0]).id;
  const extra = used ? h('label', { class: 'mini-field' }, `Move its ${used} transaction${used === 1 ? '' : 's'} to`, selectEl(others.map((x) => [x.id, x.name]), target, { onchange: (e) => { target = e.target.value; } })) : null;
  const ok = await confirmDialog({ title: `Delete “${a.name}”?`, message: used ? 'Its transactions will be moved so your totals stay correct. Transfers that would end up between the same account are removed.' : 'This account has no transactions.', confirmLabel: 'Delete account', extra });
  if (!ok) return;
  try { await store.deleteAccount(a.id, target); toast('Account deleted'); } catch (e) { toast(e.message, { type: 'error' }); }
}

/* ---------- Categories ---------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const familyOf = (c) => new Set([c.id, ...store.childrenOf(c.id).map((k) => k.id)]);

async function removeCategory(c) {
  if (c.fallback) return;
  const kids = store.childrenOf(c.id);
  const doomed = familyOf(c);
  const used = store.categoryUsage(c.id, { family: true });
  const targets = state.categories.filter((x) => x.type === c.type && !doomed.has(x.id));
  let target = (targets.find((x) => x.fallback) || targets[0]).id;
  const hasBudget = state.budgets.some((b) => doomed.has(b.categoryId));
  const extra = h('div', null,
    used ? h('label', { class: 'mini-field' }, `Move its ${plural(used, 'transaction', 'transactions')} to`, selectEl(targets.map((x) => [x.id, `${x.icon} ${store.categoryLabel(x)}`]), target, { onchange: (e) => { target = e.target.value; } })) : null,
    hasBudget ? h('p', { class: 'hint' }, 'Budgets on these categories will also be removed.') : null);
  const message = kids.length
    ? `This also deletes its ${plural(kids.length, 'subcategory', 'subcategories')} (${kids.map((k) => k.name).join(', ')}). ${used ? 'Choose where their transactions should go so nothing is lost.' : 'None of them have transactions.'}`
    : used ? 'Choose where its transactions should go so nothing is lost.' : 'This category has no transactions.';
  const ok = await confirmDialog({ title: `Delete “${c.name}”?`, message, confirmLabel: 'Delete category', extra });
  if (!ok) return;
  try { await store.deleteCategory(c.id, target); toast('Category deleted'); } catch (e) { toast(e.message, { type: 'error' }); }
}

async function mergeCategory(c) {
  const kids = store.childrenOf(c.id);
  const kidIds = new Set(kids.map((k) => k.id));
  const targets = state.categories.filter((x) => x.type === c.type && x.id !== c.id && !kidIds.has(x.id));
  if (!targets.length) { toast('There is no other category to merge into.', { type: 'info' }); return; }
  let target = targets[0].id;
  const used = store.categoryUsage(c.id);
  const extra = h('label', { class: 'mini-field' }, 'Merge into', selectEl(targets.map((x) => [x.id, `${x.icon} ${store.categoryLabel(x)}`]), target, { onchange: (e) => { target = e.target.value; } }));
  const message = `Its ${plural(used, 'transaction', 'transactions')} will move to the category you pick, and “${c.name}” will be removed.${kids.length ? ` Its ${plural(kids.length, 'subcategory', 'subcategories')} will move too.` : ''} A budget set on “${c.name}” itself is removed.`;
  const ok = await confirmDialog({ title: `Merge “${c.name}”?`, message, confirmLabel: 'Merge', danger: false, extra });
  if (!ok) return;
  try { const r = await store.mergeCategories(c.id, target); toast(`Merged. ${plural(r.moved, 'transaction', 'transactions')} moved.`); } catch (e) { toast(e.message, { type: 'error' }); }
}

function categoryRow(c, isSub) {
  const blank = () => h('span', { class: 'icon-btn placeholder', 'aria-hidden': 'true' });
  return h('li', { class: isSub ? 'sub' : '' },
    isSub ? h('span', { class: 'sub-branch', 'aria-hidden': 'true' }, '↳') : null,
    catBadge(c, 'sm'),
    h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, c.name, c.demo ? h('span', { class: 'pill pill-sample' }, 'Sample') : null)),
    h('span', { class: 'muted small' }, plural(store.categoryUsage(c.id, { family: !isSub }), 'use', 'uses')),
    h('span', { class: 'row-actions' },
      isSub ? null : iconBtn('plus', `Add subcategory to ${c.name}`, () => openCategoryDialog({ parentId: c.id, lockParent: true, lockType: true })),
      iconBtn('edit', `Edit ${c.name}`, () => openCategoryDialog({ existing: c })),
      c.fallback ? blank() : iconBtn('swap', `Merge ${c.name} into another category`, () => mergeCategory(c)),
      c.fallback ? blank() : iconBtn('trash', `Delete ${c.name}`, () => removeCategory(c))));
}

/* ---------- Data ---------- */

async function importCSV(file) {
  try {
    if (file.size > 10 * 1024 * 1024) { toast('That file is over 10 MB. Split it into smaller files.', { type: 'error' }); return; }
    const rows = parseCSV(await readFileText(file));
    const res = rowsToTransactions(rows, { categories: state.categories, accounts: state.accounts, existing: state.transactions, dateStyle: settings.dateFormat === 'mdy' ? 'mdy' : 'dmy', defaultAccountId: store.defaultAccount().id });
    if (!res.valid.length) {
      const first = res.errors.slice(0, 5).map((e) => `Line ${e.line}: ${e.msg}`).join('\n');
      await confirmDialog({ title: 'Nothing to import', message: res.errors.length ? first : res.duplicates ? `All ${res.duplicates} rows already exist.` : 'No rows found.', confirmLabel: 'OK', danger: false });
      return;
    }
    const lines = [
      `${res.valid.length} transaction${res.valid.length === 1 ? '' : 's'} ready to import.`,
      res.duplicates ? `${res.duplicates} duplicate${res.duplicates === 1 ? '' : 's'} will be skipped.` : '',
      res.newCategories.length ? `New categories: ${res.newCategories.map((c) => c.name).join(', ')}.` : '',
      res.newAccounts.length ? `New accounts: ${res.newAccounts.map((a) => a.name).join(', ')}.` : '',
      res.errors.length ? `${res.errors.length} row${res.errors.length === 1 ? '' : 's'} skipped (invalid).` : '',
    ].filter(Boolean);
    const extra = res.errors.length ? h('ul', { class: 'err-list' }, res.errors.slice(0, 6).map((e) => h('li', null, `Line ${e.line}: ${e.msg}`)), res.errors.length > 6 ? h('li', null, `…and ${res.errors.length - 6} more`) : null) : null;
    const ok = await confirmDialog({ title: 'Import transactions?', message: lines.join(' '), confirmLabel: 'Import', danger: false, extra });
    if (!ok) return;
    const n = await store.importTransactions(res);
    toast(`Imported ${n} transaction${n === 1 ? '' : 's'}`);
  } catch (e) { toast(`Import failed: ${e.message}`, { type: 'error' }); }
}

async function restore(file) {
  try {
    if (file.size > 25 * 1024 * 1024) { toast('That backup is too large.', { type: 'error' }); return; }
    const parsed = parseBackup(await readFileText(file));
    if (!parsed.ok) { toast(parsed.error, { type: 'error' }); return; }
    const d = parsed.data;
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `This will REPLACE everything in Paisa with the backup: ${d.transactions.length} transactions, ${d.accounts.length} accounts, ${d.budgets.length} budgets, ${d.goals.length} goals.${parsed.dropped ? ` ${parsed.dropped} damaged record${parsed.dropped === 1 ? ' was' : 's were'} ignored.` : ''} Your current data will be lost, so export a backup first if unsure.`,
      confirmLabel: 'Replace my data',
    });
    if (!ok) return;
    await store.restoreBackup(parsed);
    toast('Backup restored');
  } catch (e) { toast(`Restore failed: ${e.message}`, { type: 'error' }); }
}

function picker(accept, onFile) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = accept; input.style.display = 'none';
  input.addEventListener('change', () => { const f = input.files?.[0]; input.remove(); if (f) onFile(f); });
  document.body.append(input);
  input.click();
}

async function clearAllData() {
  const ok1 = await confirmDialog({ title: 'Delete ALL data?', message: 'Every transaction, account, budget and goal will be permanently deleted from this device. Export a backup first if you might need it.', confirmLabel: 'Continue' });
  if (!ok1) return;
  const input = h('input', { class: 'input', type: 'text', placeholder: 'Type DELETE', 'aria-label': 'Type DELETE to confirm', autocomplete: 'off' });
  const ok2 = await confirmDialog({ title: 'Are you absolutely sure?', message: 'This cannot be undone.', confirmLabel: 'Delete everything', extra: input });
  if (!ok2) return;
  if (input.value.trim() !== 'DELETE') { toast('Nothing was deleted. You need to type DELETE to confirm.', { type: 'info' }); return; }
  await store.clearAll();
  toast('All data deleted');
}

/* ---------- View ---------- */

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;

const section = (title, desc, ...kids) => h('section', { class: 'card set-section' }, h('div', { class: 'card-head col' }, h('h2', null, title), desc ? h('p', { class: 'muted small' }, desc) : null), ...kids);
const row = (label, hint, control) => h('div', { class: 'set-row' }, h('div', null, h('strong', null, label), hint ? h('p', { class: 'muted small' }, hint) : null), control);

export function render(root) {
  root.append(pageHeader('Settings', 'Make Paisa yours'));

  root.append(section('Preferences', null,
    row('Theme', 'Follows your device by default', seg({ label: 'Theme', value: settings.theme, options: [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], onChange: (v) => setSettings({ theme: v }) })),
    row('Currency', 'Changes how amounts are shown. Existing amounts are not converted.', selectEl(Object.entries(CURRENCIES).map(([k, v]) => [k, `${k} · ${v.name}`]), settings.currency, { 'aria-label': 'Currency', onchange: (e) => setSettings({ currency: e.target.value }) })),
    row('Financial month starts on', 'For example, set 25 if your salary arrives on the 25th.', selectEl(Array.from({ length: 28 }, (_, i) => [String(i + 1), i === 0 ? '1st (calendar month)' : ordinal(i + 1)]), String(settings.monthStart), { 'aria-label': 'Financial month start day', onchange: (e) => setSettings({ monthStart: +e.target.value }) })),
    row('Date format', null, selectEl([['dmy', '03 Nov 2026'], ['mdy', 'Nov 3, 2026'], ['iso', '2026-11-03']], settings.dateFormat, { 'aria-label': 'Date format', onchange: (e) => setSettings({ dateFormat: e.target.value }) }))));

  root.append(section('Accounts', 'Cash, bank accounts and wallets. Transfers between them are not counted as income or expenses.',
    h('ul', { class: 'manage-list' }, state.accounts.map((a) => h('li', null,
      h('span', { class: 'cat-dot cat-md' }, ACCOUNT_TYPES[a.type]?.icon || '👛'),
      h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, a.name, a.isDefault ? h('span', { class: 'pill' }, 'Default') : null, a.demo ? h('span', { class: 'pill pill-sample' }, 'Sample') : null), h('span', { class: 'muted small' }, ACCOUNT_TYPES[a.type]?.label || 'Account')),
      h('span', { class: 'num' }, fmt(calc.accountBalance(a, state.transactions))),
      h('span', { class: 'row-actions' }, iconBtn('edit', `Edit ${a.name}`, () => openAccountForm(a)), iconBtn('trash', `Delete ${a.name}`, () => removeAccount(a)))))),
    btn('Add account', { glyph: 'plus', onClick: () => openAccountForm() })));

  const catBlock = (type, title) => h('div', { class: 'cat-block' }, h('h3', null, title),
    h('ul', { class: 'manage-list compact' }, store.topCategories(type).flatMap((c) => [categoryRow(c, false), ...store.childrenOf(c.id).map((k) => categoryRow(k, true))])),
    btn(`Add ${type} category`, { glyph: 'plus', onClick: () => openCategoryDialog({ type, lockType: true }) }));
  root.append(section('Categories', 'Group spending your way. Use + on a category to add subcategories (for example Freelance › Web design). Edit a category to move it under another, or merge two into one. “Others” can be renamed but not deleted.', h('div', { class: 'grid-2' }, catBlock('expense', 'Expenses'), catBlock('income', 'Income'))));

  const fileBtn = (label, glyph, accept, fn) => btn(label, { glyph, onClick: () => picker(accept, fn) });
  root.append(section('Your data', 'Everything lives in this browser on this device.',
    row('Export transactions (CSV)', 'Opens in Excel or Google Sheets.', btn('Export CSV', { glyph: 'download', onClick: () => {
      if (!state.transactions.length) { toast('There are no transactions to export yet.', { type: 'info' }); return; }
      download(`paisa-transactions-${today()}.csv`, transactionsToCSV(state.transactions, state), 'text/csv'); toast('CSV exported');
    } })),
    row('Import transactions (CSV)', 'Needs Date and Amount columns. Type, Category, Account and Note are optional. You’ll see a preview first.', fileBtn('Import CSV', 'upload', '.csv,text/csv,text/plain', importCSV)),
    row('Back up everything (JSON)', 'Includes accounts, budgets, goals and settings.', btn('Download backup', { glyph: 'download', onClick: () => { download(`paisa-backup-${today()}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json'); toast('Backup downloaded'); } })),
    row('Restore from backup', 'Replaces all current data.', fileBtn('Restore backup', 'upload', '.json,application/json', restore)),
    store.hasDemo()
      ? row('Sample data', 'Remove the demo transactions, budgets and goals. Your own entries are kept.', btn('Remove sample data', { onClick: async () => { if (await confirmDialog({ title: 'Remove sample data?', message: 'Anything you added yourself is kept.', confirmLabel: 'Remove', danger: false })) { await store.removeDemo(); toast('Sample data removed'); } } }))
      : row('Sample data', 'Load realistic example data to explore the app.', btn('Load sample data', { onClick: async () => { await store.seedDemo(); toast('Sample data loaded'); } })),
    row('Delete all data', 'Permanently erases everything on this device.', h('button', { class: 'btn btn-danger', type: 'button', onclick: clearAllData }, icon('trash', 16), 'Delete all data'))));

  root.append(section('Privacy & storage', null,
    h('div', { class: 'privacy' },
      h('p', null, icon('lock', 16), ' Paisa stores your data only on this device, in your browser. Nothing is sent to a server, and there is no account.'),
      h('p', null, 'Paisa never asks for bank passwords or card numbers, and it is not connected to your bank. Entries are typed in or imported by you.'),
      h('p', null, h('strong', null, 'Limits of local storage: '), 'the data is not encrypted and is not backed up for you. Clearing site data, using a private window, uninstalling the browser or switching phones can erase it, and anyone with access to this unlocked device and browser could see it. Download a backup regularly.'),
      !status.persistent ? h('p', { class: 'warn-text' }, icon('alert', 16), ` Your browser blocked persistent storage (${status.error || 'unknown reason'}). Data will be lost when you close this tab. Export a backup before leaving.`) : null)));
}
