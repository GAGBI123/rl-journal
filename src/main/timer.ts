// Owns the training timer: start / pause / resume / finish / cancel, saved to disk so it survives
// restarts and updates. The app window and the overlay only display it and send commands.
import { app } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  earlyMinutes,
  isCountUp,
  isRunning,
  pauseTimer,
  remainingMs,
  resumeTimer,
  type TimerAction,
  type TimerCompletion,
  type TimerSource,
  type TimerStart,
  type TimerState,
} from '../shared/timer';
import { log } from './log';

export interface TimerEvents {
  onState: (t: TimerState | null) => void;
  onComplete: (c: TimerCompletion) => void;
}

const file = () => path.join(app.getPath('userData'), 'timer.json');

export class TimerService {
  private timer: TimerState | null = null;
  private endTimeout: NodeJS.Timeout | null = null;

  constructor(private events: TimerEvents) {}

  /** Restore a timer from the last run (it kept counting while the app was closed). */
  restore() {
    try {
      const t = JSON.parse(readFileSync(file(), 'utf8')) as TimerState;
      if (t && typeof t.durationMs === 'number' && t.activityId) {
        this.timer = t;
        log('timer restored', { activity: t.activityName, running: isRunning(t) });
        this.schedule();
      }
    } catch {
      /* no saved timer */
    }
  }

  get() {
    return this.timer;
  }

  start(input: TimerStart): TimerState {
    const now = Date.now();
    this.timer = {
      ...input,
      durationMs: input.mode === 'up' ? 0 : Math.max(1000, Math.round(input.durationMs)),
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      startedAt: now,
      accumulatedMs: 0,
      createdAt: now,
    };
    log('timer started', { activity: input.activityName, mode: input.mode ?? 'down', minutes: Math.round(input.durationMs / 60000) });
    this.changed();
    return this.timer;
  }

  control(action: TimerAction, source: TimerSource = 'app') {
    const t = this.timer;
    if (!t) {
      log('timer command without a timer', { action, source });
      return null;
    }
    const now = Date.now();
    if (action !== 'cancel') log('timer', action, { source, running: isRunning(t) });
    switch (action) {
      case 'pause':
        this.timer = pauseTimer(t, now);
        break;
      case 'resume':
        this.timer = resumeTimer(t, now);
        break;
      case 'toggle':
        this.timer = isRunning(t) ? pauseTimer(t, now) : resumeTimer(t, now);
        break;
      case 'finish': {
        // Stop now and log the time done so far.
        const minutes = earlyMinutes(t, now);
        this.timer = null;
        this.changed();
        if (minutes > 0) this.events.onComplete({ timer: t, minutes, early: true });
        return null;
      }
      case 'cancel':
        log('timer cancelled', { source });
        this.timer = null;
        break;
    }
    this.changed();
    return this.timer;
  }

  private changed() {
    this.schedule();
    this.events.onState(this.timer);
    void this.persist();
  }

  private async persist() {
    try {
      if (this.timer) await fs.writeFile(file(), JSON.stringify(this.timer), 'utf8');
      else await fs.unlink(file()).catch(() => undefined);
    } catch (err) {
      log('timer save failed', String(err));
    }
  }

  /** Fire exactly when the remaining time runs out (re-armed on every change). */
  private schedule() {
    if (this.endTimeout) clearTimeout(this.endTimeout);
    this.endTimeout = null;
    const t = this.timer;
    if (!t || !isRunning(t) || isCountUp(t)) return; // a stopwatch only ends when you stop it
    const left = remainingMs(t);
    if (left <= 0) return this.complete();
    // Timers can drift over long waits; re-check at most every minute.
    this.endTimeout = setTimeout(() => this.schedule(), Math.min(left + 50, 60_000));
  }

  private complete() {
    const t = this.timer;
    if (!t) return;
    this.timer = null;
    log('timer finished', { activity: t.activityName });
    this.events.onState(null);
    void this.persist();
    const minutes = Math.round((t.durationMs / 60000) * 100) / 100;
    this.events.onComplete({ timer: t, minutes, early: false });
  }
}
