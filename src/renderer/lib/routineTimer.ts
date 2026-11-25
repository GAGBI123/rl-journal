// Starts the timer for an item of a routine that was started on a day.
import { useStore } from '../store';
import { activityById, findDayRoutine, findSeason, sectionById } from './journal';
import { confirmDialog } from '../components/ui';

export interface RoutineItemRef {
  seasonId: string;
  dayId: string;
  dayRoutineId: string;
  itemId: string;
}

/** Start the countdown for a routine item. `ask` confirms first if another timer is running. */
export async function startRoutineItemTimer(ref: RoutineItemRef, ask = true): Promise<boolean> {
  const { data, timer, toast } = useStore.getState();
  const day = findSeason(data, ref.seasonId)?.days.find((d) => d.id === ref.dayId);
  const dr = day ? findDayRoutine(day, ref.dayRoutineId) : undefined;
  const item = dr?.items.find((i) => i.id === ref.itemId);
  if (!day || !dr || !item) return false;
  const act = activityById(data, item.activityId);
  if (!act) {
    toast({ kind: 'error', title: 'This activity was deleted', body: 'Tick it off by hand or remove it from the routine.' });
    return false;
  }
  if (ask && timer && !(timer.routine?.itemId === item.id)) {
    const ok = await confirmDialog({
      title: `Replace the running ${timer.mode === 'up' ? 'stopwatch' : 'timer'}?`,
      body: `The ${timer.mode === 'up' ? 'stopwatch' : 'timer'} for ${timer.activityName} stops without being logged.`,
      confirmLabel: 'Start this one',
    });
    if (!ok) return false;
  }
  const idx = dr.items.indexOf(item);
  await window.rlj.timerStart({
    activityId: act.id,
    activityName: act.name,
    label: `${dr.name} ${idx + 1}/${dr.items.length} · ${act.name}`,
    color: sectionById(data, act.sectionId)?.color,
    seasonId: ref.seasonId,
    dayId: ref.dayId,
    date: day.date,
    durationMs: Math.round(item.minutes * 60_000),
    note: item.note,
    mode: 'down',
    routine: { dayRoutineId: dr.id, itemId: item.id },
  });
  return true;
}
