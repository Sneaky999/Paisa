import { h, icon } from '../utils/dom.js';
import { state, settings, fmt, fmtDate, getCategory, getAccount, hasDemo, removeDemo, categoryLabel } from '../store.js';
import { today, periodOf, shiftPeriod, periodsBetween, MONTHS, diffDays } from '../utils/dates.js';
import * as calc from '../calc.js';
import { pageHeader, emptyState, progressBar, catBadge, transferBadge, amountEl, btn } from '../ui/components.js';
import { incomeExpenseChart, doughnutChart } from '../ui/charts.js';
import { openTransactionForm } from '../ui/txForm.js';
import { toast, confirmDialog } from '../ui/overlay.js';

const PRESETS = [['period', 'This month'], ['last', 'Last month'], ['3m', 'Last 3 months'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom']];
const range = { preset: 'period', from: '', to: '' };

export function resolveRange(r = range, txns = state.transactions, now = today()) {
  const p = periodOf(now, settings.monthStart);
  switch (r.preset) {
    case 'last': { const l = shiftPeriod(p, -1); return { start: l.start, end: l.end }; }
    case '3m': return { start: shiftPeriod(p, -2).start, end: p.end };
    case 'year': return { start: `${now.slice(0, 4)}-01-01`, end: `${now.slice(0, 4)}-12-31` };
    case 'all': {
      if (!txns.length) return { start: p.start, end: p.end };
      const ds = txns.map((t) => t.date).sort();
      return { start: ds[0], end: ds[ds.length - 1] > p.end ? ds[ds.length - 1] : p.end };
    }
    case 'custom':
      if (r.from && r.to && r.from <= r.to) return { start: r.from, end: r.to };
      return { start: p.start, end: p.end };
    default: return { start: p.start, end: p.end };
  }
}

/** Periods to chart for a range: at least 6, at most 12, ending at the range's last period. */
export function chartPeriods(rg) {
  let ps = periodsBetween(rg.start, rg.end, settings.monthStart);
  while (ps.length < 6) ps = [shiftPeriod(ps[0], -1), ...ps];
  ps = ps.slice(-12);
  const multiYear = new Set(ps.map((p) => p.year)).size > 1;
  return ps.map((p) => (multiYear ? { ...p, short: `${p.short} ’${String(p.year).slice(2)}` } : p));
}

export function render(root) {
  const rg = resolveRange();
  const inRange = calc.within(state.transactions, rg.start, rg.end);
  const tot = calc.totals(inRange);
  const balance = calc.totalBalance(state.accounts, state.transactions);
  const now = today();
  const period = periodOf(now, settings.monthStart);

  root.append(pageHeader('Dashboard', 'Your money at a glance', h('button', { class: 'btn btn-primary hide-mobile', type: 'button', onclick: () => openTransactionForm() }, icon('plus', 18), 'Add transaction')));

  if (hasDemo()) {
    root.append(h('div', { class: 'banner' },
      icon('info', 18),
      h('p', null, h('strong', null, 'You’re looking at sample data. '), 'Explore freely, then clear it to start with your own numbers.'),
      btn('Remove sample data', { variant: 'sm', onClick: async () => {
        const ok = await confirmDialog({ title: 'Remove sample data?', message: 'Sample transactions, accounts, budgets and goals will be deleted. Anything you added yourself is kept.', confirmLabel: 'Remove', danger: false });
        if (ok) { await removeDemo(); toast('Sample data removed. Add your first transaction!'); }
      } })));
  }

  // Range filter
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Date range' },
    PRESETS.map(([id, label]) => h('button', {
      type: 'button', class: `chip${range.preset === id ? ' on' : ''}`, 'aria-pressed': range.preset === id ? 'true' : 'false',
      onclick: () => { range.preset = id; if (id === 'custom' && !range.from) { range.from = period.start; range.to = period.end; } rerender(); },
    }, label)));
  const filterRow = h('div', { class: 'filter-row' }, chips);
  if (range.preset === 'custom') {
    const bad = range.from && range.to && range.from > range.to;
    filterRow.append(h('div', { class: 'custom-range' },
      h('label', { class: 'mini-field' }, 'From', h('input', { class: 'input', type: 'date', value: range.from, max: '2100-12-31', onchange: (e) => { range.from = e.target.value; rerender(); } })),
      h('label', { class: 'mini-field' }, 'To', h('input', { class: 'input', type: 'date', value: range.to, max: '2100-12-31', onchange: (e) => { range.to = e.target.value; rerender(); } })),
      bad ? h('p', { class: 'field-error show' }, 'The start date must be before the end date. Showing this month instead.') : null));
  }
  filterRow.append(h('p', { class: 'muted small range-label' }, `${fmtDate(rg.start)} – ${fmtDate(rg.end)}`));
  root.append(filterRow);

  if (!state.transactions.length) {
    root.append(h('div', { class: 'card' }, emptyState({
      glyph: 'wallet', title: 'Start tracking your money',
      text: 'Add your first income or expense and your dashboard will come alive with charts, budgets and insights.',
      action: btn('Add your first transaction', { variant: 'primary', glyph: 'plus', onClick: () => openTransactionForm() }),
    })));
    return;
  }

  // Balance + KPIs
  const accChips = state.accounts.map((a) => h('div', { class: 'acct' }, h('span', { class: 'acct-name' }, a.name), h('span', { class: 'acct-bal num' }, fmt(calc.accountBalance(a, state.transactions)))));
  root.append(h('section', { class: 'hero' },
    h('div', { class: 'card balance-card' },
      h('p', { class: 'eyebrow' }, 'Total balance'),
      h('p', { class: `big num${balance < 0 ? ' neg' : ''}` }, fmt(balance)),
      h('p', { class: 'muted small' }, 'Across all accounts, all time'),
      h('div', { class: 'accts' }, accChips)),
    h('div', { class: 'kpis' },
      kpi('Income', fmt(tot.income, { decimals: false }), 'income', 'trend'),
      kpi('Expenses', fmt(tot.expense, { decimals: false }), 'expense', 'wallet'),
      kpi('Net savings', fmt(tot.net, { sign: true, decimals: false }), tot.net < 0 ? 'expense' : 'accent', 'target', tot.rate === null ? 'No income in this range' : `Savings rate ${tot.rate}%`))));

  root.append(summaryCard(period, now));

  // Charts
  const periods = chartPeriods(rg);
  const series = calc.bucketSeries(state.transactions, periods);
  const breakdown = calc.categoryBreakdown(inRange, 'expense', state.categories, { rollup: true });
  const donutRows = collapse(breakdown);
  root.append(h('section', { class: 'grid-2' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Income vs expenses'), h('span', { class: 'muted small' }, 'Monthly')), incomeExpenseChart(series)),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Where your money goes'), h('span', { class: 'muted small' }, 'Selected range')),
      breakdown.length
        ? h('div', { class: 'donut-wrap' }, doughnutChart(donutRows), legend(donutRows))
        : emptyState({ glyph: 'chart', title: 'No expenses in this range', text: 'Try a wider date range.' }))));

  // Budgets + recent
  root.append(h('section', { class: 'grid-2' }, budgetOverview(period), recentCard()));

  function rerender() { root.dispatchEvent(new CustomEvent('paisa:rerender', { bubbles: true })); }
}

function kpi(label, value, tone, glyph, sub) {
  return h('div', { class: `card kpi kpi-${tone}` },
    h('div', { class: 'kpi-top' }, h('span', { class: 'kpi-icon' }, icon(glyph, 18)), h('span', { class: 'eyebrow' }, label)),
    h('p', { class: 'kpi-val num' }, value),
    sub ? h('p', { class: 'muted small' }, sub) : null);
}

/** Collapse a long category tail into one "Everything else" slice so the donut stays readable. */
export function collapse(rows, keep = 6) {
  if (rows.length <= keep + 1) return rows;
  const head = rows.slice(0, keep);
  const tail = rows.slice(keep);
  const amount = tail.reduce((s, r) => s + r.amount, 0);
  return [...head, { id: 'rest', name: 'Everything else', icon: '…', color: '#94a3b8', amount, share: tail.reduce((s, r) => s + r.share, 0) }];
}

function legend(rows) {
  return h('ul', { class: 'legend' }, rows.map((r) => h('li', null,
    h('span', { class: 'swatch', style: { background: r.color } }),
    h('span', { class: 'legend-name' }, r.name),
    h('span', { class: 'legend-val num' }, fmt(r.amount)),
    h('span', { class: 'legend-pct muted' }, `${Math.round(r.share * 100)}%`))));
}

function summaryCard(period, now) {
  const cur = calc.totals(calc.within(state.transactions, period.start, period.end));
  const prevP = shiftPeriod(period, -1);
  const prev = calc.totals(calc.within(state.transactions, prevP.start, prevP.end));
  const top = calc.categoryBreakdown(calc.within(state.transactions, period.start, period.end), 'expense', state.categories, { rollup: true })[0];
  const daysLeft = Math.max(0, diffDays(now, period.end));
  const elapsed = Math.max(1, diffDays(period.start, now) + 1);
  const chg = calc.pctChange(cur.expense, prev.expense);

  const lines = [];
  if (cur.income === 0 && cur.expense === 0) lines.push('No activity recorded yet this month.');
  else {
    if (cur.rate !== null) lines.push(cur.net >= 0 ? `You’ve kept ${cur.rate}% of your income so far.` : `You’ve spent ${fmt(-cur.net)} more than you earned so far.`);
    if (chg !== null && prev.expense > 0) lines.push(`Spending is ${Math.abs(chg)}% ${chg <= 0 ? 'lower' : 'higher'} than ${prevP.label}.`);
    if (top) lines.push(`Biggest category: ${top.name} (${fmt(top.amount)}).`);
  }
  return h('section', { class: 'card summary' },
    h('div', { class: 'card-head' }, h('h2', null, 'This month’s summary'), h('span', { class: 'muted small' }, period.label)),
    h('div', { class: 'summary-stats' },
      stat('Income', fmt(cur.income)), stat('Spent', fmt(cur.expense)),
      stat('Daily average', fmt(Math.round(cur.expense / elapsed))),
      stat('Days left', String(daysLeft))),
    lines.length ? h('ul', { class: 'insights' }, lines.map((l) => h('li', null, icon('check', 14), l))) : null);
}
const stat = (l, v) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, l), h('strong', { class: 'num' }, v));

function budgetOverview(period) {
  const items = state.budgets
    .map((b) => ({ b, cat: b.categoryId ? getCategory(b.categoryId) : null, st: calc.budgetStatus(b.limit, calc.budgetSpent(state.transactions, period, b.categoryId, b.categoryId ? calc.familyIds(state.categories, b.categoryId) : null)) }))
    .sort((a, z) => (a.b.categoryId ? 1 : 0) - (z.b.categoryId ? 1 : 0) || z.st.pct - a.st.pct);
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Budgets'), h('a', { class: 'link', href: '#/budgets' }, 'Manage')));
  if (!items.length) {
    card.append(emptyState({ glyph: 'budget', title: 'No budgets yet', text: 'Set a monthly limit to see progress and get warnings.', action: h('a', { class: 'btn', href: '#/budgets' }, 'Create a budget') }));
    return card;
  }
  card.append(h('ul', { class: 'budget-mini' }, items.slice(0, 5).map(({ b, cat, st }) => h('li', null,
    h('div', { class: 'row-between' },
      h('span', { class: 'bm-name' }, cat ? `${cat.icon} ${categoryLabel(cat)}` : '🎯 Overall spending'),
      h('span', { class: `small num st-${st.state}` }, st.state === 'over' ? `Over by ${fmt(-st.remaining)}` : `${fmt(st.remaining)} left`)),
    progressBar(st.pct, st.state, `${cat ? cat.name : 'Overall'} budget`)))));
  return card;
}

function recentCard() {
  const recent = [...state.transactions].sort((a, z) => z.date.localeCompare(a.date) || (z.id > a.id ? 1 : -1)).slice(0, 6);
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Recent transactions'), h('a', { class: 'link', href: '#/transactions' }, 'See all')));
  card.append(h('ul', { class: 'tx-list compact' }, recent.map((t) => {
    const cat = t.categoryId ? getCategory(t.categoryId) : null;
    const sub = t.type === 'transfer' ? `${getAccount(t.accountId)?.name || '?'} → ${getAccount(t.toAccountId)?.name || '?'}` : getAccount(t.accountId)?.name || '';
    return h('li', null, h('button', { class: 'tx-row', type: 'button', onclick: () => openTransactionForm(t) },
      t.type === 'transfer' ? transferBadge() : catBadge(cat),
      h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, t.type === 'transfer' ? 'Transfer' : categoryLabel(cat), t.note ? h('span', { class: 'tx-note' }, ` · ${t.note}`) : null), h('span', { class: 'muted small' }, `${fmtDate(t.date)} · ${sub}`)),
      amountEl(t)));
  })));
  return card;
}

export { MONTHS };
