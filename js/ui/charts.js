// Chart.js helpers. Charts are created AFTER the view is attached to the DOM (queued via onMount),
// and every chart is destroyed before the next render so nothing leaks.

import { h } from '../utils/dom.js';
import { fmt, fmtShort } from '../store.js';

const live = new Set();
const queue = [];

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function onMount(fn) { queue.push(fn); }
export function flushMounts() { while (queue.length) { const fn = queue.shift(); try { fn(); } catch (e) { console.error('chart error', e); } } }
export function destroyCharts() { live.forEach((c) => c.destroy()); live.clear(); queue.length = 0; }

/** Card shell with a canvas. `build(canvas)` returns a Chart.js config. */
export function chartBox({ label, height = 240, build }) {
  const canvas = h('canvas', { role: 'img', 'aria-label': label });
  const box = h('div', { class: 'chart-box', style: { height: `${height}px` } }, canvas);
  onMount(() => {
    if (!window.Chart) { box.replaceChildren(h('p', { class: 'muted small' }, 'Charts could not load. Everything else still works.')); return; }
    const C = window.Chart;
    C.defaults.color = cssVar('--muted');
    C.defaults.borderColor = cssVar('--border');
    C.defaults.font.family = getComputedStyle(document.body).fontFamily;
    C.defaults.font.size = 12;
    const cfg = build(canvas);
    cfg.options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 450 },
      ...cfg.options,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: cssVar('--text'), titleColor: cssVar('--surface'), bodyColor: cssVar('--surface'), padding: 10, cornerRadius: 8, boxPadding: 4 },
        ...(cfg.options?.plugins || {}),
      },
    };
    live.add(new C(canvas, cfg));
  });
  return box;
}

const major = (minor) => minor / 100;
const toMinor = (v) => Math.round(v * 100);

export function incomeExpenseChart(series, { showNet = false, label = 'Income and expenses by period' } = {}) {
  return chartBox({
    label,
    height: 250,
    build: () => {
      const datasets = [
        { type: 'bar', label: 'Income', data: series.map((s) => major(s.income)), backgroundColor: cssVar('--income'), borderRadius: 6, maxBarThickness: 26 },
        { type: 'bar', label: 'Expenses', data: series.map((s) => major(s.expense)), backgroundColor: cssVar('--expense'), borderRadius: 6, maxBarThickness: 26 },
      ];
      if (showNet) datasets.push({ type: 'line', label: 'Net', data: series.map((s) => major(s.net)), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), tension: 0.3, pointRadius: 3, borderWidth: 2 });
      return {
        type: 'bar',
        data: { labels: series.map((s) => s.short), datasets },
        options: {
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: (v) => fmtShort(toMinor(v)), maxTicksLimit: 5 }, border: { display: false } },
          },
          plugins: {
            legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } },
            tooltip: { callbacks: { title: (items) => series[items[0].dataIndex].label, label: (c) => ` ${c.dataset.label}: ${fmt(toMinor(c.parsed.y))}` } },
          },
        },
      };
    },
  });
}

export function doughnutChart(rows, { label = 'Spending by category' } = {}) {
  return chartBox({
    label,
    height: 210,
    build: () => ({
      type: 'doughnut',
      data: { labels: rows.map((r) => r.name), datasets: [{ data: rows.map((r) => major(r.amount)), backgroundColor: rows.map((r) => r.color), borderColor: cssVar('--surface'), borderWidth: 3, hoverOffset: 6 }] },
      options: {
        cutout: '66%',
        plugins: { tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(toMinor(c.parsed))} (${Math.round(rows[c.dataIndex].share * 100)}%)` } } },
      },
    }),
  });
}

export function lineChart(series, values, { label, color = '--accent', suffix = '%' }) {
  return chartBox({
    label,
    height: 200,
    build: () => ({
      type: 'line',
      data: { labels: series.map((s) => s.short), datasets: [{ label, data: values, borderColor: cssVar(color), backgroundColor: cssVar(color), tension: 0.3, pointRadius: 3, borderWidth: 2, spanGaps: true }] },
      options: {
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${v}${suffix}`, maxTicksLimit: 5 }, border: { display: false } } },
        plugins: { tooltip: { callbacks: { title: (items) => series[items[0].dataIndex].label, label: (c) => (c.parsed.y === null ? ' No income' : ` ${c.parsed.y}${suffix}`) } } },
      },
    }),
  });
}

/** Spending per period as bars with the budget limit drawn as a line. */
export function budgetCompareChart(series, limit) {
  return chartBox({
    label: 'Spending compared with the overall budget',
    height: 220,
    build: () => ({
      type: 'bar',
      data: {
        labels: series.map((s) => s.short),
        datasets: [
          { type: 'bar', label: 'Spent', data: series.map((s) => major(s.expense)), backgroundColor: series.map((s) => (limit && s.expense > limit ? cssVar('--expense') : cssVar('--accent'))), borderRadius: 6, maxBarThickness: 34 },
          ...(limit ? [{ type: 'line', label: 'Limit', data: series.map(() => major(limit)), borderColor: cssVar('--warn'), borderDash: [6, 4], pointRadius: 0, borderWidth: 2 }] : []),
        ],
      },
      options: {
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => fmtShort(toMinor(v)), maxTicksLimit: 5 }, border: { display: false } } },
        plugins: {
          legend: { display: !!limit, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } },
          tooltip: { callbacks: { title: (items) => series[items[0].dataIndex].label, label: (c) => ` ${c.dataset.label}: ${fmt(toMinor(c.parsed.y))}` } },
        },
      },
    }),
  });
}
