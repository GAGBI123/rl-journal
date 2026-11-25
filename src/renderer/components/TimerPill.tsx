// Running timer in the top bar: always visible while a timer exists, with pause / finish / cancel.
import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, Timer, X } from 'lucide-react';
import { useStore } from '../store';
import { earlyMinutes, elapsedMs, fmtClock, isRunning, remainingMs } from '../../shared/timer';
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
  const left = remainingMs(timer);
  const pct = Math.min(100, (elapsedMs(timer) / Math.max(1, timer.durationMs)) * 100);
  const doneSoFar = earlyMinutes(timer);

  const cancel = async () => {
    const ok = await confirmDialog({
      title: 'Cancel this timer?',
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
          <Timer size={14} />
          <span className="tp-time">{fmtClock(left)}</span>
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
          <div className="tp-big">{fmtClock(left)}</div>
          <div className="tp-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>
            {fmtMinutes(timer.durationMs / 60000)} total · {running ? 'running' : 'paused'} · logs to{' '}
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
            <button
              className="btn small"
              disabled={!doneSoFar}
              title={doneSoFar ? undefined : 'Less than a minute so far'}
              onClick={async () => {
                await window.rlj.timerControl('finish');
                setOpen(false);
              }}
            >
              <Check size={14} /> Finish now{doneSoFar ? ` (log ${fmtMinutes(doneSoFar)})` : ''}
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
