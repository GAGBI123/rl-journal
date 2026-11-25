// Calendar-date helpers. Dates are local YYYY-MM-DD strings; math is done in UTC to dodge DST.

const DAY = 86400000;

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, n: number): string {
  return fromUtc(utc(iso) + n * DAY);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(iso: string): number {
  return (new Date(utc(iso)).getUTCDay() + 6) % 7;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Monday of the week containing iso. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function formatLongDate(iso: string): string {
  return formatDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function isoFromTimestamp(ts: string): string {
  return toISO(new Date(ts));
}

export function relativeTime(ts: string): string {
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
