// Starts the timer for an item of a routine that was started on a day.
import { useStore } from '../store';
import { activityById, findDayRoutine, findSeason, fmtItemValue, itemKind, nextRoutineItem, routineItemState, routineItemStates, sectionById } from './journal';
import { plural } from './format';
import { confirmDialog } from '../components/ui';
import { replaceTimerQuestion } from '../components/TimerPill';

export interface RoutineItemRef {
  seasonId: string;
  dayId: string;
  dayRoutineId: string;
  itemId: string;
}

/**
 * Start the timer for a routine item: a countdown for what's left of a 'time' item, a stopwatch for a
 * 'stopwatch' item, and for an 'amount' item a count: the amount waits on the overlay with a done
 * button (no clock). `ask` confirms first if another timer is running.
 */
export async function startRoutineItemTimer(ref: RoutineItemRef, ask = true): Promise<boolean> {
  const { data, timer, toast } = useStore.getState();
  const day = findSeason(data, ref.seasonId)?.days.find((d) => d.id === ref.dayId);
  const dr = day ? findDayRoutine(day, ref.dayRoutineId) : undefined;
  const item = dr?.items.find((i) => i.id === ref.itemId);
  if (!day || !dr || !item) return false;
  const kind = itemKind(item);
  const act = activityById(data, item.activityId);
  if (!act) {
    toast({ kind: 'error', title: 'This activity was deleted', body: 'Tick it off by hand or remove it from the routine.' });
    return false;
  }
  if (ask && timer && !(timer.routine?.itemId === item.id)) {
    const ok = await confirmDialog({ ...replaceTimerQuestion(timer), confirmLabel: 'Start this one' });
    if (!ok) return false;
  }
  const idx = dr.items.indexOf(item);
  const left = routineItemState(day, item.id).remaining;
  await window.rlj.timerStart({
    activityId: act.id,
    activityName: act.name,
    label: `${dr.name} ${idx + 1}/${dr.items.length} · ${act.name}`,
    color: sectionById(data, act.sectionId)?.color,
    seasonId: ref.seasonId,
    dayId: ref.dayId,
    date: day.date,
    durationMs: kind === 'time' ? Math.round((left || item.minutes) * 60_000) : 0,
    note: item.note,
    mode: kind === 'stopwatch' ? 'up' : kind === 'amount' ? 'count' : 'down',
    ...(kind === 'amount' ? { amount: left || item.amount || 0 } : {}),
    routine: { dayRoutineId: dr.id, itemId: item.id },
  });
  return true;
}

/**
 * After a routine was added to a day: say what already counted towards it (logged earlier that day)
 * and, with `runNow`, start the timer of the first item that isn't done yet.
 */
export async function afterRoutineAdded(ref: Omit<RoutineItemRef, 'itemId'>, runNow: boolean) {
  const { data, toast } = useStore.getState();
  const day = findSeason(data, ref.seasonId)?.days.find((d) => d.id === ref.dayId);
  const dr = day ? findDayRoutine(day, ref.dayRoutineId) : undefined;
  if (!day || !dr) return;
  const states = routineItemStates(day);
  const done = dr.items.filter((i) => states.get(i.id)?.done).length;
  const partly = dr.items.filter((i) => !states.get(i.id)?.done && states.get(i.id)?.progress).length;
  const parts = [done && `${plural(done, 'item')} done`, partly && `${plural(partly, 'item')} partly done`].filter(Boolean);
  const already = parts.length ? `What you already logged today counts: ${parts.join(', ')}.` : '';
  const next = nextRoutineItem(day, dr);
  if (!next) {
    toast({ kind: 'success', title: `${dr.name}: already done today`, body: 'Everything in it was already logged today, so it is ticked off.' });
    return;
  }
  const name = activityById(data, next.activityId)?.name ?? 'next item';
  if (runNow) {
    const started = await startRoutineItemTimer({ ...ref, itemId: next.id });
    if (started && already) toast({ kind: 'info', title: `${dr.name} started`, body: already });
    return;
  }
  const hint = runNow ? `First up: ${fmtItemValue(next, states.get(next.id)?.remaining ?? 0)} ${name}. Tick it off when you're done.` : 'Tick items off as you go, or press Start to run their timers.';
  toast({ kind: 'success', title: `${dr.name} added to the day`, body: already ? `${already} ${hint}` : hint });
}
