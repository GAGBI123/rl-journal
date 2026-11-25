// Statistics engine: builds a scoped context and a catalogue of stat definitions.
import type { Activity, AppData, Day, Entry, MatchRecord, Measure, Season, Section } from '../../shared/model';
import { addDays, diffDays, formatDate, todayISO, weekStart, weekdayIndex, WEEKDAYS_LONG } from './dates';
import { fmtMinutes, fmtNum, fmtPct, plural } from './format';
import { childSections, descendantSectionIds, isHonorDuel, seasonLabel, sectionActivities, sectionById, sectionLabel, sectionPath, sortedSections } from './journal';
import { HONOR_DUEL_KEY } from '../../shared/playlists';

export type Scope = { kind: 'all' } | { kind: 'season'; seasonId: string };

export interface FlatEntry {
  entry: Entry;
  date: string;
  season: Season;
  day: Day;
  activity?: Activity;
  section?: Section;
}

export interface StatsCtx {
  data: AppData;
  scope: Scope;
  today: string;
  seasons: Season[];
  /** Unique calendar dates in scope that have already happened. */
  elapsedDates: string[];
  entries: FlatEntry[];
  matches: MatchRecord[];
  /** Whether "this week"-style stats make sense (scope includes today). */
  live: boolean;
}

export interface StatValue {
  value: string;
  sub?: string;
  trend?: 'up' | 'down' | 'flat';
  breakdown?: { label: string; value: string; raw: number; color?: string }[];
  empty?: boolean;
}

export interface StatDef {
  id: string;
  label: string;
  category: StatCategory;
  group?: string;
  hint?: string;
  compute: (ctx: StatsCtx) => StatValue | null;
}

export const CATEGORIES = ['Overview', 'Training', 'Games', 'Sections', 'Consistency', 'Records', 'Activities', 'Live games'] as const;
export type StatCategory = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------- context

export function buildContext(data: AppData, scope: Scope, today = todayISO()): StatsCtx {
  const seasons = scope.kind === 'all' ? data.seasons : data.seasons.filter((s) => s.id === scope.seasonId);
  const actById = new Map(data.activities.map((a) => [a.id, a]));
  const secById = new Map(data.sections.map((s) => [s.id, s]));
  const entries: FlatEntry[] = [];
  const dates = new Set<string>();
  for (const season of seasons) {
    for (const day of season.days) {
      if (day.date <= today) dates.add(day.date);
      for (const entry of day.entries) {
        const activity = actById.get(entry.activityId);
        entries.push({ entry, date: day.date, season, day, activity, section: activity ? secById.get(activity.sectionId) : undefined });
      }
    }
  }
  const seasonIds = new Set(seasons.map((s) => s.id));
  return {
    data,
    scope,
    today,
    seasons,
    elapsedDates: [...dates].sort(),
    entries,
    matches: data.matches.filter((m) => seasonIds.has(m.seasonId)),
    live: seasons.some((s) => s.status === 'active' && s.days.some((d) => d.date === today)),
  };
}

// ---------------------------------------------------------------- helpers

type Pred = (f: FlatEntry) => boolean;
const isTraining: Pred = (f) => f.section?.kind === 'training';
const isGames: Pred = (f) => f.section?.kind === 'games';
const isHonor: Pred = (f) => f.activity?.key === HONOR_DUEL_KEY;
const isRanked: Pred = (f) => !!f.activity?.key?.startsWith('ranked-');
const isCasual: Pred = (f) => !!f.activity?.key?.startsWith('casual-');
const ofActivity = (id: string): Pred => (f) => f.entry.activityId === id;
/** Entries in a section or any section inside it. */
const inTree = (ids: Set<string>): Pred => (f) => !!f.section && ids.has(f.section.id);

/** "Flicks" for top-level activities, "Freeplay › Flicks" inside a sub-section. */
export function shortActivityName(data: AppData, a: Activity) {
  const sec = sectionById(data, a.sectionId);
  return sec?.parentId ? `${sec.name} › ${a.name}` : a.name;
}

const val = (f: FlatEntry, m: Measure) =>
  f.entry.measure !== m ? 0 : m === 'time' ? f.entry.minutes ?? 0 : f.entry.amount ?? 0;

function sum(list: FlatEntry[], m: Measure) {
  let t = 0;
  for (const f of list) t += val(f, m);
  return t;
}

function where(ctx: StatsCtx, ...preds: Pred[]) {
  return ctx.entries.filter((f) => preds.every((p) => p(f)));
}

function measured(list: FlatEntry[], m: Measure) {
  return list.filter((f) => f.entry.measure === m && val(f, m) > 0);
}

function byDate(list: FlatEntry[], m: Measure) {
  const map = new Map<string, number>();
  for (const f of list) {
    const v = val(f, m);
    if (v > 0) map.set(f.date, (map.get(f.date) ?? 0) + v);
  }
  return map;
}

function between(list: FlatEntry[], from: string, to: string) {
  return list.filter((f) => f.date >= from && f.date <= to);
}

function fmt(m: Measure, v: number, unit = '') {
  return m === 'time' ? fmtMinutes(v) : `${fmtNum(v, 1)}${unit}`;
}

function compare(cur: number, prev: number, m: Measure, label: string): Pick<StatValue, 'sub' | 'trend'> {
  const d = cur - prev;
  if (!prev && !cur) return { sub: `Nothing ${label}`, trend: 'flat' };
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '•';
  const text = m === 'time' ? fmtMinutes(Math.abs(d)) : fmtNum(Math.abs(d), 1);
  return { sub: `${arrow} ${text} vs ${label}`, trend: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}

function winStats(list: FlatEntry[]) {
  let wins = 0;
  let decided = 0;
  for (const f of list) {
    const e = f.entry;
    if (e.measure !== 'amount' || e.wins === undefined) continue;
    wins += e.wins;
    decided += e.losses !== undefined ? e.wins + e.losses : e.amount ?? 0;
  }
  return { wins, decided, losses: decided - wins, rate: decided ? wins / decided : undefined };
}

function streaks(dates: string[], today: string) {
  const sorted = [...new Set(dates)].sort();
  let longest = 0;
  let longestEnd = '';
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && diffDays(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    if (run > longest) {
      longest = run;
      longestEnd = sorted[i];
    }
  }
  const set = new Set(sorted);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, longestEnd };
}

function maxEntry<T>(map: Map<T, number>): [T, number] | null {
  let best: [T, number] | null = null;
  for (const [k, v] of map) if (!best || v > best[1]) best = [k, v];
  return best;
}

const empty = (value = '—', sub?: string): StatValue => ({ value, sub, empty: true });
const days = (ctx: StatsCtx) => Math.max(1, ctx.elapsedDates.length);

// ---------------------------------------------------------------- static stats

const STATIC: StatDef[] = [
  // Overview
  {
    id: 'overview.totalTime',
    label: 'Total time logged',
    category: 'Overview',
    hint: 'All time-based activities across every section',
    compute: (c) => {
      const t = sum(c.entries, 'time');
      return t ? { value: fmtMinutes(t), sub: `${plural(measured(c.entries, 'time').length, 'session')}` } : empty('0m');
    },
  },
  {
    id: 'overview.entries',
    label: 'Activities logged',
    category: 'Overview',
    compute: (c) => ({ value: fmtNum(c.entries.length), sub: `${plural(new Set(c.entries.map((f) => f.date)).size, 'day')} with activity` }),
  },
  {
    id: 'overview.activityRate',
    label: 'Activity rate',
    category: 'Overview',
    hint: 'Share of days so far with anything logged',
    compute: (c) => {
      if (!c.elapsedDates.length) return empty();
      const active = new Set(c.entries.map((f) => f.date).filter((d) => d <= c.today)).size;
      return { value: fmtPct(active / c.elapsedDates.length), sub: `${active} of ${c.elapsedDates.length} days` };
    },
  },
  {
    id: 'overview.dailyAvgTime',
    label: 'Daily average time (all)',
    category: 'Overview',
    compute: (c) => {
      const t = sum(c.entries.filter((f) => f.date <= c.today), 'time');
      return t ? { value: fmtMinutes(t / days(c)), sub: `over ${plural(c.elapsedDates.length, 'day')}` } : empty('0m');
    },
  },
  {
    id: 'overview.timeBySection',
    label: 'Time by section',
    category: 'Overview',
    compute: (c) => {
      // Top-level sections, each including the sections inside it.
      const breakdown = childSections(c.data, undefined)
        .map((s) => ({ s, t: sum(where(c, inTree(descendantSectionIds(c.data, s.id))), 'time') }))
        .filter((x) => x.t > 0)
        .map((x) => ({ label: x.s.name, value: fmtMinutes(x.t), raw: x.t, color: x.s.color }));
      return breakdown.length ? { value: fmtMinutes(breakdown.reduce((a, b) => a + b.raw, 0)), breakdown } : empty();
    },
  },
  {
    id: 'overview.seasonProgress',
    label: 'Season progress',
    category: 'Overview',
    compute: (c) => {
      if (c.scope.kind !== 'season' || !c.seasons[0]) {
        const done = c.data.seasons.filter((s) => s.status === 'closed').length;
        return { value: `${done} / ${c.data.seasons.length}`, sub: 'seasons completed' };
      }
      const s = c.seasons[0];
      if (s.status === 'closed') return { value: 'Completed', sub: `${s.days.length} days` };
      const elapsed = s.days.filter((d) => d.date <= c.today).length;
      return { value: `Day ${Math.min(elapsed, s.days.length)} / ${s.days.length}`, sub: `${s.days.length - elapsed} days left` };
    },
  },

  // Training
  {
    id: 'training.totalTime',
    label: 'Total training time',
    category: 'Training',
    hint: 'Every activity in the Training section',
    compute: (c) => {
      const t = sum(where(c, isTraining), 'time');
      return t ? { value: fmtMinutes(t), sub: `${fmtNum(Math.round(t))} minutes · ${plural(measured(where(c, isTraining), 'time').length, 'session')}` } : empty('0m');
    },
  },
  {
    id: 'training.dailyAvg',
    label: 'Daily average training',
    category: 'Training',
    hint: 'Training time divided by every day so far (rest days included)',
    compute: (c) => {
      const t = sum(where(c, isTraining, (f) => f.date <= c.today), 'time');
      return { value: fmtMinutes(t / days(c)), sub: `over ${plural(c.elapsedDates.length, 'day')}`, empty: !t };
    },
  },
  {
    id: 'training.avgActiveDay',
    label: 'Average on training days',
    category: 'Training',
    compute: (c) => {
      const map = byDate(where(c, isTraining), 'time');
      if (!map.size) return empty();
      const t = [...map.values()].reduce((a, b) => a + b, 0);
      return { value: fmtMinutes(t / map.size), sub: `${plural(map.size, 'training day')}` };
    },
  },
  {
    id: 'training.sessions',
    label: 'Training sessions',
    category: 'Training',
    compute: (c) => {
      const list = measured(where(c, isTraining), 'time');
      if (!list.length) return empty('0');
      return { value: fmtNum(list.length), sub: `avg ${fmtMinutes(sum(list, 'time') / list.length)} per session` };
    },
  },
  {
    id: 'training.thisWeek',
    label: 'Training this week',
    category: 'Training',
    compute: (c) => {
      if (!c.live) return null;
      const ws = weekStart(c.today);
      const list = where(c, isTraining);
      const cur = sum(between(list, ws, c.today), 'time');
      const prev = sum(between(list, addDays(ws, -7), addDays(ws, -1)), 'time');
      return { value: fmtMinutes(cur), ...compare(cur, prev, 'time', 'last week') };
    },
  },
  {
    id: 'training.last7',
    label: 'Training last 7 days',
    category: 'Training',
    compute: (c) => {
      if (!c.live) return null;
      const list = where(c, isTraining);
      const cur = sum(between(list, addDays(c.today, -6), c.today), 'time');
      const prev = sum(between(list, addDays(c.today, -13), addDays(c.today, -7)), 'time');
      return { value: fmtMinutes(cur), ...compare(cur, prev, 'time', 'previous 7') };
    },
  },
  {
    id: 'training.byActivity',
    label: 'Training time by drill',
    category: 'Training',
    compute: (c) => {
      const map = new Map<Activity, number>();
      for (const f of where(c, isTraining)) {
        if (!f.activity) continue;
        map.set(f.activity, (map.get(f.activity) ?? 0) + val(f, 'time'));
      }
      const breakdown = [...map]
        .filter(([, t]) => t > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([a, t]) => ({ label: shortActivityName(c.data, a), value: fmtMinutes(t), raw: t }));
      return breakdown.length ? { value: breakdown[0].label, sub: 'most trained', breakdown } : empty();
    },
  },
  {
    id: 'training.share',
    label: 'Training share of time',
    category: 'Training',
    hint: 'Training time compared with all time logged',
    compute: (c) => {
      const all = sum(c.entries, 'time');
      if (!all) return empty();
      const t = sum(where(c, isTraining), 'time');
      return { value: fmtPct(t / all), sub: `${fmtMinutes(t)} of ${fmtMinutes(all)}` };
    },
  },

  // Games
  {
    id: 'games.total',
    label: 'Total games (all modes)',
    category: 'Games',
    compute: (c) => {
      const n = sum(where(c, isGames), 'amount');
      return n ? { value: fmtNum(n), sub: `${plural(byDate(where(c, isGames), 'amount').size, 'day')} with games` } : empty('0');
    },
  },
  {
    id: 'games.byMode',
    label: 'Games by mode',
    category: 'Games',
    compute: (c) => {
      const map = new Map<Activity, number>();
      for (const f of where(c, isGames)) {
        if (!f.activity) continue;
        map.set(f.activity, (map.get(f.activity) ?? 0) + val(f, 'amount'));
      }
      const total = [...map.values()].reduce((a, b) => a + b, 0);
      const breakdown = [...map]
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([a, n]) => ({ label: a.name, value: `${fmtNum(n)} · ${fmtPct(n / total)}`, raw: n }));
      return breakdown.length ? { value: fmtNum(total), sub: 'games', breakdown } : empty('0');
    },
  },
  {
    id: 'games.dailyAvg',
    label: 'Daily average games',
    category: 'Games',
    compute: (c) => {
      const n = sum(where(c, isGames, (f) => f.date <= c.today), 'amount');
      return { value: fmtNum(n / days(c), 1), sub: `over ${plural(c.elapsedDates.length, 'day')}`, empty: !n };
    },
  },
  {
    id: 'games.avgActiveDay',
    label: 'Average on game days',
    category: 'Games',
    compute: (c) => {
      const map = byDate(where(c, isGames), 'amount');
      if (!map.size) return empty();
      const n = [...map.values()].reduce((a, b) => a + b, 0);
      return { value: fmtNum(n / map.size, 1), sub: `games per day played (${map.size} days)` };
    },
  },
  {
    id: 'games.mostPlayed',
    label: 'Most played mode',
    category: 'Games',
    compute: (c) => {
      const map = new Map<string, number>();
      for (const f of where(c, isGames)) if (f.activity) map.set(f.activity.name, (map.get(f.activity.name) ?? 0) + val(f, 'amount'));
      const best = maxEntry(map);
      if (!best || !best[1]) return empty();
      const total = [...map.values()].reduce((a, b) => a + b, 0);
      return { value: best[0], sub: `${plural(best[1], 'game')} · ${fmtPct(best[1] / total)} of all games` };
    },
  },
  {
    id: 'games.winRate',
    label: 'Win rate',
    category: 'Games',
    hint: 'From games where wins were recorded',
    compute: (c) => {
      const w = winStats(where(c, isGames));
      return w.rate === undefined ? empty('—', 'Add wins to game entries') : { value: fmtPct(w.rate, 1), sub: `${w.wins}W – ${w.losses}L` };
    },
  },
  {
    id: 'games.winRateByMode',
    label: 'Win rate by mode',
    category: 'Games',
    compute: (c) => {
      const groups = new Map<Activity, FlatEntry[]>();
      for (const f of where(c, isGames)) if (f.activity) groups.set(f.activity, [...(groups.get(f.activity) ?? []), f]);
      const breakdown = [...groups]
        .map(([a, list]) => ({ a, w: winStats(list) }))
        .filter((x) => x.w.rate !== undefined)
        .sort((x, y) => (y.w.rate ?? 0) - (x.w.rate ?? 0))
        .map((x) => ({ label: x.a.name, value: `${fmtPct(x.w.rate, 0)} · ${x.w.wins}W ${x.w.losses}L`, raw: x.w.rate ?? 0 }));
      return breakdown.length ? { value: breakdown[0].label, sub: 'best win rate', breakdown } : empty();
    },
  },
  {
    id: 'games.honorDuels',
    label: 'Honor duels',
    category: 'Games',
    compute: (c) => {
      const list = where(c, isGames, isHonor);
      const n = sum(list, 'amount');
      if (!n) return empty('0', 'No honor duels yet');
      const w = winStats(list);
      return { value: fmtNum(n), sub: w.rate === undefined ? plural(byDate(list, 'amount').size, 'day') : `${w.wins}W – ${w.losses}L · ${fmtPct(w.rate, 0)} won` };
    },
  },
  {
    id: 'games.rankedVsCasual',
    label: 'Ranked vs casual',
    category: 'Games',
    compute: (c) => {
      const ranked = where(c, isGames, isRanked);
      const casual = where(c, isGames, isCasual);
      const r = sum(ranked, 'amount');
      const k = sum(casual, 'amount');
      if (!r && !k) return empty();
      const wr = winStats(ranked);
      const wc = winStats(casual);
      return {
        value: `${fmtNum(r)} / ${fmtNum(k)}`,
        sub: 'ranked / casual games',
        breakdown: [
          { label: 'Ranked', value: `${fmtNum(r)}${wr.rate !== undefined ? ` · ${fmtPct(wr.rate, 0)} won` : ''}`, raw: r },
          { label: 'Casual', value: `${fmtNum(k)}${wc.rate !== undefined ? ` · ${fmtPct(wc.rate, 0)} won` : ''}`, raw: k },
        ],
      };
    },
  },
  {
    id: 'games.thisWeek',
    label: 'Games this week',
    category: 'Games',
    compute: (c) => {
      if (!c.live) return null;
      const ws = weekStart(c.today);
      const list = where(c, isGames);
      const cur = sum(between(list, ws, c.today), 'amount');
      const prev = sum(between(list, addDays(ws, -7), addDays(ws, -1)), 'amount');
      return { value: fmtNum(cur), ...compare(cur, prev, 'amount', 'last week') };
    },
  },
  {
    id: 'games.timePlayed',
    label: 'Time spent in games',
    category: 'Games',
    hint: 'Game entries logged as time',
    compute: (c) => {
      const t = sum(where(c, isGames), 'time');
      return t ? { value: fmtMinutes(t) } : empty('0m');
    },
  },
  {
    id: 'games.perTrainingHour',
    label: 'Games per training hour',
    category: 'Games',
    hint: 'How your games balance against training',
    compute: (c) => {
      const t = sum(where(c, isTraining), 'time');
      const g = sum(where(c, isGames), 'amount');
      if (!t || !g) return empty();
      return { value: fmtNum(g / (t / 60), 1), sub: `${fmtNum(g)} games · ${fmtMinutes(t)} training` };
    },
  },

  // Consistency
  {
    id: 'streak.current',
    label: 'Current streak',
    category: 'Consistency',
    hint: 'Consecutive days with anything logged',
    compute: (c) => {
      const s = streaks(c.entries.map((f) => f.date), c.today);
      return { value: plural(s.current, 'day'), sub: `Longest: ${plural(s.longest, 'day')}`, empty: !s.current };
    },
  },
  {
    id: 'streak.longest',
    label: 'Longest streak',
    category: 'Consistency',
    compute: (c) => {
      const s = streaks(c.entries.map((f) => f.date), c.today);
      return s.longest ? { value: plural(s.longest, 'day'), sub: `ended ${formatDate(s.longestEnd)}` } : empty();
    },
  },
  {
    id: 'streak.training',
    label: 'Training streak',
    category: 'Consistency',
    compute: (c) => {
      const s = streaks([...byDate(where(c, isTraining), 'time').keys()], c.today);
      return { value: plural(s.current, 'day'), sub: `Longest: ${plural(s.longest, 'day')}`, empty: !s.current && !s.longest };
    },
  },
  {
    id: 'consistency.restDays',
    label: 'Rest days',
    category: 'Consistency',
    hint: 'Days so far with nothing logged',
    compute: (c) => {
      if (!c.elapsedDates.length) return empty();
      const active = new Set(c.entries.map((f) => f.date));
      const rest = c.elapsedDates.filter((d) => !active.has(d)).length;
      return { value: fmtNum(rest), sub: `of ${plural(c.elapsedDates.length, 'day')}` };
    },
  },
  {
    id: 'consistency.bestWeekday',
    label: 'Most active weekday',
    category: 'Consistency',
    compute: (c) => {
      const totals = new Array(7).fill(0);
      for (const f of c.entries) totals[weekdayIndex(f.date)] += val(f, 'time') || 0;
      if (!totals.some((t) => t > 0)) for (const f of c.entries) totals[weekdayIndex(f.date)] += 1;
      const max = Math.max(...totals);
      if (!max) return empty();
      const i = totals.indexOf(max);
      return {
        value: WEEKDAYS_LONG[i],
        breakdown: totals.map((t, d) => ({ label: WEEKDAYS_LONG[d].slice(0, 3), value: fmtMinutes(t), raw: t })),
      };
    },
  },
  {
    id: 'consistency.trainingDaysRate',
    label: 'Training days',
    category: 'Consistency',
    compute: (c) => {
      const n = byDate(where(c, isTraining, (f) => f.date <= c.today), 'time').size;
      if (!c.elapsedDates.length) return empty();
      return { value: fmtNum(n), sub: `${fmtPct(n / c.elapsedDates.length)} of days so far` };
    },
  },

  // Records
  {
    id: 'record.bestTrainingDay',
    label: 'Longest training day',
    category: 'Records',
    compute: (c) => {
      const best = maxEntry(byDate(where(c, isTraining), 'time'));
      return best ? { value: fmtMinutes(best[1]), sub: formatDate(best[0], { weekday: 'short', month: 'short', day: 'numeric' }) } : empty();
    },
  },
  {
    id: 'record.mostGamesDay',
    label: 'Most games in a day',
    category: 'Records',
    compute: (c) => {
      const best = maxEntry(byDate(where(c, isGames), 'amount'));
      return best ? { value: fmtNum(best[1]), sub: formatDate(best[0], { weekday: 'short', month: 'short', day: 'numeric' }) } : empty();
    },
  },
  {
    id: 'record.longestSession',
    label: 'Longest single session',
    category: 'Records',
    compute: (c) => {
      let best: FlatEntry | null = null;
      for (const f of measured(c.entries, 'time')) if (!best || val(f, 'time') > val(best, 'time')) best = f;
      return best
        ? { value: fmtMinutes(val(best, 'time')), sub: `${best.activity?.name ?? 'Unknown'} · ${formatDate(best.date)}` }
        : empty();
    },
  },
  {
    id: 'record.bestTrainingWeek',
    label: 'Best training week',
    category: 'Records',
    compute: (c) => {
      const map = new Map<string, number>();
      for (const [d, t] of byDate(where(c, isTraining), 'time')) map.set(weekStart(d), (map.get(weekStart(d)) ?? 0) + t);
      const best = maxEntry(map);
      return best ? { value: fmtMinutes(best[1]), sub: `week of ${formatDate(best[0])}` } : empty();
    },
  },
  {
    id: 'record.bestSeason',
    label: 'Most trained season',
    category: 'Records',
    compute: (c) => {
      if (c.scope.kind === 'season') return null;
      const map = new Map<Season, number>();
      for (const f of where(c, isTraining)) map.set(f.season, (map.get(f.season) ?? 0) + val(f, 'time'));
      const best = maxEntry(map);
      return best && best[1] ? { value: seasonLabel(best[0]), sub: fmtMinutes(best[1]) } : empty();
    },
  },

  // Live games (Stats API)
  {
    id: 'live.matches',
    label: 'Auto-tracked matches',
    category: 'Live games',
    hint: 'Games recorded from the live game connection',
    compute: (c) => {
      const list = c.matches;
      if (!list.length) return empty('0', 'Connect the game in Accounts & Sync');
      const w = list.filter((m) => m.result === 'win').length;
      const l = list.filter((m) => m.result === 'loss').length;
      return { value: fmtNum(list.length), sub: `${w}W – ${l}L${w + l ? ` · ${fmtPct(w / (w + l))}` : ''}` };
    },
  },
  ...(
    [
      ['goals', 'Goals per game'],
      ['assists', 'Assists per game'],
      ['saves', 'Saves per game'],
      ['shots', 'Shots per game'],
      ['score', 'Average score'],
      ['demos', 'Demos per game'],
    ] as const
  ).map(
    ([key, label]): StatDef => ({
      id: `live.${key}`,
      label,
      category: 'Live games',
      compute: (c) => {
        const list = c.matches.filter((m) => m.me);
        if (!list.length) return empty();
        const total = list.reduce((a, m) => a + (m.me?.[key] ?? 0), 0);
        return { value: fmtNum(total / list.length, key === 'score' ? 0 : 2), sub: `${fmtNum(total)} total in ${plural(list.length, 'game')}` };
      },
    }),
  ),
  {
    id: 'live.shootingPct',
    label: 'Shooting %',
    category: 'Live games',
    compute: (c) => {
      const list = c.matches.filter((m) => m.me);
      const shots = list.reduce((a, m) => a + (m.me?.shots ?? 0), 0);
      const goals = list.reduce((a, m) => a + (m.me?.goals ?? 0), 0);
      return shots ? { value: fmtPct(goals / shots, 1), sub: `${goals} goals from ${shots} shots` } : empty();
    },
  },
  {
    id: 'live.bestMatch',
    label: 'Best match score',
    category: 'Live games',
    compute: (c) => {
      let best: MatchRecord | null = null;
      for (const m of c.matches) if (m.me && (!best || m.me.score > (best.me?.score ?? 0))) best = m;
      return best?.me
        ? { value: fmtNum(best.me.score), sub: `${best.mode} · ${best.me.goals}G ${best.me.assists}A ${best.me.saves}S · ${formatDate(best.date)}` }
        : empty();
    },
  },
  {
    id: 'live.overtime',
    label: 'Overtime games',
    category: 'Live games',
    compute: (c) => {
      const ot = c.matches.filter((m) => m.overtime);
      if (!ot.length) return empty('0');
      const w = ot.filter((m) => m.result === 'win').length;
      return { value: fmtNum(ot.length), sub: `${w} won` };
    },
  },
];

// ---------------------------------------------------------------- dynamic stats

function activityStats(data: AppData): StatDef[] {
  const out: StatDef[] = [];
  for (const section of sortedSections(data)) {
    for (const a of sectionActivities(data, section.id)) {
      const group = `${sectionLabel(data, section.id)} · ${a.name}`;
      const name = shortActivityName(data, a);
      const games = section.kind === 'games';
      const list = (c: StatsCtx) => where(c, ofActivity(a.id));
      const measuresUsed = (c: StatsCtx) => {
        const l = list(c);
        const ms = new Set<Measure>(l.map((f) => f.entry.measure));
        if (!ms.size) ms.add(a.defaultMeasure);
        return ms;
      };
      out.push(
        {
          id: `act:${a.id}:time`,
          label: `${name} — total time`,
          category: 'Activities',
          group,
          compute: (c) => {
            if (!measuresUsed(c).has('time')) return null;
            const l = measured(list(c), 'time');
            return l.length ? { value: fmtMinutes(sum(l, 'time')), sub: `${plural(l.length, 'session')}` } : empty('0m');
          },
        },
        {
          id: `act:${a.id}:amount`,
          label: games ? `${name} — games played` : `${name} — total amount`,
          category: 'Activities',
          group,
          compute: (c) => {
            if (!measuresUsed(c).has('amount')) return null;
            const l = measured(list(c), 'amount');
            return l.length ? { value: fmtNum(sum(l, 'amount')), sub: `${plural(byDate(l, 'amount').size, 'day')}` } : empty('0');
          },
        },
        {
          id: `act:${a.id}:dailyAvg`,
          label: `${name} — daily average`,
          category: 'Activities',
          group,
          hint: 'Across all days so far',
          compute: (c) => {
            const ms = measuresUsed(c);
            const m: Measure = ms.has(a.defaultMeasure) ? a.defaultMeasure : [...ms][0];
            const t = sum(list(c).filter((f) => f.date <= c.today), m);
            return { value: fmt(m, m === 'time' ? t / days(c) : +(t / days(c)).toFixed(1)), empty: !t };
          },
        },
        {
          id: `act:${a.id}:activeAvg`,
          label: `${name} — average per day done`,
          category: 'Activities',
          group,
          compute: (c) => {
            const ms = measuresUsed(c);
            const m: Measure = ms.has(a.defaultMeasure) ? a.defaultMeasure : [...ms][0];
            const map = byDate(list(c), m);
            if (!map.size) return empty();
            const t = [...map.values()].reduce((x, y) => x + y, 0);
            return { value: fmt(m, m === 'time' ? t / map.size : +(t / map.size).toFixed(1)), sub: `${plural(map.size, 'day')}` };
          },
        },
        {
          id: `act:${a.id}:best`,
          label: `${name} — best day`,
          category: 'Activities',
          group,
          compute: (c) => {
            const ms = measuresUsed(c);
            const m: Measure = ms.has(a.defaultMeasure) ? a.defaultMeasure : [...ms][0];
            const best = maxEntry(byDate(list(c), m));
            return best ? { value: fmt(m, best[1]), sub: formatDate(best[0], { weekday: 'short', month: 'short', day: 'numeric' }) } : empty();
          },
        },
      );
      if (games) {
        out.push({
          id: `act:${a.id}:winRate`,
          label: `${name} — win rate`,
          category: 'Activities',
          group,
          compute: (c) => {
            const w = winStats(list(c));
            return w.rate === undefined ? empty() : { value: fmtPct(w.rate, 1), sub: `${w.wins}W – ${w.losses}L` };
          },
        });
      }
    }
  }
  return out;
}

/**
 * Stats per section, counting everything inside it (sections inside sections included):
 * total time / amount, daily average and a split by what's directly inside.
 */
function sectionStats(data: AppData): StatDef[] {
  const out: StatDef[] = [];
  for (const s of sortedSections(data)) {
    const subs = childSections(data, s.id);
    if (s.builtIn && !subs.length) continue; // Training / Games are covered by their own stats
    const path = sectionPath(data, s.id);
    const label = sectionLabel(data, s.id);
    const group = path[0]?.name ?? s.name;
    const games = s.kind === 'games';
    const list = (c: StatsCtx) => where(c, inTree(descendantSectionIds(c.data, s.id)));
    out.push(
      {
        id: `sec:${s.id}:time`,
        label: `${label} — total time`,
        category: 'Sections',
        group,
        hint: subs.length ? 'Includes the sections inside it' : undefined,
        compute: (c) => {
          const l = list(c);
          const t = sum(l, 'time');
          if (!t && games) return null;
          return t ? { value: fmtMinutes(t), sub: `${plural(byDate(l, 'time').size, 'day')} · daily avg ${fmtMinutes(t / days(c))}` } : empty('0m');
        },
      },
      {
        id: `sec:${s.id}:amount`,
        label: games ? `${label} — games played` : `${label} — total amount`,
        category: 'Sections',
        group,
        compute: (c) => {
          const n = sum(list(c), 'amount');
          return n ? { value: fmtNum(n), sub: `${plural(byDate(list(c), 'amount').size, 'day')}` } : null;
        },
      },
      {
        id: `sec:${s.id}:dailyAvg`,
        label: `${label} — daily average time`,
        category: 'Sections',
        group,
        hint: 'Across all days so far',
        compute: (c) => {
          const t = sum(list(c).filter((f) => f.date <= c.today), 'time');
          return t ? { value: fmtMinutes(t / days(c)), sub: `over ${plural(c.elapsedDates.length, 'day')}` } : null;
        },
      },
      {
        id: `sec:${s.id}:split`,
        label: `${label} — split`,
        category: 'Sections',
        group,
        hint: 'What the time inside this section went to',
        compute: (c) => {
          const m: Measure = games ? 'amount' : 'time';
          const parts = [
            ...childSections(c.data, s.id).map((sub) => ({
              label: sub.name,
              raw: sum(where(c, inTree(descendantSectionIds(c.data, sub.id))), m),
              color: sub.color,
            })),
            ...sectionActivities(c.data, s.id).map((a) => ({ label: a.name, raw: sum(where(c, ofActivity(a.id)), m), color: undefined as string | undefined })),
          ].filter((x) => x.raw > 0);
          if (parts.length < 2) return null;
          const total = parts.reduce((x, y) => x + y.raw, 0);
          parts.sort((a, b) => b.raw - a.raw);
          return {
            value: fmt(m, total, games ? ' games' : ''),
            sub: `most: ${parts[0].label}`,
            breakdown: parts.map((x) => ({ label: x.label, value: `${fmt(m, x.raw)} · ${fmtPct(x.raw / total)}`, raw: x.raw })),
          };
        },
      },
    );
  }
  return out;
}

export function allStats(data: AppData): StatDef[] {
  return [...STATIC, ...sectionStats(data), ...activityStats(data)];
}

export function statById(data: AppData, id: string): StatDef | undefined {
  return allStats(data).find((s) => s.id === id);
}

// ---------------------------------------------------------------- chart data

export interface TimelineBucket {
  key: string;
  label: string;
  training: number;
  games: number;
  gamesByActivity: Record<string, number>;
  isToday?: boolean;
}

/** Per-day buckets for a season, per-week buckets for all time. */
export function timeline(ctx: StatsCtx): { buckets: TimelineBucket[]; unit: 'day' | 'week' } {
  const unit: 'day' | 'week' = ctx.scope.kind === 'season' ? 'day' : 'week';
  const keys: string[] = [];
  if (unit === 'day') {
    const s = ctx.seasons[0];
    if (s) {
      for (const d of s.days) if (d.date <= ctx.today || s.status === 'closed') keys.push(d.date);
    }
  } else {
    const weeks = new Set(ctx.elapsedDates.map(weekStart));
    const sorted = [...weeks].sort();
    if (sorted.length) {
      for (let w = sorted[0]; w <= sorted[sorted.length - 1]; w = addDays(w, 7)) keys.push(w);
    }
  }
  const buckets = new Map<string, TimelineBucket>(
    keys.map((k) => [
      k,
      {
        key: k,
        label: unit === 'day' ? formatDate(k) : `Wk ${formatDate(k)}`,
        training: 0,
        games: 0,
        gamesByActivity: {},
        isToday: unit === 'day' && k === ctx.today,
      },
    ]),
  );
  for (const f of ctx.entries) {
    const b = buckets.get(unit === 'day' ? f.date : weekStart(f.date));
    if (!b) continue;
    if (f.section?.kind === 'training') b.training += val(f, 'time');
    if (f.section?.kind === 'games') {
      const n = val(f, 'amount');
      b.games += n;
      if (n) b.gamesByActivity[f.entry.activityId] = (b.gamesByActivity[f.entry.activityId] ?? 0) + n;
    }
  }
  return { buckets: [...buckets.values()], unit };
}

export interface SeasonSummary {
  season: Season;
  activeDays: number;
  training: number;
  games: number;
  winRate?: number;
  dailyTraining: number;
}

export function seasonSummaries(data: AppData, today = todayISO()): SeasonSummary[] {
  return [...data.seasons]
    .sort((a, b) => b.number - a.number)
    .map((season) => {
      const c = buildContext(data, { kind: 'season', seasonId: season.id }, today);
      const training = sum(where(c, isTraining), 'time');
      return {
        season,
        activeDays: new Set(c.entries.map((f) => f.date)).size,
        training,
        games: sum(where(c, isGames), 'amount'),
        winRate: winStats(where(c, isGames)).rate,
        dailyTraining: training / days(c),
      };
    });
}

export interface ModeResult {
  activityId: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
}

/** Quick per-day summary used on day cards and the day page. */
export function daySummary(data: AppData, day: Day) {
  let training = 0;
  let games = 0;
  let honorDuels = 0;
  let other = 0;
  /** Wins/losses per game mode, only for modes with recorded results (Honor Duel separate). */
  const results: ModeResult[] = [];
  let honor: { wins: number; losses: number; known: boolean } = { wins: 0, losses: 0, known: false };
  for (const e of day.entries) {
    const a = data.activities.find((x) => x.id === e.activityId);
    const s = a ? data.sections.find((x) => x.id === a.sectionId) : undefined;
    if (s?.kind === 'training' && e.measure === 'time') training += e.minutes ?? 0;
    else if (s?.kind === 'games' && e.measure === 'amount') {
      const n = e.amount ?? 0;
      games += n;
      const known = e.wins !== undefined || e.losses !== undefined;
      if (isHonorDuel(a)) {
        honorDuels += n;
        if (known) honor = { wins: honor.wins + (e.wins ?? 0), losses: honor.losses + (e.losses ?? 0), known: true };
      } else if (known && a) {
        const r = results.find((x) => x.activityId === a.id) ?? { activityId: a.id, name: a.name, games: 0, wins: 0, losses: 0 };
        if (!results.includes(r)) results.push(r);
        r.games += n;
        r.wins += e.wins ?? 0;
        r.losses += e.losses ?? 0;
      }
    } else other++;
  }
  const order = new Map(data.activities.map((a) => [a.id, a.order]));
  results.sort((x, y) => (order.get(x.activityId) ?? 0) - (order.get(y.activityId) ?? 0));
  return { training, games, normalGames: games - honorDuels, honorDuels, honor, results, other, count: day.entries.length };
}
