let showDays = true;

/** Settings → Appearance → Times: show a day or more as days ("1d 4h") or keep counting hours ("28h"). */
export function setTimeFormat(format: 'days' | 'hours' | undefined) {
  showDays = format !== 'hours';
}

/**
 * Minutes as days, hours and minutes, showing only the parts that are there: 45m · 1h 5m · 2d 3h · 1d 20m.
 * With the "hours" time format a day or more stays in hours: 51h · 24h 20m.
 */
export function fmtMinutes(min: number | undefined | null, days = showDays): string {
  if (min === undefined || min === null || !Number.isFinite(min)) return '—';
  const total = Math.round(min);
  if (total === 0) return '0m';
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const d = days ? Math.floor(abs / 1440) : 0;
  const h = Math.floor((abs - d * 1440) / 60);
  const m = abs % 60;
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean);
  return sign + parts.join(' ');
}

export function fmtNum(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtPct(ratio: number | undefined | null, digits = 0): string {
  if (ratio === undefined || ratio === null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function signed(text: string, n: number): string {
  return n > 0 ? `+${text}` : text;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${fmtNum(n)} ${Math.abs(n) === 1 ? one : many}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
