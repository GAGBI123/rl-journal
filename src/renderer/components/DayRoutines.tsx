// Routines started on a day: tick items off, run their timers one after another.
import { useState } from 'react';
import { Check, ListChecks, Pause, PenLine, Play, Plus, Repeat, Timer, Trash2, Watch } from 'lucide-react';
import { useStore } from '../store';
import {
  activityById,
  completeRoutineItem,
  findDayRoutine,
  findSeason,
  fmtItemPlan,
  fmtItemValue,
  itemKind,
  itemProgress,
  itemRemaining,
  itemTarget,
  nextRoutineItem,
  removeDayRoutine,
  routineLengthLabel,
  routineProgress,
  sectionById,
  sectionLabel,
  startRoutineOnDay,
  undoRoutineItem,
} from '../lib/journal';
import { fmtMinutes } from '../lib/format';
import { afterRoutineAdded, startRoutineItemTimer } from '../lib/routineTimer';
import { confirmDialog, Modal, NumberInput } from './ui';
import { displayMs, fmtClock, isRunning } from '../../shared/timer';
import { useTick } from './TimerPill';
import type { Day, DayRoutine, DayRoutineItem, Season } from '../../shared/model';

function useDayMutate(seasonId: string, dayId: string) {
  const mutate = useStore((s) => s.mutate);
  return (fn: (day: Day) => void) =>
    mutate((d) => {
      const day = findSeason(d, seasonId)?.days.find((x) => x.id === dayId);
      if (day) fn(day);
    });
}

export function DayRoutines({ season, day }: { season: Season; day: Day }) {
  if (!day.routines?.length) return null;
  return (
    <>
      {day.routines.map((dr) => (
        <DayRoutineCard key={dr.id} season={season} day={day} dr={dr} />
      ))}
    </>
  );
}

/** "10m", "12m / 10m" (did more, or partly done), "50×", "Stopwatch". */
function ItemValue({ item }: { item: DayRoutineItem }) {
  const target = itemTarget(item);
  const progress = itemProgress(item);
  if (target === undefined) {
    if (progress > 0) return <>{fmtMinutes(progress)}</>;
    return <span className="muted">{item.done ? '—' : 'Stopwatch'}</span>;
  }
  if (progress > 0 && progress !== target) {
    return (
      <>
        {fmtItemValue(item, progress)} <span className="muted tiny">/ {fmtItemValue(item, target)}</span>
      </>
    );
  }
  return <>{fmtItemValue(item, target)}</>;
}

function tickTitle(item: DayRoutineItem) {
  if (item.done) return item.prior ? 'Untick (what you logged before the routine stays on the day)' : 'Untick (takes what it added off the day again)';
  const kind = itemKind(item);
  if (kind === 'stopwatch') return 'Tick off without adding time (use the stopwatch to time it)';
  return `Tick off: adds ${fmtItemValue(item, itemRemaining(item))} to the day`;
}

function DayRoutineCard({ season, day, dr }: { season: Season; day: Day; dr: DayRoutine }) {
  const data = useStore((s) => s.data);
  const timer = useStore((s) => s.timer);
  const toast = useStore((s) => s.toast);
  const mutateDay = useDayMutate(season.id, day.id);
  const [logging, setLogging] = useState<{ itemId: string; value: string } | null>(null);
  const p = routineProgress(dr);
  const next = nextRoutineItem(dr);
  const runningHere = timer?.routine?.dayRoutineId === dr.id ? timer : null;
  useTick(!!runningHere);
  const ref = (itemId: string) => ({ seasonId: season.id, dayId: day.id, dayRoutineId: dr.id, itemId });

  const toggleItem = (itemId: string, done: boolean | undefined) => {
    if (runningHere?.routine?.itemId === itemId && !done) {
      toast({ kind: 'info', title: 'Its timer is running', body: 'Finish it from the timer, or cancel the timer first.' });
      return;
    }
    if (logging?.itemId === itemId) setLogging(null);
    mutateDay((d) => {
      if (done) undoRoutineItem(d, dr.id, itemId);
      else completeRoutineItem(d, dr.id, itemId);
    });
  };

  const logAmount = () => {
    if (!logging) return;
    const v = Number(logging.value);
    if (!(v > 0)) return;
    mutateDay((d) => completeRoutineItem(d, dr.id, logging.itemId, v));
    setLogging(null);
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove “${dr.name}” from this day?`,
      body: p.done ? 'What it already added to the day stays.' : undefined,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    if (runningHere) await window.rlj.timerControl('cancel');
    mutateDay((d) => removeDayRoutine(d, dr.id));
  };

  const nextAct = next ? activityById(data, next.activityId) : undefined;
  const nextKind = next ? itemKind(next) : 'time';
  const pct = p.total ? (p.done / p.total) * 100 : 0;
  return (
    <div className={`card routine-card ${p.complete ? 'complete' : ''}`}>
      <div className="row between" style={{ gap: 10, marginBottom: 10 }}>
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <ListChecks size={16} color="var(--series-2, var(--orange))" />
          <b className="ellipsis">{dr.name}</b>
          <span className="muted small">
            {p.done}/{p.total}
            {p.minutesTotal > 0 && ` · ${fmtMinutes(p.minutesDone)} of ${fmtMinutes(p.minutesTotal)}`}
            {p.stopwatchMinutes > 0 && ` · ${fmtMinutes(p.stopwatchMinutes)} stopwatch`}
          </span>
          {p.complete && (
            <span className="badge green">
              <Check size={12} /> Done
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button
            className={`btn small ghost ${dr.autoNext ? 'on-toggle' : ''}`}
            title="When an item's timer ends, start the next item's timer by itself"
            aria-pressed={!!dr.autoNext}
            onClick={() =>
              mutateDay((d) => {
                const x = findDayRoutine(d, dr.id);
                if (x) x.autoNext = !x.autoNext;
              })
            }
          >
            <Repeat size={13} /> Auto-next {dr.autoNext ? 'on' : 'off'}
          </button>
          <button className="icon-btn" title="Remove this routine from the day" aria-label="Remove routine" onClick={remove}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="progress" style={{ marginBottom: 10 }}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="routine-items">
        {dr.items.map((item, i) => {
          const act = activityById(data, item.activityId);
          const sec = act ? sectionById(data, act.sectionId) : undefined;
          const live = runningHere?.routine?.itemId === item.id ? runningHere : null;
          const kind = itemKind(item);
          const isLogging = logging?.itemId === item.id && !item.done;
          return (
            <div key={item.id} className={`routine-item ${item.done ? 'done' : ''} ${live ? 'live' : ''}`} style={{ ['--e-color' as any]: sec?.color }}>
              <button className={`check ${item.done ? 'on' : ''}`} onClick={() => toggleItem(item.id, item.done)} title={tickTitle(item)} aria-label={item.done ? 'Untick' : 'Tick off'}>
                {item.done && <Check size={13} />}
              </button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ri-name">
                  <span className="muted">{i + 1}.</span> {act?.name ?? 'Deleted activity'}
                </div>
                <div className="tiny muted ellipsis">
                  {act ? sectionLabel(data, act.sectionId) : ''}
                  {item.note ? ` · ${item.note}` : ''}
                  {item.prior ? <span className="ri-prior"> · {fmtItemValue(item, item.prior)} logged earlier today</span> : null}
                </div>
              </div>
              {isLogging ? (
                <div className="row" style={{ gap: 4 }}>
                  <div className="input-suffix small-suffix" style={{ width: 92 }}>
                    <NumberInput value={logging.value} onChange={(v) => setLogging({ itemId: item.id, value: v })} placeholder="0" onEnter={logAmount} autoFocus />
                    <span className="suffix">×</span>
                  </div>
                  <button className="btn small primary" disabled={!(Number(logging.value) > 0)} onClick={logAmount}>
                    Log
                  </button>
                </div>
              ) : (
                <div className="ri-time">{live ? <span className="live-clock">{fmtClock(displayMs(live))}</span> : <ItemValue item={item} />}</div>
              )}
              {!item.done &&
                (live ? (
                  <button className="icon-btn" title={isRunning(live) ? 'Pause' : 'Resume'} onClick={() => window.rlj.timerControl('toggle')}>
                    {isRunning(live) ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                ) : kind === 'amount' ? (
                  <button
                    className={`icon-btn ${isLogging ? 'on-toggle' : ''}`}
                    title="Log how many you actually did"
                    aria-label="Log a different amount"
                    onClick={() => setLogging(isLogging ? null : { itemId: item.id, value: String(itemRemaining(item) || '') })}
                  >
                    <PenLine size={15} />
                  </button>
                ) : kind === 'stopwatch' ? (
                  <button className="icon-btn" title="Start a stopwatch for this" aria-label="Start stopwatch" onClick={() => startRoutineItemTimer(ref(item.id))}>
                    <Watch size={15} />
                  </button>
                ) : (
                  <button className="icon-btn" title={`Start a ${fmtMinutes(itemRemaining(item))} timer for this`} aria-label="Start timer" onClick={() => startRoutineItemTimer(ref(item.id))}>
                    <Timer size={15} />
                  </button>
                ))}
            </div>
          );
        })}
      </div>
      {next && !runningHere && (
        <button
          className="btn primary"
          style={{ marginTop: 12, width: '100%' }}
          onClick={() => (nextKind === 'amount' ? toggleItem(next.id, false) : startRoutineItemTimer(ref(next.id)))}
        >
          {nextKind === 'amount' ? (
            <>
              <Check size={15} /> Done: {fmtItemValue(next, itemRemaining(next))} {nextAct?.name ?? 'next item'}
            </>
          ) : nextKind === 'stopwatch' ? (
            <>
              <Watch size={15} /> {p.done || next.prior ? 'Continue' : 'Start'}: {nextAct?.name ?? 'next item'} · stopwatch
            </>
          ) : (
            <>
              <Play size={15} /> {p.done || next.prior ? 'Continue' : 'Start'}: {nextAct?.name ?? 'next item'} · {fmtMinutes(itemRemaining(next))}
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** Pick a saved routine to start on a day. */
export function StartRoutineModal({ season, day, onClose }: { season: Season; day: Day; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const mutate = useStore((s) => s.mutate);
  const navigate = useStore((s) => s.navigate);
  const start = (routineId: string, runNow: boolean) => {
    const routine = data.routines.find((r) => r.id === routineId);
    if (!routine) return;
    let dayRoutineId = '';
    mutate((d) => {
      const target = findSeason(d, season.id)?.days.find((x) => x.id === day.id);
      if (!target) return;
      dayRoutineId = startRoutineOnDay(target, routine).id;
    });
    onClose();
    if (dayRoutineId) void afterRoutineAdded({ seasonId: season.id, dayId: day.id, dayRoutineId }, runNow);
  };
  return (
    <Modal title="Start a routine" subtitle="Its items are added to this day as a checklist. Anything you already logged today counts towards it." onClose={onClose}>
      {data.routines.length === 0 ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="muted small">You don't have any routines yet. A routine is a list of trainings with a time or an amount each, e.g. Freeplay 10 min, 50 shots in a training pack.</div>
          <button
            className="btn primary"
            onClick={() => {
              onClose();
              navigate({ name: 'routines' });
            }}
          >
            <Plus size={15} /> Create a routine
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {data.routines.map((r) => {
            const already = day.routines?.some((x) => x.routineId === r.id);
            const length = routineLengthLabel(r.items);
            return (
              <div key={r.id} className="routine-pick">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{r.name}</b>
                  {already && <span className="badge blue" style={{ marginLeft: 8 }}>On this day</span>}
                  <div className="tiny muted ellipsis">
                    {r.items.length} item{r.items.length === 1 ? '' : 's'}
                    {length ? ` · ${length}` : ''} ·{' '}
                    {r.items.map((i) => `${activityById(data, i.activityId)?.name ?? '?'} ${fmtItemPlan(i).toLowerCase()}`).join(', ')}
                  </div>
                </div>
                <button className="btn small" disabled={!r.items.length} onClick={() => start(r.id, false)}>
                  Add to day
                </button>
                <button className="btn small primary" disabled={!r.items.length} onClick={() => start(r.id, true)} title="Add it and start the first item's timer">
                  <Play size={13} /> Start now
                </button>
              </div>
            );
          })}
          <button
            className="btn ghost small"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              onClose();
              navigate({ name: 'routines' });
            }}
          >
            Manage routines
          </button>
        </div>
      )}
    </Modal>
  );
}
