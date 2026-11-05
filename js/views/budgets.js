import { h, icon } from '../utils/dom.js';
import { state, settings, fmt, getCategory, saveBudget, deleteBudget, categoryLabel, topCategories, childrenOf } from '../store.js';
import { today, periodOf, shiftPeriod } from '../utils/dates.js';
import { toInputString } from '../utils/money.js';
import * as calc from '../calc.js';
import { validateBudget } from '../utils/validate.js';
import { pageHeader, emptyState, progressBar, btn, field, showErrors, clearFieldError, selectEl, iconBtn } from '../ui/components.js';
import { budgetCompareChart } from '../ui/charts.js';
import { openModal, confirmDialog, toast } from '../ui/overlay.js';
import { chartPeriods } from './dashboard.js';

let offset = 0; // 0 = current financial month, -1 = previous, ...

function openBudgetForm(existing = null) {
  const used = new Set(state.budgets.filter((b) => b.id !== existing?.id).map((b) => b.categoryId || null));
  const options = [];
  if (!used.has(null)) options.push(['', '🎯 Overall monthly spending']);
  for (const c of topCategories('expense')) {
    const kids = childrenOf(c.id);
    if (!used.has(c.id)) options.push([c.id, `${c.icon} ${c.name}${kids.length ? ' (with subcategories)' : ''}`]);
    for (const k of kids) if (!used.has(k.id)) options.push([k.id, `\u00A0\u00A0↳ ${k.name}`]);
  }
  if (!options.length) { toast('Every category already has a budget.', { type: 'info' }); return; }
  const s = { categoryId: existing ? existing.categoryId || '' : options[0][0], limit: existing ? toInputString(existing.limit) : '' };
  const root = h('form', { class: 'form', novalidate: true });
  root.append(
    field({ label: 'Budget for', name: 'categoryId', control: selectEl(options, s.categoryId, { id: 'b-cat', disabled: !!existing, onchange: (e) => { s.categoryId = e.target.value; clearFieldError(root, 'categoryId'); } }) }),
    field({ label: 'Monthly limit', name: 'limit', hint: 'Applies to every financial month.', control: h('input', { class: 'input', id: 'b-limit', type: 'text', inputmode: 'decimal', placeholder: '0.00', value: s.limit, autofocus: true, oninput: (e) => { s.limit = e.target.value; clearFieldError(root, 'limit'); } }) }));
  async function submit() {
    const v = validateBudget(s, { budgets: state.budgets, categories: state.categories, editingId: existing?.id });
    if (!v.ok) { showErrors(root, v.errors); return; }
    try { await saveBudget(v.value, existing?.id || null); m.close(); toast(existing ? 'Budget updated' : 'Budget created'); } catch (e) { toast(`Could not save: ${e.message}`, { type: 'error' }); }
  }
  root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const m = openModal({
    title: existing ? 'Edit budget' : 'New budget', content: root,
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, existing ? 'Save' : 'Create budget')],
  });
}

export function render(root) {
  const rerender = () => root.dispatchEvent(new CustomEvent('paisa:rerender', { bubbles: true }));
  const nowP = periodOf(today(), settings.monthStart);
  const period = shiftPeriod(nowP, offset);

  root.append(pageHeader('Budgets', 'Stay ahead of your spending', btn('New budget', { variant: 'primary', glyph: 'plus', onClick: () => openBudgetForm() })));

  root.append(h('div', { class: 'month-nav' },
    iconBtn('left', 'Previous month', () => { offset -= 1; rerender(); }),
    h('div', { class: 'month-label' }, h('strong', null, period.label), offset === 0 ? h('span', { class: 'muted small' }, 'Current month') : h('button', { class: 'link', type: 'button', onclick: () => { offset = 0; rerender(); } }, 'Back to current')),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', disabled: offset >= 0, onclick: () => { offset += 1; rerender(); } }, icon('right', 18))));

  if (!state.budgets.length) {
    root.append(h('div', { class: 'card' }, emptyState({ glyph: 'budget', title: 'Set your first budget', text: 'Pick a category (or your overall spending) and a monthly limit. You’ll see progress here and a warning when you get close.', action: btn('Create a budget', { variant: 'primary', glyph: 'plus', onClick: () => openBudgetForm() }) })));
    return;
  }

  const items = state.budgets.map((b) => {
    const cat = b.categoryId ? getCategory(b.categoryId) : null;
    // A budget on a parent category also counts its subcategories; a budget on a subcategory counts only that one.
    const family = b.categoryId ? calc.familyIds(state.categories, b.categoryId) : null;
    const spent = calc.budgetSpent(state.transactions, period, b.categoryId, family);
    const prevP = shiftPeriod(period, -1);
    const prevSpent = calc.budgetSpent(state.transactions, prevP, b.categoryId, family);
    return { b, cat, st: calc.budgetStatus(b.limit, spent), prevSpent, prevLabel: prevP.short };
  }).sort((a, z) => (a.b.categoryId ? 1 : 0) - (z.b.categoryId ? 1 : 0) || z.st.pct - a.st.pct);

  const warnings = items.filter((i) => i.st.state !== 'ok' && offset === 0);
  if (warnings.length) {
    root.append(h('div', { class: 'alerts', role: 'status' }, warnings.map(({ b, cat, st }) => h('div', { class: `alert alert-${st.state}` }, icon('alert', 18),
      h('span', null, h('strong', null, cat ? categoryLabel(cat) : 'Overall spending'), st.state === 'over' ? ` is over budget by ${fmt(-st.remaining)}.` : ` is at ${Math.round(st.pct)}% of its limit. ${fmt(st.remaining)} left.`)))));
  }

  root.append(h('div', { class: 'budget-grid' }, items.map(({ b, cat, st, prevSpent, prevLabel }) => {
    const diff = st.spent - prevSpent;
    return h('div', { class: `card budget-card st-card-${st.state}` },
      h('div', { class: 'row-between' },
        h('h3', { class: 'b-title' }, cat ? h('span', null, h('span', { class: 'b-emoji' }, cat.icon), categoryLabel(cat), childrenOf(cat.id).length ? h('span', { class: 'muted small b-incl' }, ' · includes subcategories') : null) : h('span', null, h('span', { class: 'b-emoji' }, '🎯'), 'Overall spending')),
        h('span', { class: 'row-actions' },
          iconBtn('edit', 'Edit budget', () => openBudgetForm(b)),
          iconBtn('trash', 'Delete budget', async () => { if (await confirmDialog({ title: 'Delete this budget?', message: 'Your transactions are not affected.', confirmLabel: 'Delete' })) { await deleteBudget(b.id); toast('Budget deleted'); } }))),
      h('div', { class: 'b-figures' },
        h('div', null, h('span', { class: 'muted small' }, 'Spent'), h('strong', { class: 'num' }, fmt(st.spent))),
        h('div', null, h('span', { class: 'muted small' }, 'Limit'), h('strong', { class: 'num' }, fmt(b.limit))),
        h('div', null, h('span', { class: 'muted small' }, st.remaining >= 0 ? 'Remaining' : 'Over by'), h('strong', { class: `num st-${st.state}` }, fmt(Math.abs(st.remaining))))),
      progressBar(st.pct, st.state, `${cat ? cat.name : 'Overall'} budget used`),
      h('div', { class: 'row-between small' },
        h('span', { class: `st-${st.state}` }, `${Math.round(st.pct)}% used`),
        h('span', { class: 'muted' }, prevSpent || st.spent ? `${diff === 0 ? 'Same as' : diff > 0 ? `${fmt(diff)} more than` : `${fmt(-diff)} less than`} ${prevLabel}` : '')));
  })));

  const overall = state.budgets.find((b) => !b.categoryId);
  const series = calc.bucketSeries(state.transactions, chartPeriods({ start: shiftPeriod(period, -5).start, end: period.end }).slice(-6));
  root.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Spending across months'), h('span', { class: 'muted small' }, overall ? 'Compared with your overall limit' : 'Total expenses')), budgetCompareChart(series, overall?.limit || 0)));
}
