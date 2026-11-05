import { h, icon } from '../utils/dom.js';
import { state, fmt, fmtDate, getCategory, getAccount, setRecurringActive, deleteRecurring, categoryLabel, allTags, topCategories, childrenOf } from '../store.js';
import { today, addDays, periodOf } from '../utils/dates.js';
import { settings } from '../store.js';
import * as calc from '../calc.js';
import { pageHeader, emptyState, catBadge, transferBadge, amountEl, btn, selectEl } from '../ui/components.js';
import { openTransactionForm } from '../ui/txForm.js';
import { confirmDialog, toast } from '../ui/overlay.js';

const f = { q: '', type: 'all', categoryId: 'all', tag: 'all', accountId: 'all', range: 'all', from: '', to: '', sort: 'date-desc', tab: 'history', open: false, limit: 50 };

export function filterTransactions(txns, filt, now = today()) {
  const q = filt.q.trim().toLowerCase();
  let start = '0000-01-01', end = '9999-12-31';
  if (filt.range === 'month') { const p = periodOf(now, settings.monthStart); start = p.start; end = p.end; }
  else if (filt.range === '30d') { start = addDays(now, -29); end = now; }
  else if (filt.range === 'year') { start = `${now.slice(0, 4)}-01-01`; end = `${now.slice(0, 4)}-12-31`; }
  else if (filt.range === 'custom') { if (filt.from) start = filt.from; if (filt.to) end = filt.to; }
  // Filtering by a parent category includes its subcategories; filtering by a subcategory is exact.
  const family = filt.categoryId === 'all' ? null : new Set([filt.categoryId, ...state.categories.filter((c) => c.parentId === filt.categoryId).map((c) => c.id)]);
  const out = txns.filter((t) => {
    if (t.date < start || t.date > end) return false;
    if (filt.type !== 'all' && t.type !== filt.type) return false;
    if (family && !family.has(t.categoryId)) return false;
    if (filt.tag && filt.tag !== 'all' && !(t.tags || []).includes(filt.tag)) return false;
    if (filt.accountId !== 'all' && t.accountId !== filt.accountId && t.toAccountId !== filt.accountId) return false;
    if (q) {
      const cat = t.categoryId ? categoryLabel(getCategory(t.categoryId)) : 'transfer';
      const acc = getAccount(t.accountId)?.name || '';
      const hay = `${t.note || ''} ${cat} ${acc} ${t.type} ${(t.tags || []).map((g) => '#' + g).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp = {
    'date-desc': (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    'date-asc': (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    'amount-desc': (a, b) => b.amount - a.amount || b.date.localeCompare(a.date),
    'amount-asc': (a, b) => a.amount - b.amount || b.date.localeCompare(a.date),
  }[filt.sort] || ((a, b) => 0);
  return out.sort(cmp);
}

export function render(root) {
  const rerender = () => root.dispatchEvent(new CustomEvent('paisa:rerender', { bubbles: true }));
  root.append(pageHeader('Transactions', 'Every rupee, in one place', h('button', { class: 'btn btn-primary hide-mobile', type: 'button', onclick: () => openTransactionForm() }, icon('plus', 18), 'Add transaction')));

  root.append(h('div', { class: 'tabs', role: 'tablist' },
    [['history', 'History'], ['recurring', `Recurring${state.recurring.length ? ` (${state.recurring.length})` : ''}`]].map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', class: `tab${f.tab === id ? ' on' : ''}`, 'aria-selected': f.tab === id ? 'true' : 'false', onclick: () => { f.tab = id; rerender(); } }, label))));

  if (f.tab === 'recurring') { renderRecurring(root, rerender); return; }

  // Filter bar. The search box keeps focus by updating the list in place.
  const listHost = h('div', { class: 'list-host' });
  const search = h('input', { class: 'input search-input', type: 'search', placeholder: 'Search transactions', 'aria-label': 'Search transactions', value: f.q, oninput: (e) => { f.q = e.target.value; f.limit = 50; drawList(); } });
  const activeCount = ['type', 'categoryId', 'tag', 'accountId', 'range'].filter((k) => f[k] !== 'all').length;
  const toggle = h('button', { type: 'button', class: `btn${f.open ? ' on' : ''}`, 'aria-expanded': f.open ? 'true' : 'false', onclick: () => { f.open = !f.open; rerender(); } }, icon('filter', 16), 'Filters', activeCount ? h('span', { class: 'badge-count' }, String(activeCount)) : null);
  const sortSel = selectEl([['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['amount-desc', 'Highest amount'], ['amount-asc', 'Lowest amount']], f.sort, { 'aria-label': 'Sort by', onchange: (e) => { f.sort = e.target.value; drawList(); } });
  root.append(h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, icon('search', 18), search), toggle, sortSel));

  if (f.open) {
    const cats = [['all', 'All categories']];
    for (const type of ['expense', 'income']) {
      for (const c of topCategories(type)) {
        cats.push([c.id, `${c.icon} ${c.name}${type === 'income' ? ' (income)' : ''}`]);
        for (const k of childrenOf(c.id)) cats.push([k.id, `\u00A0\u00A0↳ ${k.name}`]);
      }
    }
    const tags = allTags();
    if (f.tag !== 'all' && !tags.includes(f.tag)) f.tag = 'all';
    const panel = h('div', { class: 'filter-panel card' },
      lab('Type', selectEl([['all', 'All types'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers']], f.type, { onchange: (e) => { f.type = e.target.value; f.limit = 50; rerender(); } })),
      lab('Category', selectEl(cats, f.categoryId, { onchange: (e) => { f.categoryId = e.target.value; f.limit = 50; rerender(); } })),
      tags.length ? lab('Tag', selectEl([['all', 'All tags'], ...tags.map((g) => [g, `#${g}`])], f.tag, { onchange: (e) => { f.tag = e.target.value; f.limit = 50; rerender(); } })) : null,
      lab('Account', selectEl([['all', 'All accounts'], ...state.accounts.map((a) => [a.id, a.name])], f.accountId, { onchange: (e) => { f.accountId = e.target.value; f.limit = 50; rerender(); } })),
      lab('Date', selectEl([['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days'], ['year', 'This year'], ['custom', 'Custom range']], f.range, { onchange: (e) => { f.range = e.target.value; f.limit = 50; rerender(); } })));
    if (f.range === 'custom') {
      panel.append(lab('From', h('input', { class: 'input', type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; rerender(); } })), lab('To', h('input', { class: 'input', type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; rerender(); } })));
    }
    panel.append(btn('Reset filters', { onClick: () => { Object.assign(f, { type: 'all', categoryId: 'all', tag: 'all', accountId: 'all', range: 'all', from: '', to: '', q: '', limit: 50 }); rerender(); } }));
    root.append(panel);
  }
  root.append(listHost);

  function drawList() {
    const rows = filterTransactions(state.transactions, f);
    const t = calc.totals(rows);
    listHost.replaceChildren();
    if (!state.transactions.length) {
      listHost.append(h('div', { class: 'card' }, emptyState({ glyph: 'list', title: 'No transactions yet', text: 'Add one to get started, or import a CSV from Settings.', action: btn('Add transaction', { variant: 'primary', glyph: 'plus', onClick: () => openTransactionForm() }) })));
      return;
    }
    if (!rows.length) {
      listHost.append(h('div', { class: 'card' }, emptyState({ glyph: 'search', title: 'Nothing matches', text: 'Try different words or clear some filters.', action: btn('Clear filters', { onClick: () => { Object.assign(f, { type: 'all', categoryId: 'all', tag: 'all', accountId: 'all', range: 'all', from: '', to: '', q: '', limit: 50 }); rerender(); } }) })));
      return;
    }
    listHost.append(h('p', { class: 'muted small result-sum', 'aria-live': 'polite' },
      `${rows.length} transaction${rows.length === 1 ? '' : 's'} · `, h('span', { class: 'amt-income' }, `${fmt(t.income)} in`), ' · ', h('span', { class: 'amt-expense' }, `${fmt(t.expense)} out`)));
    const shown = rows.slice(0, f.limit);
    const groups = new Map();
    for (const tx of shown) { if (!groups.has(tx.date)) groups.set(tx.date, []); groups.get(tx.date).push(tx); }
    const byDate = f.sort.startsWith('date');
    const card = h('div', { class: 'card flush' });
    if (byDate) {
      for (const [date, list] of groups) {
        const day = calc.totals(list);
        card.append(h('div', { class: 'day-head' }, h('span', null, dayLabel(date)), h('span', { class: 'muted small num' }, day.net === 0 ? '' : fmt(day.net, { sign: true }))), h('ul', { class: 'tx-list' }, list.map(row)));
      }
    } else card.append(h('ul', { class: 'tx-list' }, shown.map(row)));
    listHost.append(card);
    if (rows.length > shown.length) listHost.append(h('div', { class: 'more' }, btn(`Show more (${rows.length - shown.length} left)`, { onClick: () => { f.limit += 50; drawList(); } })));
  }
  drawList();
}

const lab = (text, control) => h('label', { class: 'mini-field' }, text, control);

function dayLabel(iso) {
  const now = today();
  if (iso === now) return `Today · ${fmtDate(iso)}`;
  if (iso === addDays(now, -1)) return `Yesterday · ${fmtDate(iso)}`;
  return fmtDate(iso);
}

export function row(t) {
  const cat = t.categoryId ? getCategory(t.categoryId) : null;
  const isT = t.type === 'transfer';
  const sub = isT ? `${getAccount(t.accountId)?.name || '?'} → ${getAccount(t.toAccountId)?.name || '?'}` : getAccount(t.accountId)?.name || '';
  return h('li', null, h('button', { class: 'tx-row', type: 'button', onclick: () => openTransactionForm(t), 'aria-label': `Edit ${isT ? 'transfer' : categoryLabel(cat)} ${fmt(t.amount)}` },
    isT ? transferBadge() : catBadge(cat),
    h('span', { class: 'tx-main' },
      h('span', { class: 'tx-title' }, isT ? 'Transfer' : categoryLabel(cat), t.note ? h('span', { class: 'tx-note' }, ` · ${t.note}`) : null, t.recurringId ? h('span', { class: 'tx-rec', title: 'Recurring' }, icon('repeat', 12)) : null),
      h('span', { class: 'muted small tx-sub' }, sub, ...(t.tags || []).map((g) => h('span', { class: 'tag' }, `#${g}`)))),
    amountEl(t)));
}

function renderRecurring(root, rerender) {
  const rules = [...state.recurring].sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  if (!rules.length) {
    root.append(h('div', { class: 'card' }, emptyState({ glyph: 'repeat', title: 'No recurring transactions', text: 'Choose “Repeat” when adding a transaction (rent, salary, subscriptions) and it will be posted automatically.', action: btn('Add a recurring transaction', { variant: 'primary', glyph: 'plus', onClick: () => openTransactionForm() }) })));
    return;
  }
  const freq = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };
  root.append(h('div', { class: 'card flush' }, h('ul', { class: 'tx-list' }, rules.map((r) => {
    const cat = r.categoryId ? getCategory(r.categoryId) : null;
    return h('li', { class: `rec-row${r.active ? '' : ' paused'}` },
      r.type === 'transfer' ? transferBadge() : catBadge(cat),
      h('span', { class: 'tx-main' },
        h('span', { class: 'tx-title' }, r.type === 'transfer' ? 'Transfer' : categoryLabel(cat), r.note ? h('span', { class: 'tx-note' }, ` · ${r.note}`) : null),
        h('span', { class: 'muted small' }, `${freq[r.frequency]} · ${r.active ? `next ${fmtDate(r.nextDate)}` : 'paused'}${r.endDate ? ` · until ${fmtDate(r.endDate)}` : ''}`)),
      amountEl(r),
      h('span', { class: 'row-actions' },
        h('button', { class: 'icon-btn', type: 'button', title: r.active ? 'Pause' : 'Resume', 'aria-label': r.active ? 'Pause' : 'Resume', onclick: async () => { await setRecurringActive(r.id, !r.active); toast(r.active ? 'Paused' : 'Resumed'); } }, icon(r.active ? 'pause' : 'play', 16)),
        h('button', { class: 'icon-btn', type: 'button', title: 'Delete rule', 'aria-label': 'Delete recurring rule', onclick: async () => {
          const ok = await confirmDialog({ title: 'Delete this recurring rule?', message: 'Past transactions stay. No new ones will be created.', confirmLabel: 'Delete rule' });
          if (ok) { await deleteRecurring(r.id); toast('Rule deleted'); }
        } }, icon('trash', 16))));
  }))));
}
