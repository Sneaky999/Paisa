// Modal dialogs, confirmation dialogs and toasts.

import { h, icon } from '../utils/dom.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Open a modal. `content` and `footer` are Nodes. Returns {close, dialog}. */
export function openModal({ title, content, footer, onClose, wide = false }) {
  const previous = document.activeElement;
  const titleId = `m-${Math.random().toString(36).slice(2, 8)}`;
  let closed = false;

  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'));
  const dialog = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title), closeBtn),
    h('div', { class: 'modal-body' }, content),
    footer ? h('div', { class: 'modal-foot' }, footer) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dialog);

  function onKey(e) {
    if (e.key === 'Escape') {
      // Only the top-most modal reacts.
      const all = document.querySelectorAll('.overlay');
      if (all[all.length - 1] === overlay) { e.stopPropagation(); close(); }
    } else if (e.key === 'Tab') {
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.classList.add('closing');
    overlay.remove();
    if (!document.querySelector('.overlay')) document.body.classList.remove('no-scroll');
    if (previous && previous.focus && document.contains(previous)) previous.focus();
    onClose?.();
  }

  document.body.append(overlay);
  document.body.classList.add('no-scroll');
  document.addEventListener('keydown', onKey, true);
  const target = dialog.querySelector('[autofocus]') || dialog.querySelector('input:not([type=hidden]),select,textarea') || closeBtn;
  setTimeout(() => target.focus(), 30);
  return { close, dialog };
}

/** Resolves true if confirmed. */
export function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true, extra = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } m.close(); };
    const m = openModal({
      title,
      content: h('div', null, h('p', { class: 'confirm-text' }, message), extra),
      footer: [
        h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', autofocus: true, onclick: () => finish(true) }, confirmLabel),
      ],
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
  });
}

/* ---------- Toasts ---------- */

let region;
function getRegion() {
  if (!region || !document.body.contains(region)) {
    region = h('div', { class: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(region);
  }
  return region;
}

export function toast(message, { type = 'success', action = null, duration = 4500 } = {}) {
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check', 18),
    h('span', { class: 'toast-msg' }, message));
  const remove = () => el.remove();
  if (action) {
    el.append(h('button', { class: 'toast-action', type: 'button', onclick: () => { remove(); action.onClick(); } }, action.label));
  }
  getRegion().append(el);
  const ms = type === 'error' ? Math.max(duration, 7000) : action ? Math.max(duration, 7000) : duration;
  setTimeout(remove, ms);
  return remove;
}
