// End-of-season numbers for one season: shown on a completed season's page and at the end of its text export.
import type { AppData, Day, Season } from '../../shared/model';
import { HONOR_DUEL_KEY, modeRank, PRIVATE_KEYS } from '../../shared/playlists';
import { diffDays, todayISO } from './dates';
import { dayNumber, inRecord, matchInRecord, seasonEndDate } from './journal';

export interface ModeTotal {
  activityId: string;
  name: string;
  key?: string;
  games: number;
  wins: number;
  losses: number;
}

export interface DayRef {
  day: Day;
  number: number;
  value: number;
}

export interface SeasonRecap {
  season: Season;
  start: string;
  end: string;
  /** Days in the season (up to today for a season that's still going). */
  days: number;
  activeDays: number;
  trainingDays: number;
  gameDays: number;
  longestStreak: number;
  /** Minutes of training (sections of the Training kind). */
  training: number;
  topTraining: { name: string; minutes: number }[];
  /** Counted activities outside the games (e.g. shots from a training pack). */
  amounts: { name: string; amount: number }[];
  bestTrainingDay?: DayRef;
  /** Every game mode played, Ranked 1s/2s/3s first (Honor Duels and private matches included). */
  modes: ModeTotal[];
  /** Games without Honor Duels. */
  games: number;
  ranked: ModeTotal;
  casual: ModeTotal;
  honor: ModeTotal;
  /** All games whose result counts in the record (Honor Duels and, when left out, private matches excluded). */
  record: { wins: number; losses: number };
  mostGamesDay?: DayRef;
  tracked: {
    games: number;
    goals: number;
    assists: number;
    saves: number;
    shots: number;
    demos: number;
    overtime: number;
    overtimeWins: number;
    best?: { score: number; mode: string; date: string; goals: number; assists: number; saves: number };
  };
  /** Games per account (tracked matches), when 2+ accounts played. */
  accounts: { label: string; color: string; games: number; wins: number; losses: number }[];
}

const total = (name: string, activityId = ''): ModeTotal => ({ activityId, name, games: 0, wins: 0, losses: 0 });

export function seasonRecap(data: AppData, season: Season, today = todayISO()): SeasonRecap {
  const acts = new Map(data.activities.map((a) => [a.id, a]));
  const secs = new Map(data.sections.map((s) => [s.id, s]));
  const last = season.status === 'closed' ? seasonEndDate(season) ?? today : today;
  const days = season.days.filter((d) => d.date <= last);
  const modes = new Map<string, ModeTotal>();
  const trainingBy = new Map<string, number>();
  const amountBy = new Map<string, number>();
  const ranked = total('Ranked');
  const casual = total('Casual');
  const honor = total('Honor Duel');
  const record = { wins: 0, losses: 0 };
  let training = 0;
  let games = 0;
  let activeDays = 0;
  let trainingDays = 0;
  let gameDays = 0;
  let bestTrainingDay: DayRef | undefined;
  let mostGamesDay: DayRef | undefined;
  const active: string[] = [];

  for (const day of days) {
    let dayTraining = 0;
    let dayGames = 0;
    for (const e of day.entries) {
      const a = acts.get(e.activityId);
      const kind = a ? secs.get(a.sectionId)?.kind : undefined;
      if (e.measure === 'time') {
        const m = e.minutes ?? 0;
        if (kind === 'training') {
          dayTraining += m;
          trainingBy.set(a!.name, (trainingBy.get(a!.name) ?? 0) + m);
        }
        continue;
      }
      const n = e.amount ?? 0;
      if (kind !== 'games' || !a) {
        if (a && n) amountBy.set(a.name, (amountBy.get(a.name) ?? 0) + n);
        continue;
      }
      const counts = inRecord(data, a.id);
      const w = counts ? e.wins ?? 0 : 0;
      const l = counts ? e.losses ?? 0 : 0;
      const mode = modes.get(a.id) ?? { ...total(a.name, a.id), key: a.key };
      mode.games += n;
      mode.wins += w;
      mode.losses += l;
      modes.set(a.id, mode);
      const bucket = a.key === HONOR_DUEL_KEY ? honor : a.key?.startsWith('ranked-') ? ranked : a.key?.startsWith('casual-') ? casual : null;
      if (bucket) {
        bucket.games += n;
        bucket.wins += w;
        bucket.losses += l;
      }
      if (a.key !== HONOR_DUEL_KEY) {
        games += n;
        dayGames += n;
        record.wins += w;
        record.losses += l;
      }
    }
    const number = dayNumber(season, day);
    if (day.entries.length) {
      activeDays++;
      active.push(day.date);
    }
    if (dayTraining > 0) {
      trainingDays++;
      training += dayTraining;
      if (!bestTrainingDay || dayTraining > bestTrainingDay.value) bestTrainingDay = { day, number, value: dayTraining };
    }
    if (dayGames > 0) {
      gameDays++;
      if (!mostGamesDay || dayGames > mostGamesDay.value) mostGamesDay = { day, number, value: dayGames };
    }
  }

  // Longest run of days in a row with anything logged.
  let longestStreak = 0;
  let run = 0;
  active.sort().forEach((d, i) => {
    run = i > 0 && diffDays(active[i - 1], d) === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  });

  const matches = data.matches.filter((m) => m.seasonId === season.id && m.date <= last);
  const tracked: SeasonRecap['tracked'] = { games: matches.length, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, overtime: 0, overtimeWins: 0 };
  for (const m of matches) {
    if (m.overtime) {
      tracked.overtime++;
      if (m.result === 'win' && matchInRecord(data, m)) tracked.overtimeWins++;
    }
    if (!m.me) continue;
    tracked.goals += m.me.goals;
    tracked.assists += m.me.assists;
    tracked.saves += m.me.saves;
    tracked.shots += m.me.shots;
    tracked.demos += m.me.demos;
    if (!tracked.best || m.me.score > tracked.best.score)
      tracked.best = { score: m.me.score, mode: acts.get(m.activityId)?.name ?? m.mode, date: m.date, goals: m.me.goals, assists: m.me.assists, saves: m.me.saves };
  }

  const byAccount = new Map<string, SeasonRecap['accounts'][number]>();
  for (const m of matches) {
    const acc = data.accounts.find((a) => a.id === m.accountId);
    if (!acc) continue;
    const t = byAccount.get(acc.id) ?? { label: acc.label, color: acc.color, games: 0, wins: 0, losses: 0 };
    t.games++;
    if (matchInRecord(data, m) && acc) {
      if (m.result === 'win') t.wins++;
      else if (m.result === 'loss') t.losses++;
    }
    byAccount.set(acc.id, t);
  }

  const order = (x: ModeTotal) => modeRank(x.key) * 1e6 + (acts.get(x.activityId)?.order ?? 0);
  return {
    season,
    start: season.days[0]?.date ?? season.startDate,
    end: days[days.length - 1]?.date ?? season.startDate,
    days: days.length,
    activeDays,
    trainingDays,
    gameDays,
    longestStreak,
    training,
    topTraining: [...trainingBy].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes),
    amounts: [...amountBy].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    bestTrainingDay,
    modes: [...modes.values()].filter((m) => m.games > 0).sort((a, b) => order(a) - order(b)),
    games,
    ranked,
    casual,
    honor,
    record,
    mostGamesDay,
    tracked,
    accounts: byAccount.size > 1 ? [...byAccount.values()].sort((a, b) => b.games - a.games) : [],
  };
}

/** Ranked 1s / 2s / 3s of a recap (zeros when not played). */
export function rankedBySize(r: SeasonRecap): { size: '1vs1' | '2vs2' | '3vs3'; mode: ModeTotal }[] {
  return (['1s', '2s', '3s'] as const).map((s) => ({
    size: s === '1s' ? '1vs1' : s === '2s' ? '2vs2' : '3vs3',
    mode: r.modes.find((m) => m.key === `ranked-${s}`) ?? total(`Ranked ${s}`),
  }));
}

/** Win rate of games with a known result. */
export const winRate = (t: { wins: number; losses: number }) => (t.wins + t.losses ? t.wins / (t.wins + t.losses) : undefined);

/** Whether a mode's results count in the record (private matches can be left out). */
export const modeInRecord = (data: AppData, m: ModeTotal) => !m.key || !PRIVATE_KEYS.has(m.key) || data.settings.privateInRecord !== false;
