// Dates are plain 'YYYY-MM-DD' strings (local calendar dates) so there are no timezone surprises
// and string comparison == chronological comparison.

const pad = (n) => String(n).padStart(2, '0');
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}
export const isValidISO = (s) => parseISO(s) !== null;

export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

export function addDays(iso, n) {
  const p = parseISO(iso);
  return toISO(new Date(p.y, p.m - 1, p.d + n));
}

/** Add whole months, keeping the anchor day but clamping to month length (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso, n, anchorDay) {
  const p = parseISO(iso);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const day = Math.min(anchorDay || p.d, daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(day)}`;
}

export function diffDays(a, b) {
  const pa = parseISO(a), pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** The financial month containing `iso`. startDay 1..28; with startDay=1 it is the calendar month. */
export function periodOf(iso, startDay = 1) {
  const p = parseISO(iso);
  let y = p.y, m = p.m;
  if (p.d < startDay) {
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  const start = `${y}-${pad(m)}-${pad(startDay)}`;
  const end = addDays(addMonths(start, 1), -1);
  const e = parseISO(end);
  const label = startDay === 1
    ? `${MONTHS_LONG[m - 1]} ${y}`
    : `${startDay} ${MONTHS[m - 1]}${e.y !== y ? ' ' + y : ''} – ${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
  return { key: `${y}-${pad(m)}`, start, end, startDay, label, short: MONTHS[m - 1], year: y };
}

export const shiftPeriod = (period, n) => periodOf(addMonths(period.start, n), period.startDay);

/** All financial months overlapping [startISO, endISO], oldest first. */
export function periodsBetween(startISO, endISO, startDay = 1) {
  const out = [];
  let p = periodOf(startISO, startDay);
  let guard = 0;
  while (p.start <= endISO && guard++ < 1200) {
    out.push(p);
    p = shiftPeriod(p, 1);
  }
  return out;
}

export function yearBucket(y) {
  return { key: String(y), start: `${y}-01-01`, end: `${y}-12-31`, label: String(y), short: String(y), year: y };
}

export function monthsBetweenLabel(days) {
  return days;
}

/** Display formatting honouring the user's preference: 'dmy' | 'mdy' | 'iso'. */
export function formatDate(iso, style = 'dmy') {
  const p = parseISO(iso);
  if (!p) return String(iso ?? '');
  if (style === 'iso') return iso;
  if (style === 'mdy') return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
  return `${pad(p.d)} ${MONTHS[p.m - 1]} ${p.y}`;
}

export function relativeLabel(iso, style, now = today()) {
  const d = diffDays(iso, now);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return formatDate(iso, style);
}
