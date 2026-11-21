export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let DATE_MODE = 'relative';
let TIME_ZONE = null; // IANA zone chosen in Settings; null = the browser's own
export const setDateMode = (m) => { DATE_MODE = m || 'relative'; };
export const setTimeZone = (z) => {
  try { TIME_ZONE = z ? (new Intl.DateTimeFormat('en-US', { timeZone: z }), z) : null; } catch { TIME_ZONE = null; }
};

/** A Date whose local getters (getDate, getHours, …) show `ts` as seen in the chosen time zone. */
function zoned(ts) {
  if (!TIME_ZONE) return new Date(ts);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}
const timeOf = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function formatDate(ts) {
  if (!ts) return '—';
  const d = zoned(ts), now = zoned(Date.now());
  if (DATE_MODE === 'absolute') return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const diff = (Date.now() - ts) / 1000;
  if (diff >= 0 && diff < 60) return 'Just now';
  if (diff >= 0 && diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const time = timeOf(d);
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? ', ' + d.getFullYear() : ''}`;
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  const d = zoned(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${timeOf(d)}`;
}

export function splitName(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i + 1).toLowerCase()];
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('');
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Timestamp -> 'YYYY-MM-DD' in the viewer's local time zone (what <input type="date"> expects). */
export const toDateInput = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 'YYYY-MM-DD' from a date input -> the end of that day in local time (null when empty). */
export const fromDateInput = (str, { endOfDay = true } = {}) => {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 0).getTime() : new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
};
