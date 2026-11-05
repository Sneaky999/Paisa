// Money is stored as INTEGER minor units (1 Rs = 100 paisa) so no floating-point drift.

export const CURRENCIES = {
  NPR: { symbol: 'Rs', name: 'Nepalese Rupee', locale: 'en-IN' },
  USD: { symbol: '$', name: 'US Dollar', locale: 'en-US' },
  EUR: { symbol: '€', name: 'Euro', locale: 'en-US' },
  GBP: { symbol: '£', name: 'British Pound', locale: 'en-US' },
  INR: { symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  AUD: { symbol: 'A$', name: 'Australian Dollar', locale: 'en-US' },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', locale: 'en-US' },
  AED: { symbol: 'AED', name: 'UAE Dirham', locale: 'en-US' },
  QAR: { symbol: 'QAR', name: 'Qatari Riyal', locale: 'en-US' },
  MYR: { symbol: 'RM', name: 'Malaysian Ringgit', locale: 'en-US' },
  SGD: { symbol: 'S$', name: 'Singapore Dollar', locale: 'en-US' },
  BDT: { symbol: '৳', name: 'Bangladeshi Taka', locale: 'en-IN' },
  PKR: { symbol: 'Rs', name: 'Pakistani Rupee', locale: 'en-IN' },
  CNY: { symbol: 'CN¥', name: 'Chinese Yuan', locale: 'en-US' },
};

const MAX_WHOLE_DIGITS = 11;
const fail = (error) => ({ ok: false, error });

/** Parse user text into minor units without using floats. */
export function parseAmount(input, { allowZero = false, allowNegative = false } = {}) {
  let s = String(input ?? '').trim().replace(/[,\s_]/g, '');
  if (s === '') return fail('Enter an amount');
  let neg = false;
  if (s[0] === '-') {
    if (!allowNegative) return fail('Amount cannot be negative');
    neg = true;
    s = s.slice(1);
  } else if (s[0] === '+') s = s.slice(1);
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return fail('Enter a valid number');
  const [i = '', f = ''] = s.split('.');
  if (f.length > 2) return fail('Use at most 2 decimal places');
  if (i.replace(/^0+/, '').length > MAX_WHOLE_DIGITS) return fail('Amount is too large');
  const minor = Number(i || '0') * 100 + Number((f + '00').slice(0, 2));
  if (minor === 0 && !allowZero) return fail('Amount must be greater than zero');
  return { ok: true, minor: neg && minor ? -minor : minor };
}

export function formatMoney(minor, currency = 'NPR', { decimals = true, sign = false } = {}) {
  const c = CURRENCIES[currency] || CURRENCIES.NPR;
  const n = Math.round(Number(minor) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  let body;
  if (decimals) {
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, '0');
    body = `${new Intl.NumberFormat(c.locale).format(whole)}.${frac}`;
  } else {
    body = new Intl.NumberFormat(c.locale).format(Math.round(abs / 100));
  }
  const gap = /^[A-Za-z]+$/.test(c.symbol) ? ' ' : '';
  const prefix = neg ? '−' : sign && abs > 0 ? '+' : '';
  return `${prefix}${c.symbol}${gap}${body}`;
}

/** Compact form for chart axes: 12.5k, 1.2L (en-IN) etc. */
export function formatShort(minor, currency = 'NPR') {
  const c = CURRENCIES[currency] || CURRENCIES.NPR;
  return new Intl.NumberFormat(c.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100);
}

/** Minor units -> editable text ("1234.5" -> "1234.50", whole numbers stay whole). */
export function toInputString(minor) {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const s = frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole);
  return neg ? `-${s}` : s;
}

/** Plain decimal for CSV export (no symbols, no grouping). */
export function toPlainDecimal(minor) {
  const abs = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
