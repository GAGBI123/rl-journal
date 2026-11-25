// Pure operations on the journal data (no React). Mutating helpers take a draft copy.
import type { Activity, AppData, Day, Entry, Measure, Season, Section, Settings, TimeUnit } from '../../shared/model';
import { addDays, diffDays, todayISO } from './dates';
import { uid } from './format';

export const DEFAULT_SEASON_DAYS = 90;

export const DEFAULT_SETTINGS: Settings = {
  favorites: ['training.totalTime', 'games.total', 'training.dailyAvg', 'games.byMode', 'streak.current'],
  trackerPollMinutes: 5,
  liveGameEnabled: true,
  liveGamePort: 49124,
  ignorePrivateMatches: true,
  countCasualAsRanked: false,
  systemNotifications: true,
  closeToTray: true,
  startWithWindows: false,
  trackerBaseUrl: 'https://public-api.tracker.gg/v2',
};

export const SECTION_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#ef4444'];

export function createDefaultData(): AppData {
  const now = new Date().toISOString();
  const training: Section = { id: 'sec-training', name: 'Training', color: '#3b82f6', builtIn: true, kind: 'training', order: 0 };
  const games: Section = { id: 'sec-games', name: 'Games', color: '#f97316', builtIn: true, kind: 'games', order: 1 };
  const act = (id: string, sectionId: string, name: string, m: Measure): Activity => ({
    id,
    sectionId,
    name,
    defaultMeasure: m,
    defaultUnit: 'min',
    builtIn: true,
    createdAt: now,
  });
  return {
    version: 1,
    seasons: [],
    sections: [training, games],
    activities: [
      act('act-freeplay', training.id, 'Freeplay', 'time'),
      act('act-1s', games.id, '1s', 'amount'),
      act('act-2s', games.id, '2s', 'amount'),
      act('act-3s', games.id, '3s', 'amount'),
    ],
    accounts: [],
    matches: [],
    mmr: [],
    notifications: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Fill in anything missing from older / imported files. */
export function normalizeData(raw: any): AppData {
  const base = createDefaultData();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.seasons)) return base;
  const data: AppData = {
    version: 1,
    seasons: raw.seasons ?? [],
    sections: Array.isArray(raw.sections) && raw.sections.length ? raw.sections : base.sections,
    activities: Array.isArray(raw.activities) ? raw.activities : base.activities,
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    matches: Array.isArray(raw.matches) ? raw.matches : [],
    mmr: Array.isArray(raw.mmr) ? raw.mmr : [],
    notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
  for (const s of data.seasons) {
    s.days = (s.days ?? []).map((d: Day) => ({ ...d, entries: d.entries ?? [] }));
    sortDays(s);
  }
  // Guarantee the two built-in sections exist.
  for (const sec of base.sections) {
    if (!data.sections.some((s) => s.kind === sec.kind)) data.sections.push(sec);
  }
  for (const a of data.accounts) {
    a.inGameNames = a.inGameNames ?? [];
    a.primaryIds = a.primaryIds ?? [];
    a.tracker = { ...(a.tracker ?? {}), enabled: !!a.tracker?.enabled, apiKey: a.tracker?.apiKey ?? '' };
  }
  return data;
}

export function sortDays(season: Season) {
  season.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function makeDays(startDate: string, count: number, offset = 0): Day[] {
  return Array.from({ length: count }, (_, i) => ({ id: uid(), date: addDays(startDate, offset + i), entries: [] }));
}

export function createSeason(data: AppData, number: number, startDate: string, days = DEFAULT_SEASON_DAYS, name?: string): Season {
  const season: Season = {
    id: uid(),
    number,
    name: name?.trim() || undefined,
    startDate,
    status: 'active',
    createdAt: new Date().toISOString(),
    days: makeDays(startDate, days),
  };
  data.seasons.push(season);
  return season;
}

/** Day number relative to the season start (Day 1 = start date). */
export function dayNumber(season: Season, day: Day): number {
  return diffDays(season.startDate, day.date) + 1;
}

/** Append n days after the last existing day. */
export function addDaysToSeason(season: Season, n: number) {
  const last = season.days[season.days.length - 1]?.date ?? addDays(season.startDate, -1);
  season.days.push(...makeDays(addDays(last, 1), n));
}

export function seasonLabel(season: Season): string {
  return season.name ? `Season ${season.number} · ${season.name}` : `Season ${season.number}`;
}

export function seasonEndDate(season: Season): string | undefined {
  return season.days[season.days.length - 1]?.date;
}

export function findSeason(data: AppData, id: string) {
  return data.seasons.find((s) => s.id === id);
}

export function findDay(data: AppData, seasonId: string, dayId: string) {
  return findSeason(data, seasonId)?.days.find((d) => d.id === dayId);
}

export function activityById(data: AppData, id: string) {
  return data.activities.find((a) => a.id === id);
}

export function sectionById(data: AppData, id: string) {
  return data.sections.find((s) => s.id === id);
}

export function sectionOfActivity(data: AppData, activityId: string) {
  const a = activityById(data, activityId);
  return a ? sectionById(data, a.sectionId) : undefined;
}

export function gamesSection(data: AppData) {
  return data.sections.find((s) => s.kind === 'games')!;
}

export function sortedSections(data: AppData) {
  return [...data.sections].sort((a, b) => a.order - b.order);
}

/** Today's (or any date's) day in active seasons, newest season first. */
export function dayForDate(data: AppData, date: string): { season: Season; day: Day } | null {
  const seasons = [...data.seasons].filter((s) => s.status === 'active').sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  for (const season of seasons) {
    const day = season.days.find((d) => d.date === date);
    if (day) return { season, day };
  }
  return null;
}

export function anyDayForDate(data: AppData, date: string): { season: Season; day: Day } | null {
  for (const season of data.seasons) {
    const day = season.days.find((d) => d.date === date);
    if (day) return { season, day };
  }
  return null;
}

/**
 * Find the day sync results go to. If an active season has started but has no day for
 * that date (e.g. it ran past 90 days), the missing days are appended up to that date.
 */
export function ensureSyncDay(data: AppData, date: string): { season: Season; day: Day; created: boolean } | null {
  const hit = dayForDate(data, date);
  if (hit) return { ...hit, created: false };
  const season = [...data.seasons]
    .filter((s) => s.status === 'active' && s.startDate <= date)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  if (!season) return null;
  const last = season.days[season.days.length - 1]?.date;
  if (last && last > date) {
    // Date falls inside the season but its day was deleted: recreate just that day.
    const day: Day = { id: uid(), date, entries: [] };
    season.days.push(day);
    sortDays(season);
    return { season, day, created: true };
  }
  const missing = last ? diffDays(last, date) : diffDays(season.startDate, date) + 1;
  if (missing > 31) return null; // too far past the season's end: probably a stale season
  addDaysToSeason(season, missing);
  return { season, day: season.days.find((d) => d.date === date)!, created: true };
}

export function findOrCreateActivity(
  data: AppData,
  sectionId: string,
  name: string,
  measure: Measure,
  unit: TimeUnit = 'min',
): Activity {
  const trimmed = name.trim();
  const existing = data.activities.find((a) => a.sectionId === sectionId && a.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;
  const activity: Activity = {
    id: uid(),
    sectionId,
    name: trimmed,
    defaultMeasure: measure,
    defaultUnit: unit,
    createdAt: new Date().toISOString(),
  };
  data.activities.push(activity);
  return activity;
}

export function entryValue(e: Entry, measure: Measure): number {
  if (e.measure !== measure) return 0;
  return measure === 'time' ? e.minutes ?? 0 : e.amount ?? 0;
}

export function describeEntry(e: Entry): string {
  if (e.measure === 'time') {
    const m = e.minutes ?? 0;
    if (e.unit === 'hr') return `${+(m / 60).toFixed(2)} ${m === 60 ? 'hour' : 'hours'}`;
    return `${+m.toFixed(1)} min`;
  }
  return `${e.amount ?? 0}`;
}

export function isToday(date: string) {
  return date === todayISO();
}

export function newEntry(partial: Omit<Entry, 'id' | 'createdAt'>): Entry {
  return { id: uid(), createdAt: new Date().toISOString(), ...partial };
}
