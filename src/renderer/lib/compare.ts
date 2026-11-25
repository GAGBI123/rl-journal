// "How does this compare?" numbers shown while adding an entry.
import type { AppData, Measure } from '../../shared/model';
import { addDays } from './dates';

export interface Comparison {
  todayBefore: number;
  todayAfter: number;
  yesterday: number;
  /** Average per day the activity was done (all time, excluding this date). */
  average?: number;
  averageDays: number;
  /** Same, limited to the season. */
  seasonAverage?: number;
  best?: number;
}

function totalsByDate(data: AppData, activityId: string, measure: Measure, seasonId?: string) {
  const map = new Map<string, number>();
  for (const s of data.seasons) {
    if (seasonId && s.id !== seasonId) continue;
    for (const d of s.days) {
      for (const e of d.entries) {
        if (e.activityId !== activityId || e.measure !== measure) continue;
        const v = measure === 'time' ? e.minutes ?? 0 : e.amount ?? 0;
        if (v > 0) map.set(d.date, (map.get(d.date) ?? 0) + v);
      }
    }
  }
  return map;
}

export function compareEntry(
  data: AppData,
  opts: { date: string; seasonId: string; activityId: string; measure: Measure; pending: number; excludeEntryId?: string },
): Comparison {
  const all = totalsByDate(data, opts.activityId, opts.measure);
  let todayBefore = all.get(opts.date) ?? 0;
  if (opts.excludeEntryId) {
    // When editing, don't count the entry's old value twice.
    for (const s of data.seasons)
      for (const d of s.days)
        if (d.date === opts.date)
          for (const e of d.entries)
            if (e.id === opts.excludeEntryId && e.activityId === opts.activityId && e.measure === opts.measure)
              todayBefore -= opts.measure === 'time' ? e.minutes ?? 0 : e.amount ?? 0;
  }
  const others = [...all].filter(([d]) => d !== opts.date).map(([, v]) => v);
  const season = [...totalsByDate(data, opts.activityId, opts.measure, opts.seasonId)].filter(([d]) => d !== opts.date).map(([, v]) => v);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  return {
    todayBefore,
    todayAfter: todayBefore + Math.max(0, opts.pending),
    yesterday: all.get(addDays(opts.date, -1)) ?? 0,
    average: avg(others),
    averageDays: others.length,
    seasonAverage: avg(season),
    best: others.length ? Math.max(...others) : undefined,
  };
}
