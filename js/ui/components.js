// Small shared UI building blocks.

import { h, icon } from '../utils/dom.js';
import { fmt } from '../store.js';

let idCounter = 0;
export const nextId = (p = 'f') => `${p}-${++idCounter}`;

export function pageHeader(title, subtitle, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', null, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

export function emptyState({ glyph = 'info', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(glyph, 26)),
    h('h3', null, title),
    text ? h('p', { class: 'muted' }, text) : null,
    action || null);
}

export function progressBar(pct, state = 'ok', label = '') {
  const w = Math.max(0, Math.min(100, pct));
  return h('div', { class: `progress progress-${state}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(w), 'aria-label': label || undefined },
    h('div', { class: 'progress-bar', style: { width: `${w}%` } }));
}

export function catBadge(cat, size = 'md') {
  const color = cat?.color || '#94a3b8';
  return h('span', { class: `cat-dot cat-${size}`, style: { background: `${color}26`, color } }, cat?.icon || '❔');
}

export function transferBadge(size = 'md') {
  return h('span', { class: `cat-dot cat-${size} cat-transfer` }, icon('swap', size === 'sm' ? 14 : 18));
}

/** Signed, coloured amount for a transaction row. */
export function amountEl(t, opts = {}) {
  if (t.type === 'transfer') return h('span', { class: 'amt amt-transfer' }, fmt(t.amount));
  const sign = t.type === 'income' ? '+' : '−';
  return h('span', { class: `amt amt-${t.type}` }, `${sign}${fmt(t.amount, opts).replace('−', '')}`);
}

export function btn(label, { variant = '', onClick, glyph, type = 'button', ...rest } = {}) {
  return h('button', { class: `btn ${variant ? 'btn-' + variant : ''}`.trim(), type, onclick: onClick, ...rest }, glyph ? icon(glyph, 18) : null, label ? h('span', null, label) : null);
}

export function iconBtn(glyph, label, onClick, extra = '') {
  return h('button', { class: `icon-btn ${extra}`.trim(), type: 'button', 'aria-label': label, title: label, onclick: onClick }, icon(glyph, 18));
}

/* ---------- Forms ---------- */

/** Wrap a control in a labelled field with an error slot. The control needs an `id`. */
export function field({ label, name, control, input = control, hint, optional = false }) {
  const id = input.id || (input.id = nextId('in'));
  const errId = `${id}-err`;
  input.setAttribute('aria-describedby', errId);
  return h('div', { class: 'field', dataset: { field: name } },
    h('label', { for: id }, label, optional ? h('span', { class: 'optional' }, ' (optional)') : null),
    control,
    hint ? h('p', { class: 'hint' }, hint) : null,
    h('p', { class: 'field-error', id: errId, role: 'alert' }));
}

/** Show validation errors inside `root`; focuses the first offending control. Returns true if any. */
export function showErrors(root, errors) {
  let first = null;
  root.querySelectorAll('[data-field]').forEach((f) => {
    const msg = errors[f.dataset.field] || '';
    const p = f.querySelector('.field-error');
    if (p) p.textContent = msg;
    f.classList.toggle('has-error', !!msg);
    const c = f.querySelector('input,select,textarea,button.chip-grid-btn');
    if (c) c.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg && !first) first = f.querySelector('input,select,textarea,button') || f;
  });
  if (first) first.focus();
  return !!first;
}

export function clearFieldError(root, name) {
  const f = root.querySelector(`[data-field="${name}"]`);
  if (!f) return;
  f.classList.remove('has-error');
  const p = f.querySelector('.field-error');
  if (p) p.textContent = '';
}

/** Segmented control (radio-group semantics). */
export function seg({ options, value, onChange, label }) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const draw = (v) => {
    wrap.replaceChildren(...options.map(([val, text, mod]) =>
      h('button', {
        type: 'button', role: 'radio', 'aria-checked': val === v ? 'true' : 'false',
        class: `seg-btn${val === v ? ' on' : ''}${mod ? ' seg-' + mod : ''}`,
        onclick: () => { if (val !== v) { draw(val); onChange(val); } },
      }, text)));
  };
  draw(value);
  return wrap;
}

export function selectEl(options, value, props = {}) {
  return h('select', { class: 'input', ...props, value }, options.map(([v, t]) => h('option', { value: v }, t)));
}

export function skeletonView() {
  return h('div', { class: 'skeleton-wrap', 'aria-busy': 'true', 'aria-label': 'Loading' },
    h('div', { class: 'skeleton sk-title' }),
    h('div', { class: 'skeleton sk-hero' }),
    h('div', { class: 'sk-row' }, h('div', { class: 'skeleton sk-card' }), h('div', { class: 'skeleton sk-card' }), h('div', { class: 'skeleton sk-card' })));
}
