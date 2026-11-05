import { h, icon } from '../utils/dom.js';
import { state, fmt, fmtDate, saveGoal, deleteGoal, addGoalEntry } from '../store.js';
import { today } from '../utils/dates.js';
import { toInputString } from '../utils/money.js';
import * as calc from '../calc.js';
import { validateGoal, validateContribution, GOAL_NAME_MAX } from '../utils/validate.js';
import { pageHeader, emptyState, progressBar, btn, field, showErrors, clearFieldError, seg, iconBtn } from '../ui/components.js';
import { openModal, confirmDialog, toast } from '../ui/overlay.js';

function openGoalForm(existing = null) {
  const s = { name: existing?.name || '', target: existing ? toInputString(existing.target) : '', initial: '', deadline: existing?.deadline || '' };
  const root = h('form', { class: 'form', novalidate: true });
  root.append(
    field({ label: 'Goal name', name: 'name', control: h('input', { class: 'input', id: 'g-name', type: 'text', maxlength: GOAL_NAME_MAX + 10, placeholder: 'e.g. New laptop', value: s.name, autofocus: true, oninput: (e) => { s.name = e.target.value; clearFieldError(root, 'name'); } }) }),
    field({ label: 'Target amount', name: 'target', control: h('input', { class: 'input', id: 'g-target', type: 'text', inputmode: 'decimal', placeholder: '0.00', value: s.target, oninput: (e) => { s.target = e.target.value; clearFieldError(root, 'target'); } }) }));
  if (!existing) root.append(field({ label: 'Already saved', name: 'initial', optional: true, control: h('input', { class: 'input', id: 'g-init', type: 'text', inputmode: 'decimal', placeholder: '0.00', oninput: (e) => { s.initial = e.target.value; clearFieldError(root, 'initial'); } }) }));
  root.append(field({ label: 'Deadline', name: 'deadline', optional: true, hint: 'Add one to see how much to save each month.', control: h('input', { class: 'input', id: 'g-dead', type: 'date', value: s.deadline, max: '2100-12-31', oninput: (e) => { s.deadline = e.target.value; clearFieldError(root, 'deadline'); } }) }));
  async function submit() {
    const v = validateGoal(s, { isNew: !existing, todayISO: today() });
    if (!v.ok) { showErrors(root, v.errors); return; }
    try { await saveGoal(v.value, existing?.id || null); m.close(); toast(existing ? 'Goal updated' : 'Goal created'); } catch (e) { toast(`Could not save: ${e.message}`, { type: 'error' }); }
  }
  root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  const m = openModal({ title: existing ? 'Edit goal' : 'New savings goal', content: root, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, existing ? 'Save' : 'Create goal')] });
}

function openContribution(goal, kind = 'add') {
  const s = { kind, amount: '', date: today(), note: '' };
  const root = h('form', { class: 'form', novalidate: true });
  const saved = calc.goalSaved(goal);
  function draw() {
    root.replaceChildren(
      h('div', { class: 'field' }, seg({ label: 'Action', value: s.kind, options: [['add', 'Add money', 'income'], ['withdraw', 'Withdraw', 'expense']], onChange: (v) => { s.kind = v; draw(); } })),
      field({ label: 'Amount', name: 'amount', hint: s.kind === 'withdraw' ? `You have ${fmt(saved)} saved.` : null, control: h('input', { class: 'input', id: 'c-amt', type: 'text', inputmode: 'decimal', placeholder: '0.00', value: s.amount, autofocus: true, oninput: (e) => { s.amount = e.target.value; clearFieldError(root, 'amount'); } }) }),
      field({ label: 'Date', name: 'date', control: h('input', { class: 'input', id: 'c-date', type: 'date', value: s.date, oninput: (e) => { s.date = e.target.value; clearFieldError(root, 'date'); } }) }),
      field({ label: 'Note', name: 'note', optional: true, control: h('input', { class: 'input', id: 'c-note', type: 'text', value: s.note, oninput: (e) => { s.note = e.target.value; } }) }));
  }
  async function submit() {
    const v = validateContribution(s, { saved, kind: s.kind });
    if (!v.ok) { showErrors(root, v.errors); return; }
    try { await addGoalEntry(goal.id, v.value); m.close(); toast(s.kind === 'add' ? 'Money added to your goal' : 'Withdrawal recorded'); } catch (e) { toast(`Could not save: ${e.message}`, { type: 'error' }); }
  }
  root.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  draw();
  const m = openModal({ title: goal.name, content: root, footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, 'Save')] });
}

function openHistory(goal) {
  const entries = [...goal.entries].sort((a, b) => b.date.localeCompare(a.date));
  const list = h('ul', { class: 'tx-list' },
    entries.map((e) => h('li', { class: 'hist-row' }, h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, e.amount > 0 ? 'Added' : 'Withdrawn', e.note ? h('span', { class: 'tx-note' }, ` · ${e.note}`) : null), h('span', { class: 'muted small' }, fmtDate(e.date))), h('span', { class: `amt ${e.amount > 0 ? 'amt-income' : 'amt-expense'}` }, `${e.amount > 0 ? '+' : '−'}${fmt(Math.abs(e.amount)).replace('−', '')}`))),
    goal.initial ? h('li', { class: 'hist-row' }, h('span', { class: 'tx-main' }, h('span', { class: 'tx-title' }, 'Starting balance')), h('span', { class: 'amt' }, fmt(goal.initial))) : null);
  const m = openModal({ title: `${goal.name}: history`, content: entries.length || goal.initial ? list : h('p', { class: 'muted' }, 'No contributions yet.'), footer: h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Close') });
}

export function render(root) {
  const now = today();
  root.append(pageHeader('Goals', 'Save for what matters', btn('New goal', { variant: 'primary', glyph: 'plus', onClick: () => openGoalForm() })));
  if (!state.goals.length) {
    root.append(h('div', { class: 'card' }, emptyState({ glyph: 'target', title: 'Create your first goal', text: 'A trip, a laptop, an emergency fund. Set a target and Paisa will tell you how much to put aside each month.', action: btn('Create a goal', { variant: 'primary', glyph: 'plus', onClick: () => openGoalForm() }) })));
    return;
  }
  const goals = [...state.goals].sort((a, b) => (calc.goalProgress(a) >= 100) - (calc.goalProgress(b) >= 100) || (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  root.append(h('div', { class: 'goal-grid' }, goals.map((g) => {
    const saved = calc.goalSaved(g);
    const pct = calc.goalProgress(g);
    const plan = calc.goalPlan(g, now);
    const ring = Math.min(100, Math.max(0, pct));
    let planText;
    if (plan.status === 'reached') planText = '🎉 Goal reached!';
    else if (plan.status === 'no-deadline') planText = 'Add a deadline to get a monthly saving plan.';
    else if (plan.status === 'overdue') planText = `Deadline passed. ${fmt(plan.remaining)} still to go.`;
    else planText = `Save ${fmt(plan.monthly)} per month for ${plan.monthsLeft} month${plan.monthsLeft === 1 ? '' : 's'} to get there.`;
    return h('div', { class: `card goal-card${plan.status === 'reached' ? ' done' : ''}` },
      h('div', { class: 'row-between' },
        h('h3', null, g.name),
        h('span', { class: 'row-actions' }, iconBtn('edit', 'Edit goal', () => openGoalForm(g)), iconBtn('trash', 'Delete goal', async () => { if (await confirmDialog({ title: `Delete “${g.name}”?`, message: 'The goal and its contribution history will be removed.', confirmLabel: 'Delete' })) { await deleteGoal(g.id); toast('Goal deleted'); } }))),
      h('div', { class: 'goal-body' },
        h('div', { class: 'ring', style: { '--p': ring }, role: 'img', 'aria-label': `${pct}% complete` }, h('span', { class: 'ring-text num' }, `${Math.round(pct)}%`)),
        h('div', { class: 'goal-figs' },
          h('strong', { class: 'num' }, fmt(saved)), h('span', { class: 'muted small' }, `of ${fmt(g.target)}`),
          h('span', { class: 'muted small' }, g.deadline ? `Due ${fmtDate(g.deadline)}` : 'No deadline'))),
      progressBar(pct, plan.status === 'reached' ? 'ok' : plan.status === 'overdue' ? 'over' : 'accent', `${g.name} progress`),
      h('p', { class: 'plan small' }, icon('trend', 14), planText),
      h('div', { class: 'goal-actions' },
        btn('Add', { variant: 'primary', glyph: 'plus', onClick: () => openContribution(g, 'add') }),
        btn('Withdraw', { onClick: () => openContribution(g, 'withdraw'), disabled: saved <= 0 }),
        btn('History', { variant: 'ghost', onClick: () => openHistory(g) })));
  })));
}
