// Running timer in the top bar: always visible while a timer exists, with pause / finish / cancel.
import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, Timer, Watch, X } from 'lucide-react';
import { useStore } from '../store';
import { displayMs, earlyMinutes, elapsedMs, fmtClock, isCountUp, isRunning } from '../../shared/timer';
import { fmtMinutes } from '../lib/format';
import { confirmDialog } from './ui';

function useTick(active: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
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

  const running = isRunning(timer);
  const up = isCountUp(timer);
  const shown = displayMs(timer);
  const pct = up ? 100 : Math.min(100, (elapsedMs(timer) / Math.max(1, timer.durationMs)) * 100);
  const doneSoFar = earlyMinutes(timer);
  const toast = useStore.getState().toast;

  const finish = async () => {
    if (!doneSoFar) {
      toast({ kind: 'info', title: 'Less than a minute so far', body: 'Keep going, or cancel it.' });
      return;
    }
    // A stopwatch left running by accident: double-check very long sessions.
    if (up && doneSoFar > 360) {
      const ok = await confirmDialog({
        title: `Log ${fmtMinutes(doneSoFar)}?`,
        body: 'That’s a long session. Was the stopwatch left running? You can also edit the time on the day afterwards.',
        confirmLabel: `Log ${fmtMinutes(doneSoFar)}`,
      });
      if (!ok) return;
    }
    await window.rlj.timerControl('finish');
    setOpen(false);
  };

  const cancel = async () => {
    const ok = await confirmDialog({
      title: `Cancel this ${up ? 'stopwatch' : 'timer'}?`,
      body: 'Nothing is logged.',
      confirmLabel: 'Cancel timer',
      danger: true,
    });
    if (ok) {
      await window.rlj.timerControl('cancel');
      setOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <div className={`timer-pill ${running ? '' : 'paused'}`} style={{ ['--t-color' as any]: timer.color ?? 'var(--blue)' }}>
        <button className="tp-main" onClick={() => setOpen(!open)} title={timer.label}>
          {up ? <Watch size={14} /> : <Timer size={14} />}
          <span className="tp-time">{fmtClock(shown)}</span>
          <span className="tp-name">{timer.activityName}</span>
        </button>
        <button
          className="tp-btn"
          onClick={() => window.rlj.timerControl('toggle')}
          title={running ? 'Pause' : 'Resume'}
          aria-label={running ? 'Pause timer' : 'Resume timer'}
        >
          {running ? <Pause size={13} /> : <Play size={13} />}
        </button>
      </div>
      {open && (
        <div className="popover timer-pop">
          <div className="small muted">{timer.label}</div>
          <div className="tp-big">{fmtClock(shown)}</div>
          {!up && (
            <div className="tp-bar">
              <div style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="small muted" style={{ marginTop: 6 }}>
            {up ? 'Stopwatch, counting up' : `${fmtMinutes(timer.durationMs / 60000)} timer`} · {running ? 'running' : 'paused'} · logs to{' '}
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
          <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn small" onClick={() => window.rlj.timerControl('toggle')}>
              {running ? <Pause size={14} /> : <Play size={14} />} {running ? 'Pause' : 'Resume'}
            </button>
            <button className={`btn small ${up ? 'primary' : ''}`} onClick={finish} title={doneSoFar ? undefined : 'Less than a minute so far'}>
              <Check size={14} /> {up ? 'Stop & log' : 'Finish now'}
              {doneSoFar ? ` (${fmtMinutes(doneSoFar)})` : ''}
            </button>
            <button className="btn small ghost" onClick={cancel}>
              <X size={14} /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
