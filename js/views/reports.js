import { h, icon, download } from '../utils/dom.js';
import { state, settings, fmt } from '../store.js';
import { today, periodOf, shiftPeriod, periodsBetween, yearBucket } from '../utils/dates.js';
import { toPlainDecimal } from '../utils/money.js';
import * as calc from '../calc.js';
import { toCSV } from '../csv.js';
import { pageHeader, emptyState, btn, seg, iconBtn, progressBar } from '../ui/components.js';
import { incomeExpenseChart, lineChart, doughnutChart } from '../ui/charts.js';
import { collapse } from './dashboard.js';
import { toast } from '../ui/overlay.js';

const r = { mode: 'month', offset: 0 }; // month: financial month; year: calendar year
const openRows = new Set(); // expanded rows in the category lists, keyed "exp:<id>" / "inc:<id>"

/** One category row; rows that have subcategories expand on tap to show them. */
function breakdownItem(c, { key, rank, barPct, note, rerender }) {
  const kids = c.children || [];
  const isOpen = kids.length > 0 && openRows.has(key);
  const left = h('span', { class: 'br-name' },
    rank ? h('span', { class: 'rank' }, String(rank)) : null, `${c.icon} ${c.name}`,
    kids.length ? h('span', { class: `br-chev${isOpen ? ' open' : ''}`, 'aria-hidden': 'true' }, icon('right', 14)) : null,
    kids.length ? h('span', { class: 'muted small br-count' }, `${kids.length}`) : null);
  const right = h('span', { class: 'num' }, fmt(c.amount));
  const head = kids.length
    ? h('button', { type: 'button', class: 'row-between br-head', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-label': `${c.name}, ${isOpen ? 'hide' : 'show'} ${kids.length} subcategories`, onclick: () => { if (isOpen) openRows.delete(key); else openRows.add(key); rerender(); } }, left, right)
    : h('div', { class: 'row-between br-head' }, left, right);
  return h('li', null,
    head,
    progressBar(barPct, 'accent', c.name),
    h('p', { class: 'muted small' }, note),
    isOpen ? h('ul', { class: 'sub-list' }, kids.map((k) => h('li', { class: 'row-between small' },
      h('span', null, `${k.icon} ${k.name}`),
      h('span', { class: 'num' }, `${fmt(k.amount)} · ${Math.round(k.share * 100)}%`)))) : null);
}

export function buildReport(txns, mode, offset, now = today()) {
  const sd = settings.monthStart;
  let period, buckets, prev;
  if (mode === 'year') {
    const y = +now.slice(0, 4) + offset;
    period = yearBucket(y);
    prev = yearBucket(y - 1);
    buckets = periodsBetween(period.start, period.end, 1).map((p) => ({ ...p, label: `${p.label}` }));
    // Calendar months for the year view, regardless of a custom month start.
    buckets = Array.from({ length: 12 }, (_, i) => periodOf(`${y}-${String(i + 1).padStart(2, '0')}-15`, 1));
  } else {
    period = shiftPeriod(periodOf(now, sd), offset);
    prev = shiftPeriod(period, -1);
    buckets = Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5));
  }
  const cur = calc.within(txns, period.start, period.end);
  const before = calc.within(txns, prev.start, prev.end);
  const tot = calc.totals(cur);
  const ptot = calc.totals(before);
  // Parents include their subcategories; each row carries `children` for the drill-down.
  const exp = calc.categoryBreakdown(cur, 'expense', state.categories, { rollup: true });
  const inc = calc.categoryBreakdown(cur, 'income', state.categories, { rollup: true });
  const pexp = new Map(calc.categoryBreakdown(before, 'expense', state.categories, { rollup: true }).map((c) => [c.id, c.amount]));
  const tags = calc.tagBreakdown(cur, 'expense');
  const series = calc.bucketSeries(txns, buckets);
  return { period, prev, tot, ptot, exp, inc, pexp, tags, series, count: cur.length };
}

export function render(root) {
  const rerender = () => root.dispatchEvent(new CustomEvent('paisa:rerender', { bubbles: true }));
  const rep = buildReport(state.transactions, r.mode, r.offset);
  const { period, prev, tot, ptot } = rep;

  root.append(pageHeader('Reports', 'Understand your money over time',
    btn('Export summary', { glyph: 'download', onClick: () => exportSummary(rep) })));

  root.append(h('div', { class: 'month-nav' },
    iconBtn('left', r.mode === 'year' ? 'Previous year' : 'Previous month', () => { r.offset -= 1; rerender(); }),
    h('div', { class: 'month-label' }, h('strong', null, period.label), r.offset === 0 ? h('span', { class: 'muted small' }, r.mode === 'year' ? 'This year' : 'Current month') : h('button', { class: 'link', type: 'button', onclick: () => { r.offset = 0; rerender(); } }, 'Back to now')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next', disabled: r.offset >= 0, onclick: () => { r.offset += 1; rerender(); } }, icon('right', 18)),
    h('div', { class: 'push-right' }, seg({ label: 'Report period', value: r.mode, options: [['month', 'Monthly'], ['year', 'Yearly']], onChange: (v) => { r.mode = v; r.offset = 0; rerender(); } }))));

  if (!state.transactions.length) {
    root.append(h('div', { class: 'card' }, emptyState({ glyph: 'chart', title: 'Reports need data', text: 'Add a few transactions and your trends will appear here.' })));
    return;
  }

  const delta = (c, p, goodWhenUp) => {
    const pc = calc.pctChange(c, p);
    if (pc === null) return h('span', { class: 'muted small' }, `vs ${prev.short}: n/a`);
    const good = pc === 0 ? null : goodWhenUp ? pc > 0 : pc < 0;
    if (pc === 0) return h('span', { class: 'muted small' }, `No change vs ${prev.label}`);
    return h('span', { class: `small delta ${good ? 'good' : 'bad'}` }, `${pc > 0 ? '▲' : '▼'} ${Math.abs(pc)}% vs ${prev.label}`);
  };
  root.append(h('section', { class: 'kpis four' },
    rk('Income', fmt(tot.income), delta(tot.income, ptot.income, true)),
    rk('Expenses', fmt(tot.expense), delta(tot.expense, ptot.expense, false)),
    rk('Net savings', fmt(tot.net, { sign: true }), delta(tot.net, ptot.net, true)),
    rk('Savings rate', tot.rate === null ? '—' : `${tot.rate}%`, h('span', { class: 'muted small' }, tot.rate === null ? 'No income this period' : ptot.rate === null ? '' : `Previous: ${ptot.rate}%`))));

  const label = r.mode === 'year' ? 'Income and expenses by month' : 'Last 6 months';
  root.append(h('section', { class: 'grid-2' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Income vs expenses'), h('span', { class: 'muted small' }, label)), incomeExpenseChart(rep.series, { showNet: true })),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Savings rate'), h('span', { class: 'muted small' }, 'Share of income kept')), lineChart(rep.series, rep.series.map((s) => s.rate), { label: 'Savings rate' }))));

  const donut = collapse(rep.exp);
  const spendNote = (c) => {
    const p = rep.pexp.get(c.id) || 0;
    const pc = calc.pctChange(c.amount, p);
    return `${Math.round(c.share * 100)}% of spending${pc === null ? (p === 0 ? ' · new this period' : '') : ` · ${pc > 0 ? '▲' : pc < 0 ? '▼' : ''} ${Math.abs(pc)}% vs ${prev.short}`}`;
  };
  const anyKids = rep.exp.some((c) => c.children.length) || rep.inc.some((c) => c.children.length);
  root.append(h('section', { class: 'grid-2' },
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Spending breakdown'), h('span', { class: 'muted small' }, period.label)),
      rep.exp.length ? h('div', { class: 'donut-wrap' }, doughnutChart(donut), h('ul', { class: 'legend' }, donut.map((c) => h('li', null, h('span', { class: 'swatch', style: { background: c.color } }), h('span', { class: 'legend-name' }, c.name), h('span', { class: 'legend-val num' }, fmt(c.amount)), h('span', { class: 'legend-pct muted' }, `${Math.round(c.share * 100)}%`)))))
        : emptyState({ glyph: 'chart', title: 'No spending in this period' })),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Top spending categories'), h('span', { class: 'muted small' }, `vs ${prev.label}`)),
      rep.exp.length ? h('div', null,
        h('ul', { class: 'top-list' }, rep.exp.slice(0, 8).map((c, i) => breakdownItem(c, { key: `exp:${c.id}`, rank: i + 1, barPct: c.share * 100 / (rep.exp[0].share || 1), note: spendNote(c), rerender }))),
        anyKids ? h('p', { class: 'hint drill-hint' }, 'Tap a category with a number to see its subcategories.') : null)
        : emptyState({ glyph: 'list', title: 'Nothing to rank yet' }))));

  const incomeCard = rep.inc.length ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Income sources'), h('span', { class: 'muted small' }, period.label)),
    h('ul', { class: 'top-list' }, rep.inc.map((c) => breakdownItem(c, { key: `inc:${c.id}`, barPct: c.share * 100, note: `${Math.round(c.share * 100)}% of income`, rerender })))) : null;
  const tagCard = rep.tags.length ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Spending by tag'), h('span', { class: 'muted small' }, period.label)),
    h('ul', { class: 'top-list' }, rep.tags.slice(0, 8).map((t) => h('li', null,
      h('div', { class: 'row-between' }, h('span', { class: 'tag tag-lg' }, `#${t.tag}`), h('span', { class: 'num' }, fmt(t.amount))),
      progressBar(t.amount * 100 / (rep.tags[0].amount || 1), 'accent', `#${t.tag}`),
      h('p', { class: 'muted small' }, `${t.count} transaction${t.count === 1 ? '' : 's'}`)))),
    h('p', { class: 'hint drill-hint' }, 'A transaction with several tags counts toward each of them.')) : null;
  if (incomeCard || tagCard) root.append(h('section', { class: 'grid-2' }, incomeCard, tagCard));
}

const rk = (label, value, sub) => h('div', { class: 'card kpi' }, h('span', { class: 'eyebrow' }, label), h('p', { class: 'kpi-val num' }, value), sub);

function exportSummary(rep) {
  const { period, tot, exp, inc, series } = rep;
  const rows = [
    ['Paisa financial summary'], ['Period', period.label], ['Range', `${period.start} to ${period.end}`], ['Currency', settings.currency], [],
    ['Income', toPlainDecimal(tot.income)], ['Expenses', toPlainDecimal(tot.expense)], ['Net savings', toPlainDecimal(tot.net)], ['Savings rate %', tot.rate === null ? 'n/a' : tot.rate], [],
    ['Expense category', 'Amount', 'Share %'], ...exp.flatMap((c) => [[c.name, toPlainDecimal(c.amount), Math.round(c.share * 1000) / 10], ...c.children.map((k) => [`  > ${k.name}`, toPlainDecimal(k.amount), tot.expense ? Math.round(k.amount / tot.expense * 1000) / 10 : 0])]), [],
    ['Income source', 'Amount', 'Share %'], ...inc.flatMap((c) => [[c.name, toPlainDecimal(c.amount), Math.round(c.share * 1000) / 10], ...c.children.map((k) => [`  > ${k.name}`, toPlainDecimal(k.amount), tot.income ? Math.round(k.amount / tot.income * 1000) / 10 : 0])]), [],
    ['Tag', 'Amount', 'Transactions'], ...rep.tags.map((t) => [`#${t.tag}`, toPlainDecimal(t.amount), t.count]), [],
    ['Period', 'Income', 'Expenses', 'Net', 'Savings rate %'], ...series.map((s) => [s.label, toPlainDecimal(s.income), toPlainDecimal(s.expense), toPlainDecimal(s.net), s.rate === null ? '' : s.rate]),
  ];
  download(`paisa-summary-${period.key}.csv`, toCSV(rows), 'text/csv');
  toast('Summary exported');
}
