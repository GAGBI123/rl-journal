// Official Rocket League competitive seasons (free-to-play era, Season 1 = September 2020).
// Used to suggest a season's number, start date and length when the user adds a season.
// Newer dates can come from seasons.json in the GitHub repo (see main.ts), so the app learns
// about new seasons without an update.
import type { RlSeasonInfo } from './model';

/** start = first day; end = the day the next season starts (when known). */
export const RL_SEASONS: RlSeasonInfo[] = [
  { number: 1, start: '2020-09-23', end: '2020-12-09' },
  { number: 2, start: '2020-12-09', end: '2021-04-07' },
  { number: 3, start: '2021-04-07', end: '2021-08-11' },
  { number: 4, start: '2021-08-11', end: '2021-11-17' },
  { number: 5, start: '2021-11-17', end: '2022-03-09' },
  { number: 6, start: '2022-03-09', end: '2022-06-15' },
  { number: 7, start: '2022-06-15', end: '2022-09-07' },
  { number: 8, start: '2022-09-07', end: '2022-12-07' },
  { number: 9, start: '2022-12-07', end: '2023-03-08' },
  { number: 10, start: '2023-03-08', end: '2023-06-07' },
  { number: 11, start: '2023-06-07', end: '2023-09-06' },
  { number: 12, start: '2023-09-06', end: '2023-12-06' },
  { number: 13, start: '2023-12-06', end: '2024-03-06' },
  { number: 14, start: '2024-03-06', end: '2024-06-05' },
  { number: 15, start: '2024-06-05', end: '2024-09-04' },
  { number: 16, start: '2024-09-04', end: '2024-12-04' },
  { number: 17, start: '2024-12-04', end: '2025-03-14' },
  { number: 18, start: '2025-03-14', end: '2025-06-18' },
  { number: 19, start: '2025-06-18', end: '2025-09-17' },
  { number: 20, start: '2025-09-17', end: '2025-12-10' },
  { number: 21, start: '2025-12-10', end: '2026-03-11' },
  { number: 22, start: '2026-03-11', end: '2026-06-10' },
  { number: 23, start: '2026-06-10', end: '2026-09-23' },
  { number: 24, start: '2026-09-23', end: '2026-12-09' },
];

/** Seasons usually last about 13 weeks; used when the next start date isn't known yet. */
export const TYPICAL_SEASON_DAYS = 91;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const utc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(utc(d) + n * DAY);
const diffDays = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/** Keep only well-formed entries (downloaded lists are untrusted). */
export function validSeasons(list: unknown): RlSeasonInfo[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (s: any) =>
        s &&
        Number.isInteger(s.number) &&
        s.number > 0 &&
        s.number < 1000 &&
        typeof s.start === 'string' &&
        ISO.test(s.start) &&
        (s.end === undefined || (typeof s.end === 'string' && ISO.test(s.end) && s.end > s.start)),
    )
    .map((s: any) => ({ number: s.number, start: s.start, ...(s.end ? { end: s.end } : {}) }));
}

/** Built-in seasons merged with downloaded ones (downloaded wins), oldest first. */
export function seasonCalendar(extra?: RlSeasonInfo[]): RlSeasonInfo[] {
  const map = new Map<number, RlSeasonInfo>();
  for (const s of RL_SEASONS) map.set(s.number, s);
  for (const s of validSeasons(extra)) map.set(s.number, { ...map.get(s.number), ...s });
  return [...map.values()].sort((a, b) => a.number - b.number);
}

export interface SeasonSpan {
  number: number;
  start: string;
  /** Day the season ends (= next season's first day). */
  end: string;
  days: number;
  /** True when the start or end date is a guess (season not in the calendar yet). */
  estimated: boolean;
}

/** Dates of season `n`, estimating seasons after the last known one. */
export function seasonSpan(calendar: RlSeasonInfo[], n: number): SeasonSpan | null {
  const known = calendar.find((s) => s.number === n);
  if (known) {
    const next = calendar.find((s) => s.number === n + 1);
    const end = known.end ?? next?.start;
    const e = end ?? addDays(known.start, TYPICAL_SEASON_DAYS);
    return { number: n, start: known.start, end: e, days: diffDays(known.start, e), estimated: !end };
  }
  const last = calendar[calendar.length - 1];
  if (!last || n < last.number) return null;
  // Past the calendar: chain typical-length seasons after the last known one.
  let span = seasonSpan(calendar, last.number)!;
  for (let k = last.number + 1; k <= n; k++) {
    const start = span.end;
    span = { number: k, start, end: addDays(start, TYPICAL_SEASON_DAYS), days: TYPICAL_SEASON_DAYS, estimated: true };
  }
  return span;
}

/** The season running on `today` (estimated if the calendar is behind). */
export function currentSeason(calendar: RlSeasonInfo[], today: string): SeasonSpan | null {
  const last = calendar[calendar.length - 1];
  if (!last || today < calendar[0].start) return null;
  for (let n = calendar[0].number; n < last.number + 40; n++) {
    const span = seasonSpan(calendar, n);
    if (span && today >= span.start && today < span.end) return span;
  }
  return null;
}

/**
 * What to suggest when adding a season: the current season if the user doesn't have it yet,
 * otherwise the newest earlier season they don't have.
 */
export function suggestSeason(calendar: RlSeasonInfo[], have: Iterable<number>, today: string): SeasonSpan | null {
  const taken = new Set(have);
  const cur = currentSeason(calendar, today);
  if (!cur) return null;
  for (let n = cur.number; n >= 1; n--) {
    if (!taken.has(n)) return seasonSpan(calendar, n);
  }
  return null;
}

/** Seasons the user doesn't have yet, newest first (current season and older). */
export function missingSeasons(calendar: RlSeasonInfo[], have: Iterable<number>, today: string): SeasonSpan[] {
  const taken = new Set(have);
  const cur = currentSeason(calendar, today);
  if (!cur) return [];
  const out: SeasonSpan[] = [];
  for (let n = cur.number; n >= 1; n--) {
    if (taken.has(n)) continue;
    const span = seasonSpan(calendar, n);
    if (span) out.push(span);
  }
  return out;
}
