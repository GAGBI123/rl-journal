// Pure operations on the journal data (no React). Mutating helpers take a draft copy.
import {
  DATA_VERSION,
  type Activity,
  type AppData,
  type Day,
  type DayRoutine,
  type Entry,
  type Measure,
  type Routine,
  type RoutineItem,
  type Season,
  type Section,
  type Settings,
} from '../../shared/model';
import { DEFAULT_GAME_MODES, HONOR_DUEL_KEY, keyForLegacyName, playlistInfo, PRACTICE_MODE_NAMES } from '../../shared/playlists';
import { addDays, diffDays, todayISO } from './dates';
import { uid } from './format';

export const DEFAULT_SEASON_DAYS = 90;

export const DEFAULT_SETTINGS: Settings = {
  favorites: ['training.totalTime', 'games.total', 'training.dailyAvg', 'games.byMode', 'streak.current'],
  liveGameEnabled: true,
  liveGamePort: 49124,
  ignorePrivateMatches: true,
  trackResultsGames: true,
  trackResultsHonorDuel: true,
  systemNotifications: true,
  closeToTray: true,
  startWithWindows: false,
  autoUpdate: true,
  updateChecks: true,
  timerOverlay: true,
  overlayPosition: 'top-center',
  timerHotkey: 'Control+Alt+P',
  timerFinishHotkey: 'Control+Alt+O',
  timerSound: true,
};

/** Settings keys from older versions that no longer exist. */
const REMOVED_SETTINGS = ['trackerPollMinutes', 'trackerBaseUrl', 'countCasualAsRanked'];

export const SECTION_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#ef4444'];

/** Activity ids used by the built-in game modes (1.0 used act-1s/2s/3s for plain "1s"/"2s"/"3s"). */
const GAME_MODE_IDS: Record<string, string> = {
  'ranked-1s': 'act-1s',
  'ranked-2s': 'act-2s',
  'ranked-3s': 'act-3s',
  'casual-1s': 'act-casual-1s',
  'casual-2s': 'act-casual-2s',
  'casual-3s': 'act-casual-3s',
  'honor-duel': 'act-honor-duel',
};

function gameModeActivity(key: string, name: string, sectionId: string, order: number, now: string): Activity {
  return {
    id: GAME_MODE_IDS[key] ?? uid(),
    sectionId,
    name,
    key,
    defaultMeasure: 'amount',
    builtIn: true,
    order,
    createdAt: now,
  };
}

export function createDefaultData(): AppData {
  const now = new Date().toISOString();
  const training: Section = { id: 'sec-training', name: 'Training', color: '#3b82f6', builtIn: true, kind: 'training', order: 0 };
  const games: Section = { id: 'sec-games', name: 'Games', color: '#f97316', builtIn: true, kind: 'games', order: 1 };
  return {
    version: DATA_VERSION,
    seasons: [],
    sections: [training, games],
    routines: [],
    activities: [
      {
        id: 'act-freeplay',
        sectionId: training.id,
        name: 'Freeplay',
        defaultMeasure: 'time',
        builtIn: true,
        order: 0,
        createdAt: now,
      },
      ...DEFAULT_GAME_MODES.map((m, i) => gameModeActivity(m.key, m.name, games.id, i, now)),
    ],
    accounts: [],
    matches: [],
    notifications: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

// ---------------------------------------------------------------- load + migrate

/** Fill in anything missing from older / imported files and migrate them to the current schema. */
export function normalizeData(raw: any): AppData {
  const base = createDefaultData();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.seasons)) return base;
  const fromVersion = typeof raw.version === 'number' ? raw.version : 1;
  const data: AppData = {
    version: DATA_VERSION,
    seasons: raw.seasons ?? [],
    sections: Array.isArray(raw.sections) && raw.sections.length ? raw.sections : base.sections,
    activities: Array.isArray(raw.activities) ? raw.activities : base.activities,
    routines: Array.isArray(raw.routines) ? raw.routines : [],
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    matches: Array.isArray(raw.matches) ? raw.matches : [],
    notifications: Array.isArray(raw.notifications) ? raw.notifications : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
  for (const k of REMOVED_SETTINGS) delete (data.settings as any)[k];
  data.settings.favorites = (data.settings.favorites ?? []).filter((f) => typeof f === 'string' && !f.startsWith('mmr:'));

  for (const s of data.seasons) {
    s.days = (s.days ?? []).map((d: Day) => ({ ...d, entries: d.entries ?? [] }));
    for (const d of s.days) {
      // 1.4: times are always minutes (the "hours" unit is gone; minutes were always stored).
      for (const e of d.entries) delete (e as any).unit;
      if (d.routines !== undefined) {
        d.routines = Array.isArray(d.routines) ? d.routines.filter((r) => r && Array.isArray(r.items)) : [];
        if (!d.routines.length) delete d.routines;
      }
    }
    sortDays(s);
  }
  data.routines = data.routines
    .filter((r: any) => r && typeof r === 'object')
    .map((r: any) => ({
      id: r.id ?? uid(),
      name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Routine',
      items: (Array.isArray(r.items) ? r.items : []).filter((i: any) => i && i.activityId && i.minutes > 0).map((i: any) => ({ ...i, id: i.id ?? uid() })),
      createdAt: r.createdAt ?? new Date().toISOString(),
    }));
  // Guarantee the two built-in top-level sections exist.
  for (const sec of base.sections) {
    if (!data.sections.some((s) => s.kind === sec.kind && !s.parentId)) data.sections.push(sec);
  }
  // Sub-sections: drop links to missing parents (and loops), and inherit the top section's kind.
  const byId = new Map(data.sections.map((s) => [s.id, s]));
  for (const s of data.sections) {
    if (s.parentId && (!byId.has(s.parentId) || s.parentId === s.id || s.builtIn)) delete s.parentId;
  }
  for (const s of data.sections) {
    if (!s.parentId) continue;
    const path = sectionPath(data, s.id);
    if (path[0]?.parentId) delete s.parentId; // loop: make it top-level
    else s.kind = path[0]?.kind ?? 'other';
  }
  data.accounts = data.accounts.map((a: any) => {
    const names: string[] = Array.isArray(a.inGameNames) ? a.inGameNames : [];
    // 1.0 accounts had a tracker.gg username; it doubles as an in-game name.
    if (!names.length && typeof a.username === 'string' && a.username.trim()) names.push(a.username.trim());
    return {
      id: a.id ?? uid(),
      label: a.label ?? 'Account',
      platform: a.platform ?? 'other',
      inGameNames: names,
      primaryIds: Array.isArray(a.primaryIds) ? a.primaryIds : [],
      liveGame: a.liveGame !== false,
      color: a.color ?? SECTION_COLORS[0],
      createdAt: a.createdAt ?? new Date().toISOString(),
    };
  });
  for (const a of data.activities) {
    a.createdAt = a.createdAt ?? new Date().toISOString();
    delete (a as any).defaultUnit;
  }
  if (fromVersion < 2) migrateToV2(data);
  ensureActivityOrder(data);
  return data;
}

function allEntries(data: AppData) {
  const out: { season: Season; day: Day; entry: Entry }[] = [];
  for (const season of data.seasons) for (const day of season.days) for (const entry of day.entries) out.push({ season, day, entry });
  return out;
}

/** Move every entry and match of activity `from` to activity `to`, then delete `from`. */
function mergeActivities(data: AppData, from: Activity, to: Activity) {
  for (const { entry } of allEntries(data)) if (entry.activityId === from.id) entry.activityId = to.id;
  for (const m of data.matches) if (m.activityId === from.id) m.activityId = to.id;
  data.activities = data.activities.filter((a) => a.id !== from.id);
}

/**
 * 1.0 → 1.1:
 * - "1s/2s/3s" become "Ranked 1s/2s/3s"; Casual 1s/2s/3s and Honor Duel are added ("Playlist 53" becomes Honor Duel).
 * - Games wrongly logged from freeplay/training are removed.
 * - Same activity logged twice on one day is merged into one entry.
 * - tracker.gg leftovers are dropped.
 */
function migrateToV2(data: AppData) {
  const games = gamesSection(data);
  const now = new Date().toISOString();

  // Game mode keys + new names for the old plain modes.
  for (const a of data.activities) {
    if (a.sectionId !== games.id) continue;
    const key = a.key ?? keyForLegacyName(a.name);
    if (!key) continue;
    a.key = key;
    const def = DEFAULT_GAME_MODES.find((d) => d.key === key);
    if (def && /^(1s|2s|3s|playlist \d+)$/i.test(a.name.trim())) a.name = def.name;
    if (def) a.builtIn = true;
  }

  // The same mode/name twice in a section (e.g. "Honor Duel" + renamed "Playlist 53") becomes one activity.
  for (const a of [...data.activities]) {
    if (!data.activities.includes(a)) continue;
    const twin = data.activities.find(
      (b) =>
        b !== a &&
        b.sectionId === a.sectionId &&
        ((a.key && b.key === a.key) || b.name.trim().toLowerCase() === a.name.trim().toLowerCase()),
    );
    if (twin) {
      const keep = twin.builtIn && !a.builtIn ? twin : a;
      mergeActivities(data, keep === a ? twin : a, keep);
    }
  }

  // Add the default modes that are missing.
  for (const def of DEFAULT_GAME_MODES) {
    if (data.activities.some((a) => a.sectionId === games.id && a.key === def.key)) continue;
    const act = gameModeActivity(def.key, def.name, games.id, 0, now);
    if (data.activities.some((a) => a.id === act.id)) act.id = uid();
    data.activities.push(act);
  }

  // Remove games that were logged from freeplay / training / offline (no online match id).
  const bogus = data.matches.filter((m) => !m.guid || playlistInfo(m.playlistId).kind === 'practice');
  if (bogus.length) {
    const ids = new Set(bogus.map((m) => m.id));
    for (const m of bogus) {
      const day = data.seasons.find((s) => s.id === m.seasonId)?.days.find((d) => d.id === m.dayId);
      const entry = day?.entries.find((e) => e.id === m.entryId);
      if (!day || !entry || entry.measure !== 'amount') continue;
      entry.amount = Math.max(0, (entry.amount ?? 0) - 1);
      if (m.result === 'win' && entry.wins) entry.wins--;
      if (m.result === 'loss' && entry.losses) entry.losses--;
      if (entry.auto && !entry.amount) day.entries = day.entries.filter((e) => e !== entry);
    }
    data.matches = data.matches.filter((m) => !ids.has(m.id));
    const used = new Set(allEntries(data).map((x) => x.entry.activityId));
    data.activities = data.activities.filter(
      (a) => !(a.sectionId === games.id && !a.builtIn && !used.has(a.id) && PRACTICE_MODE_NAMES.has(a.name.trim().toLowerCase())),
    );
  }

  // Wins without losses meant "the rest were losses"; store both so merged entries add up.
  const gameActs = new Set(data.activities.filter((a) => a.sectionId === games.id).map((a) => a.id));
  for (const { entry } of allEntries(data)) {
    if ((entry.auto as any)?.source && (entry.auto as any).source !== 'game') entry.auto = { source: 'game', accountId: entry.auto?.accountId };
    if (entry.measure === 'amount' && gameActs.has(entry.activityId) && entry.wins !== undefined && entry.losses === undefined) {
      entry.losses = Math.max(0, (entry.amount ?? 0) - entry.wins);
    }
  }

  // One entry per activity per day.
  for (const season of data.seasons) {
    for (const day of season.days) {
      const kept: Entry[] = [];
      for (const e of day.entries) {
        const target = kept.find((k) => k.activityId === e.activityId && k.measure === e.measure);
        if (!target) {
          kept.push(e);
          continue;
        }
        mergeInto(target, e);
        for (const m of data.matches) if (m.entryId === e.id) m.entryId = target.id;
      }
      day.entries = kept;
    }
  }

  // Default order: built-in modes first (Ranked, Casual, Honor Duel), then the rest oldest → newest.
  for (const section of data.sections) {
    const acts = data.activities.filter((a) => a.sectionId === section.id);
    const rank = (a: Activity) => {
      const i = DEFAULT_GAME_MODES.findIndex((d) => d.key === a.key);
      if (section.kind === 'games' && i >= 0) return i;
      if (a.builtIn && section.kind !== 'games') return -1;
      return 1000;
    };
    acts.sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
    acts.forEach((a, i) => (a.order = i));
  }
}

/** Give activities without a position one at the end of their section (newest last). */
function ensureActivityOrder(data: AppData) {
  const missing = data.activities.filter((a) => typeof a.order !== 'number' || !Number.isFinite(a.order));
  missing.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const a of missing) a.order = nextActivityOrder(data, a.sectionId, a);
}

// ---------------------------------------------------------------- seasons & days

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

const dayHasContent = (d: Day) => d.entries.length > 0 || !!d.note?.trim();

/** Empty a day (its entries, notes and tracked matches). The day itself stays: days are only removed from the end. */
export function clearDay(data: AppData, seasonId: string, dayId: string) {
  const day = findSeason(data, seasonId)?.days.find((d) => d.id === dayId);
  if (!day) return 0;
  const n = day.entries.length;
  day.entries = [];
  delete day.note;
  delete day.hideRecord;
  data.matches = data.matches.filter((m) => m.dayId !== dayId);
  return n;
}

/** Remove the season's last day (the only day that can be removed). */
export function removeLastDay(data: AppData, seasonId: string): Day | null {
  const season = findSeason(data, seasonId);
  const last = season?.days[season.days.length - 1];
  if (!season || !last) return null;
  season.days.pop();
  data.matches = data.matches.filter((m) => m.dayId !== last.id);
  return last;
}

/** Add one day after the season's last day. */
export function addOneDay(data: AppData, seasonId: string): Day | null {
  const season = findSeason(data, seasonId);
  if (!season) return null;
  addDaysToSeason(season, 1);
  return season.days[season.days.length - 1];
}

/** Close a season: mark it completed and remove the remaining days after today (any with content are kept). */
export function closeSeason(data: AppData, seasonId: string, today = todayISO()) {
  const season = findSeason(data, seasonId);
  if (!season) return 0;
  season.status = 'closed';
  season.closedAt = new Date().toISOString();
  const before = season.days.length;
  season.days = season.days.filter((d) => d.date <= today || dayHasContent(d));
  return before - season.days.length;
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

// ---------------------------------------------------------------- sections & activities

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

/** The top-level Games section (where live matches are logged). */
export function gamesSection(data: AppData) {
  return data.sections.find((s) => s.kind === 'games' && !s.parentId) ?? data.sections.find((s) => s.kind === 'games')!;
}

/** Sections directly inside `parentId` (top-level sections when undefined), in the user's order. */
export function childSections(data: AppData, parentId?: string): Section[] {
  return data.sections.filter((s) => (s.parentId ?? undefined) === parentId).sort((a, b) => a.order - b.order);
}

/** All sections in tree order: each section followed by the sections inside it. */
export function sortedSections(data: AppData): Section[] {
  const out: Section[] = [];
  const walk = (parentId: string | undefined, seen: Set<string>) => {
    for (const s of childSections(data, parentId)) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      walk(s.id, seen);
    }
  };
  walk(undefined, new Set());
  return out;
}

/** Root → section, e.g. [Training, Freeplay]. */
export function sectionPath(data: AppData, sectionId: string): Section[] {
  const out: Section[] = [];
  let cur = sectionById(data, sectionId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? sectionById(data, cur.parentId) : undefined;
  }
  return out;
}

/** "Training › Freeplay" */
export function sectionLabel(data: AppData, sectionId: string, sep = ' › ') {
  return sectionPath(data, sectionId)
    .map((s) => s.name)
    .join(sep);
}

export function sectionDepth(data: AppData, sectionId: string) {
  return Math.max(0, sectionPath(data, sectionId).length - 1);
}

/** The section and every section inside it (any depth). */
export function descendantSectionIds(data: AppData, sectionId: string): Set<string> {
  const ids = new Set<string>([sectionId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of data.sections) {
      if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) {
        ids.add(s.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** "Training › Freeplay · Flicks" */
export function activityLabel(data: AppData, activityId: string) {
  const a = activityById(data, activityId);
  if (!a) return 'Unknown';
  return `${sectionLabel(data, a.sectionId)} · ${a.name}`;
}

/** Create a section, optionally inside another one (it then inherits its kind and color). */
export function createSection(data: AppData, name: string, color: string, parentId?: string): Section {
  const parent = parentId ? sectionById(data, parentId) : undefined;
  const siblings = childSections(data, parent?.id);
  const section: Section = {
    id: uid(),
    name: name.trim(),
    color,
    kind: parent ? parent.kind ?? 'other' : 'other',
    parentId: parent?.id,
    order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
  };
  data.sections.push(section);
  return section;
}

/**
 * Turn an activity into a section with the same name, in the same place. Everything logged so far
 * moves to an "Overall" activity inside it, so nothing is lost (e.g. Freeplay → Freeplay › Overall).
 */
export function activityToSection(data: AppData, activityId: string, innerName = 'Overall'): Section | null {
  const a = activityById(data, activityId);
  const parent = a ? sectionById(data, a.sectionId) : undefined;
  if (!a || !parent) return null;
  const section = createSection(data, a.name, parent.color, parent.id);
  a.sectionId = section.id;
  a.name = innerName;
  a.order = 0;
  a.builtIn = false;
  return section;
}

/** Delete a section with everything inside it. Returns how many activities were removed. */
export function deleteSectionTree(data: AppData, sectionId: string) {
  const ids = descendantSectionIds(data, sectionId);
  const acts = new Set(data.activities.filter((a) => ids.has(a.sectionId)).map((a) => a.id));
  data.sections = data.sections.filter((s) => !ids.has(s.id));
  data.activities = data.activities.filter((a) => !acts.has(a.id));
  for (const s of data.seasons) for (const d of s.days) d.entries = d.entries.filter((e) => !acts.has(e.activityId));
  data.matches = data.matches.filter((m) => !acts.has(m.activityId));
  dropActivitiesFromRoutines(data, acts);
  return acts.size;
}

/** Deleted activities leave the saved routines (routines already started on a day keep them). */
export function dropActivitiesFromRoutines(data: AppData, ids: Set<string>) {
  for (const r of data.routines) r.items = r.items.filter((i) => !ids.has(i.activityId));
}

/** Move a section among its siblings. */
export function moveSection(data: AppData, sectionId: string, index: number) {
  const s = sectionById(data, sectionId);
  if (!s) return;
  const list = childSections(data, s.parentId).filter((x) => x.id !== s.id);
  list.splice(Math.max(0, Math.min(list.length, index)), 0, s);
  list.forEach((x, i) => (x.order = i));
}

/** A section's activities in the user's order. */
export function sectionActivities(data: AppData, sectionId: string): Activity[] {
  return data.activities
    .filter((a) => a.sectionId === sectionId)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function nextActivityOrder(data: AppData, sectionId: string, except?: Activity) {
  const orders = data.activities
    .filter((a) => a.sectionId === sectionId && a !== except && typeof a.order === 'number' && Number.isFinite(a.order))
    .map((a) => a.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

/** Move an activity to position `index` inside its section and renumber the section. */
export function moveActivity(data: AppData, activityId: string, index: number) {
  const a = activityById(data, activityId);
  if (!a) return;
  const list = sectionActivities(data, a.sectionId).filter((x) => x.id !== a.id);
  const at = Math.max(0, Math.min(list.length, index));
  list.splice(at, 0, a);
  list.forEach((x, i) => (x.order = i));
}

export function isHonorDuel(a: Activity | undefined) {
  return a?.key === HONOR_DUEL_KEY;
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

/** Find an activity by key (game modes) or name in a section, or create it at the end of the section. */
export function findOrCreateActivity(
  data: AppData,
  sectionId: string,
  name: string,
  measure: Measure,
  key?: string,
): Activity {
  const trimmed = name.trim();
  if (key) {
    // A game mode may live in a sub-section (e.g. after "turn into section"), so look in the whole tree.
    const tree = descendantSectionIds(data, sectionId);
    const byKey = data.activities.find((a) => tree.has(a.sectionId) && a.key === key);
    if (byKey) return byKey;
  }
  const existing = data.activities.find((a) => a.sectionId === sectionId && a.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    if (key && !existing.key) existing.key = key;
    return existing;
  }
  const activity: Activity = {
    id: uid(),
    sectionId,
    name: trimmed,
    key,
    defaultMeasure: measure,
    order: nextActivityOrder(data, sectionId),
    createdAt: new Date().toISOString(),
  };
  data.activities.push(activity);
  return activity;
}

// ---------------------------------------------------------------- entries

export type EntryInput = Omit<Entry, 'id' | 'createdAt'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Add `add` onto `target` (same activity + measure): times and amounts are summed, results are
 * summed, descriptions are kept.
 */
export function mergeInto(target: Entry, add: EntryInput | Entry) {
  if (target.measure === 'time') {
    target.minutes = round2((target.minutes ?? 0) + (add.minutes ?? 0));
  } else {
    target.amount = (target.amount ?? 0) + (add.amount ?? 0);
    if (add.wins !== undefined || add.losses !== undefined) {
      target.wins = (target.wins ?? 0) + (add.wins ?? 0);
      target.losses = (target.losses ?? 0) + (add.losses ?? 0);
    }
  }
  const notes = [target.note, add.note].map((n) => n?.trim()).filter((n): n is string => !!n);
  target.note = notes.length ? [...new Set(notes)].join('\n') : undefined;
  if (add.auto) {
    if (!target.auto) target.auto = { source: 'game', accountId: add.auto.accountId };
    else if (target.auto.accountId !== add.auto.accountId) target.auto = { source: 'game' };
  }
}

/** The day's entry that new values for this activity + measure are added to, if any. */
export function findDayEntry(day: Day, activityId: string, measure: Measure, excludeId?: string) {
  return day.entries.find((e) => e.id !== excludeId && e.activityId === activityId && e.measure === measure);
}

/** Add to the day's existing entry for the same activity and measure, or create a new one. */
export function addToDay(day: Day, input: EntryInput): { entry: Entry; merged: boolean } {
  const target = findDayEntry(day, input.activityId, input.measure);
  if (target) {
    mergeInto(target, input);
    return { entry: target, merged: true };
  }
  const entry = newEntry(input);
  day.entries.push(entry);
  return { entry, merged: false };
}

export function entryValue(e: Entry, measure: Measure): number {
  if (e.measure !== measure) return 0;
  return measure === 'time' ? e.minutes ?? 0 : e.amount ?? 0;
}

export function describeEntry(e: Entry): string {
  if (e.measure === 'time') return `${+(e.minutes ?? 0).toFixed(1)} min`;
  return `${e.amount ?? 0}`;
}

export function isToday(date: string) {
  return date === todayISO();
}

export function newEntry(partial: EntryInput): Entry {
  return { id: uid(), createdAt: new Date().toISOString(), ...partial };
}

// ---------------------------------------------------------------- routines

export function routineById(data: AppData, id: string) {
  return data.routines.find((r) => r.id === id);
}

export function routineMinutes(items: { minutes: number }[]) {
  return items.reduce((a, i) => a + (i.minutes > 0 ? i.minutes : 0), 0);
}

/** Save a new routine (items without an activity or time are dropped). */
export function createRoutine(data: AppData, name: string, items: Omit<RoutineItem, 'id'>[]): Routine {
  const routine: Routine = {
    id: uid(),
    name: name.trim() || 'Routine',
    items: items.filter((i) => i.activityId && i.minutes > 0).map((i) => ({ ...i, id: uid(), note: i.note?.trim() || undefined })),
    createdAt: new Date().toISOString(),
  };
  data.routines.push(routine);
  return routine;
}

/** Start a routine on a day: its items are copied onto the day, ready to be ticked off. */
export function startRoutineOnDay(day: Day, routine: Routine): DayRoutine {
  const dr: DayRoutine = {
    id: uid(),
    routineId: routine.id,
    name: routine.name,
    items: routine.items.map((i) => ({ ...i, id: uid() })),
    startedAt: new Date().toISOString(),
    autoNext: true,
  };
  day.routines = [...(day.routines ?? []), dr];
  return dr;
}

export function findDayRoutine(day: Day, dayRoutineId: string) {
  return day.routines?.find((r) => r.id === dayRoutineId);
}

/** The first item that isn't done yet. */
export function nextRoutineItem(dr: DayRoutine) {
  return dr.items.find((i) => !i.done);
}

export function routineProgress(dr: DayRoutine) {
  const done = dr.items.filter((i) => i.done);
  return {
    done: done.length,
    total: dr.items.length,
    minutesDone: done.reduce((a, i) => a + (i.loggedMinutes ?? i.minutes), 0),
    minutesTotal: routineMinutes(dr.items),
    complete: dr.items.length > 0 && done.length === dr.items.length,
  };
}

/**
 * Tick off a routine item and add its time to the day (`minutes` defaults to the planned time,
 * a timer passes what was actually done). Returns false if it was already done.
 */
export function completeRoutineItem(day: Day, dayRoutineId: string, itemId: string, minutes?: number, note?: string) {
  const item = findDayRoutine(day, dayRoutineId)?.items.find((i) => i.id === itemId);
  if (!item || item.done) return false;
  const m = round2(minutes ?? item.minutes);
  item.done = true;
  item.loggedMinutes = m;
  if (m > 0) addToDay(day, { activityId: item.activityId, measure: 'time', minutes: m, note: note ?? item.note });
  return true;
}

/** Untick a routine item and take the time it added off the day again. */
export function undoRoutineItem(day: Day, dayRoutineId: string, itemId: string) {
  const item = findDayRoutine(day, dayRoutineId)?.items.find((i) => i.id === itemId);
  if (!item || !item.done) return false;
  const m = item.loggedMinutes ?? 0;
  const entry = findDayEntry(day, item.activityId, 'time');
  if (entry && m > 0) {
    entry.minutes = round2(Math.max(0, (entry.minutes ?? 0) - m));
    if (!entry.minutes && !entry.auto) day.entries = day.entries.filter((e) => e !== entry);
  }
  item.done = false;
  delete item.loggedMinutes;
  return true;
}

/** Take a routine off a day. What it already logged stays on the day. */
export function removeDayRoutine(day: Day, dayRoutineId: string) {
  day.routines = (day.routines ?? []).filter((r) => r.id !== dayRoutineId);
  if (!day.routines.length) delete day.routines;
}
