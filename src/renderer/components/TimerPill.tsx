// Running timer in the top bar: always visible while a timer exists, with pause / stop / cancel.
import { useEffect, useRef, useState } from 'react';
import { Check, ListChecks, Pause, Play, Square, Timer, Watch, X } from 'lucide-react';
import { useStore } from '../store';
import { displayMs, earlyMinutes, elapsedMs, fmtClock, fmtCount, fullMinutes, isCount, isCountUp, isEnded, isReady, isRunning, type TimerState } from '../../shared/timer';
import { fmtMinutes } from '../lib/format';
import { confirmDialog } from './ui';

export function useTick(active: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
}

/** "timer", "stopwatch" or, for an amount on the overlay, "to-do". */
export function timerNoun(t: TimerState) {
  return isCount(t) ? 'to-do' : isCountUp(t) ? 'stopwatch' : 'timer';
}

/** Confirm replacing the running timer (or the amount waiting on the overlay) with a new one. */
export function replaceTimerQuestion(t: TimerState) {
  return isCount(t)
    ? { title: `Take ${t.activityName} off the overlay?`, body: `${fmtCount(t.amount)} ${t.activityName} isn’t ticked off; it stays on the routine.` }
    : { title: `Replace the running ${timerNoun(t)}?`, body: `The ${timerNoun(t)} for ${t.activityName} stops without being logged.` };
}

/** Pause / stop / cancel for the running timer, with the same checks everywhere in the app. */
export function timerActions(timer: TimerState) {
  const up = isCountUp(timer);
  const count = isCount(timer);
  const ended = isEnded(timer);
  const toast = useStore.getState().toast;
  const toggle = () => window.rlj.timerControl('toggle');
  /** Stop now and log the time so far (an amount: tick it off; a finished timer: log it). Returns true if it was stopped. */
  const finish = async () => {
    if (count || ended) {
      await window.rlj.timerControl('finish');
      return true;
    }
    if (isReady(timer)) {
      toast({ kind: 'info', title: 'Not started yet', body: 'Start it when you begin, or cancel it.' });
      return false;
    }
    const doneSoFar = earlyMinutes(timer);
    if (!doneSoFar) {
      toast({ kind: 'info', title: 'Less than a minute so far', body: 'Keep going, or cancel it.' });
      return false;
    }
    // A stopwatch left running by accident: double-check very long sessions.
    if (up && doneSoFar > 360) {
      const ok = await confirmDialog({
        title: `Log ${fmtMinutes(doneSoFar)}?`,
        body: 'That’s a long session. Was the stopwatch left running? You can also edit the time on the day afterwards.',
        confirmLabel: `Log ${fmtMinutes(doneSoFar)}`,
      });
      if (!ok) return false;
    }
    await window.rlj.timerControl('finish');
    return true;
  };
  const cancel = async () => {
    const ok = await confirmDialog(
      count
        ? { title: `Take ${timer.activityName} off the overlay?`, body: 'Nothing is logged; it stays on the routine.', confirmLabel: 'Take it off' }
        : ended
        ? { title: 'Discard this finished timer?', body: `Its ${fmtMinutes(fullMinutes(timer))} of ${timer.activityName} isn’t logged.`, confirmLabel: 'Discard', danger: true }
        : {
            title: `Cancel this ${up ? 'stopwatch' : 'timer'}?`,
            body: 'Nothing is logged.',
            confirmLabel: `Cancel ${up ? 'stopwatch' : 'timer'}`,
            danger: true,
          },
    );
    if (ok) await window.rlj.timerControl('cancel');
    return ok;
  };
  return { toggle, finish, cancel };
}

export function TimerPill() {
  const timer = useStore((s) => s.timer);
  const navigate = useStore((s) => s.navigate);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useTick(!!timer);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  if (!timer) return null;
  if (isCount(timer)) return <CountPill timer={timer} open={open} setOpen={setOpen} pillRef={ref} />;

  const running = isRunning(timer);
  const up = isCountUp(timer);
  const ended = isEnded(timer);
  const ready = isReady(timer);
  const shown = displayMs(timer);
  const pct = up ? 100 : Math.min(100, (elapsedMs(timer) / Math.max(1, timer.durationMs)) * 100);
  const doneSoFar = earlyMinutes(timer);
  const actions = timerActions(timer);
  const stopLabel = up ? 'Stop & log' : 'Finish now';
  const look = ended ? 'ended' : ready ? 'ready' : running ? '' : 'paused';

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div className={`timer-pill ${look}`} style={{ ['--t-color' as any]: timer.color ?? 'var(--blue)' }}>
        <button className="tp-main" onClick={() => setOpen(!open)} title={timer.label}>
          {up ? <Watch size={14} /> : <Timer size={14} />}
          <span className="tp-time">{ended ? '0:00' : fmtClock(shown)}</span>
          <span className="tp-name">
            {ready && <span className="tp-tag">Ready</span>}
            {ended && <span className="tp-tag">Done</span>}
            {timer.activityName}
          </span>
        </button>
        {ended ? (
          <button className="tp-btn" onClick={actions.finish} title={`Log it (${fmtMinutes(fullMinutes(timer))})`} aria-label="Log the finished timer">
            <Check size={13} />
          </button>
        ) : (
          <>
            <button className="tp-btn" onClick={actions.toggle} title={ready ? 'Start' : running ? 'Pause' : 'Resume'} aria-label={ready ? 'Start timer' : running ? 'Pause timer' : 'Resume timer'}>
              {running ? <Pause size={13} /> : <Play size={13} />}
            </button>
            {!ready && (
              <button
                className="tp-btn"
                onClick={actions.finish}
                title={doneSoFar ? `${stopLabel} (${fmtMinutes(doneSoFar)})` : `${stopLabel}: less than a minute so far`}
                aria-label={stopLabel}
              >
                <Square size={11} fill="currentColor" />
              </button>
            )}
          </>
        )}
      </div>
      {open && (
        <div className="popover timer-pop">
          <div className="small muted">{timer.label}</div>
          <div className="tp-big">{ended ? '0:00' : fmtClock(shown)}</div>
          {!up && (
            <div className="tp-bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="small muted" style={{ marginTop: 6 }}>
            {up ? 'Stopwatch, counting up' : `${fmtMinutes(timer.durationMs / 60000)} timer`} · {ended ? 'done, press Done to log it' : ready ? 'not started yet' : running ? 'running' : 'paused'} · logs to{' '}
            <button
              className="crumb-btn"
              onClick={() => {
                navigate({ name: 'day', seasonId: timer.seasonId, dayId: timer.dayId });
                setOpen(false);
              }}
            >
              its day
            </button>
          </div>
          <TimerButtons timer={timer} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** An amount waiting on the overlay (routine amount item): how many, and a done button. */
function CountPill(props: { timer: TimerState; open: boolean; setOpen: (v: boolean) => void; pillRef: React.RefObject<HTMLDivElement | null> }) {
  const { timer, open, setOpen } = props;
  const navigate = useStore((s) => s.navigate);
  const actions = timerActions(timer);
  return (
    <div style={{ position: 'relative' }} ref={props.pillRef}>
      <div className="timer-pill" style={{ ['--t-color' as any]: timer.color ?? 'var(--blue)' }}>
        <button className="tp-main" onClick={() => setOpen(!open)} title={timer.label}>
          <ListChecks size={14} />
          <span className="tp-time">{fmtCount(timer.amount)}</span>
          <span className="tp-name">{timer.activityName}</span>
        </button>
        <button className="tp-btn" onClick={actions.finish} title="Done: tick it off" aria-label="Done: tick it off">
          <Check size={13} />
        </button>
      </div>
      {open && (
        <div className="popover timer-pop">
          <div className="small muted">{timer.label}</div>
          <div className="tp-big">{fmtCount(timer.amount)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>
            On the overlay until you press done · logs to{' '}
            <button
              className="crumb-btn"
              onClick={() => {
                navigate({ name: 'day', seasonId: timer.seasonId, dayId: timer.dayId });
                setOpen(false);
              }}
            >
              its day
            </button>
          </div>
          <TimerButtons timer={timer} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Pause / stop & log / cancel buttons. */
export function TimerButtons({ timer, onDone }: { timer: TimerState; onDone?: () => void }) {
  if (isCount(timer)) return <CountButtons timer={timer} onDone={onDone} />;
  return <ClockButtons timer={timer} onDone={onDone} />;
}

/** Done / take off the overlay, for an amount on the overlay. */
function CountButtons({ timer, onDone }: { timer: TimerState; onDone?: () => void }) {
  const actions = timerActions(timer);
  return (
    <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
      <button className="btn small primary" onClick={async () => (await actions.finish()) && onDone?.()}>
        <Check size={14} /> Done: {fmtCount(timer.amount)}
      </button>
      <button className="btn small ghost" onClick={async () => (await actions.cancel()) && onDone?.()}>
        <X size={14} /> Take off the overlay
      </button>
    </div>
  );
}

function ClockButtons({ timer, onDone }: { timer: TimerState; onDone?: () => void }) {
  const running = isRunning(timer);
  const up = isCountUp(timer);
  const doneSoFar = earlyMinutes(timer);
  const actions = timerActions(timer);
  if (isEnded(timer)) {
    return (
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn small primary" onClick={async () => (await actions.finish()) && onDone?.()}>
          <Check size={14} /> Done: log {fmtMinutes(fullMinutes(timer))}
        </button>
        <button className="btn small ghost" onClick={async () => (await actions.cancel()) && onDone?.()}>
          <X size={14} /> Discard
        </button>
      </div>
    );
  }
  if (isReady(timer)) {
    return (
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn small primary" onClick={actions.toggle}>
          <Play size={14} /> Start
        </button>
        <button className="btn small ghost" onClick={async () => (await actions.cancel()) && onDone?.()}>
          <X size={14} /> Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
      <button className="btn small" onClick={actions.toggle}>
        {running ? <Pause size={14} /> : <Play size={14} />} {running ? 'Pause' : 'Resume'}
      </button>
      <button
        className={`btn small ${up ? 'primary' : ''}`}
        onClick={async () => (await actions.finish()) && onDone?.()}
        title={doneSoFar ? undefined : 'Less than a minute so far'}
      >
        <Check size={14} /> {up ? 'Stop & log' : 'Finish now'}
        {doneSoFar ? ` (${fmtMinutes(doneSoFar)})` : ''}
      </button>
      <button className="btn small ghost" onClick={async () => (await actions.cancel()) && onDone?.()}>
        <X size={14} /> Cancel
      </button>
    </div>
  );
}

/** The running timer as a card (day page), so it can be stopped without opening the top bar. */
export function RunningTimerCard() {
  const timer = useStore((s) => s.timer);
  const navigate = useStore((s) => s.navigate);
  const view = useStore((s) => s.view);
  useTick(!!timer);
  if (!timer) return null;
  const count = isCount(timer);
  const ended = isEnded(timer);
  const ready = isReady(timer);
  const running = isRunning(timer) || count;
  const up = isCountUp(timer);
  const elsewhere = !(view.name === 'day' && view.dayId === timer.dayId);
  const look = ended ? 'ended' : ready ? 'ready' : running ? '' : 'paused';
  return (
    <div className={`card running-timer ${look}`} style={{ ['--t-color' as any]: timer.color ?? 'var(--blue)' }}>
      <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small muted row" style={{ gap: 6 }}>
            {count ? <ListChecks size={13} /> : up ? <Watch size={13} /> : <Timer size={13} />}
            {count
              ? 'On the overlay until you press done'
              : ended
                ? 'Time’s up: press Done to log it'
                : ready
                  ? `Ready: press Start when you begin`
                  : `${up ? 'Stopwatch' : 'Timer'} ${running ? 'running' : 'paused'}`}
            {elsewhere && (
              <>
                {' · '}
                <button className="crumb-btn" onClick={() => navigate({ name: 'day', seasonId: timer.seasonId, dayId: timer.dayId })}>
                  logs to another day
                </button>
              </>
            )}
          </div>
          <div className="rt-name">{timer.label}</div>
        </div>
        <div className="rt-time">{count ? fmtCount(timer.amount) : ended ? '0:00' : fmtClock(displayMs(timer))}</div>
      </div>
      <TimerButtons timer={timer} />
    </div>
  );
}
