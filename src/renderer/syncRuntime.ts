// Wires the live game connection and app updates into the store.
import type { AppNotification, LocalPlayer, MainSettings } from '../shared/model';
import { fmtCount, fullMinutes, isCount, isEnded, type TimerCompletion, type TimerState } from '../shared/timer';
import { applyLiveMatch } from './lib/sync';
import {
  activityById,
  addToDay,
  completeRoutineItem,
  dayNumber,
  ensureSyncDay,
  findDayRoutine,
  findSeason,
  itemKind,
  fmtItemValue,
  nextRoutineItem,
  routineItemState,
  routineItemStates,
  seasonLabel,
} from './lib/journal';
import { shortcutLabel } from './lib/shortcut';
import type { AppData } from '../shared/model';
import { startRoutineItemTimer, type RoutineItemRef } from './lib/routineTimer';
import { fmtMinutes } from './lib/format';
import { todayISO } from './lib/dates';
import { playChime } from './lib/sound';
import { flushSave, useStore } from './store';

function announce(n: AppNotification | undefined) {
  if (!n) return;
  const { toast, data } = useStore.getState();
  toast({
    title: n.title,
    body: n.body,
    kind: n.kind === 'error' ? 'error' : n.kind === 'sync' ? 'success' : 'info',
    view: n.target?.dayId ? { name: 'day', seasonId: n.target.seasonId, dayId: n.target.dayId } : undefined,
  });
  if (data.settings.systemNotifications && (n.kind === 'sync' || n.kind === 'error')) {
    window.rlj.notify({ title: n.title, body: n.body });
  }
}

const samePlayer = (a?: LocalPlayer, b?: LocalPlayer) => !!a && !!b && a.name === b.name && (a.primaryId ?? '') === (b.primaryId ?? '');

let started = false;

export function startSyncRuntime() {
  if (started) return;
  started = true;
  // Before liveReady(): the main process then sends any timer that finished while the app was loading.
  startTimers();
  // "End days yourself": the first time, the current day is today.
  const s0 = useStore.getState().data.settings;
  if (s0.endDayManually && !s0.openDay) useStore.getState().mutate((d) => void (d.settings.openDay = todayISO()));

  window.rlj.onLiveStatus((s) => {
    useStore.setState({ liveStatus: s });
    // Remember who plays on this PC, so "Game connected · <account>" works before the next match.
    if (s.state === 'connected' && s.player) {
      const { data, mutate } = useStore.getState();
      if (!samePlayer(data.settings.lastLocalPlayer, s.player)) {
        mutate((d) => {
          d.settings.lastLocalPlayer = { name: s.player!.name, primaryId: s.player!.primaryId };
        });
      }
    }
  });
  window.rlj.onLivePlayers((p) => useStore.setState({ livePlayers: p }));
  window.rlj.onLiveMatch((m) => {
    let note: AppNotification | undefined;
    useStore.getState().mutate((d) => {
      note = applyLiveMatch(d, m).notification;
    });
    announce(note);
  });

  // Push settings that the main process needs, now and whenever they change.
  let lastKey = '';
  const pushSettings = () => {
    const s = useStore.getState().data.settings;
    const main: MainSettings = {
      closeToTray: s.closeToTray,
      startWithWindows: s.startWithWindows,
      autoUpdate: s.autoUpdate,
      updateChecks: s.updateChecks,
      timerOverlay: s.timerOverlay,
      overlayPosition: s.overlayPosition,
      timerHotkey: s.timerHotkey,
      timerFinishHotkey: s.timerFinishHotkey,
    };
    const key = JSON.stringify([s.liveGameEnabled, s.liveGamePort, main]);
    if (key === lastKey) return;
    lastKey = key;
    window.rlj.liveConfigure({ enabled: s.liveGameEnabled, port: s.liveGamePort }).then((st) => useStore.setState({ liveStatus: st }));
    window.rlj.applySettings(main);
  };
  pushSettings();
  useStore.subscribe(pushSettings);
  window.rlj.liveReady().then((st) => useStore.setState({ liveStatus: st }));

  startUpdates();
}

/** Log a finished timer to the day it was started on. */
/** Timers already logged (by id), so a completion delivered twice never adds its time twice. */
const loggedTimers = new Set<string>();

export function logTimer(c: TimerCompletion) {
  const { mutate, toast, data } = useStore.getState();
  if (loggedTimers.has(c.timer.id)) return;
  loggedTimers.add(c.timer.id);
  let where = '';
  let target: { seasonId: string; dayId: string } | null = null;
  let next: RoutineItemRef | null = null;
  let nextLabel = '';
  let routineDone = '';
  let alreadyDone = false;
  const count = isCount(c.timer);
  // A countdown that ran to 0 already played the sound when it ended.
  const ended = isEnded(c.timer);
  const advancing = autoAdvancing.delete(c.timer.id);
  mutate((d) => {
    const t = c.timer;
    let season = findSeason(d, t.seasonId);
    let day = season?.days.find((x) => x.id === t.dayId);
    if (!season || !day) {
      // The day was deleted meanwhile: use that date in an active season instead.
      const hit = ensureSyncDay(d, t.date);
      season = hit?.season;
      day = hit?.day;
    }
    if (!season || !day || !activityById(d, t.activityId)) return;
    // A routine item: tick it off (that also logs the time) and line up the next one.
    const dr = t.routine ? findDayRoutine(day, t.routine.dayRoutineId) : undefined;
    const item = dr?.items.find((i) => i.id === t.routine!.itemId);
    // completeRoutineItem logs the time (or, for a count, what's left of the amount) itself; if the
    // item is already done (e.g. logged meanwhile outside the routine), a timer's time is logged as a
    // plain entry instead. Never both.
    const completed = !!dr && !!item && completeRoutineItem(day, dr.id, item.id, count ? undefined : c.minutes, t.note);
    if (!completed) {
      // A count whose item was ticked off meanwhile (or removed) has nothing more to log.
      if (count) alreadyDone = true;
      else addToDay(day, { activityId: t.activityId, measure: 'time', minutes: c.minutes, note: t.note });
    }
    if (dr && item) {
      const n = nextRoutineItem(day, dr);
      if (!n) {
        if (completed) routineDone = dr.name;
      } else if (dr.autoNext) {
        // Auto-next moves on to the next item and sets it up, not started: the user starts it when
        // they begin. An amount goes on the overlay with a done button.
        const name = activityById(d, n.activityId)?.name ?? 'next item';
        const kind = itemKind(n);
        const left = routineItemState(day, n.id).remaining;
        next = { seasonId: season.id, dayId: day.id, dayRoutineId: dr.id, itemId: n.id };
        nextLabel =
          kind === 'amount'
            ? `${fmtItemValue(n, left)} ${name}, on the overlay: press ✓ when done`
            : `${name} (${kind === 'stopwatch' ? 'stopwatch' : fmtMinutes(left)}) is ready: press ▶ to start`;
      }
    }
    where = `${seasonLabel(season)}, Day ${dayNumber(season, day)}`;
    target = { seasonId: season.id, dayId: day.id };
  });
  const tgt = target as { seasonId: string; dayId: string } | null;
  const what = c.timer.mode === 'up' ? 'Stopwatch stopped' : c.early ? 'Timer stopped' : 'Timer done';
  const title = count
    ? alreadyDone
      ? `${c.timer.activityName} was already ticked off`
      : `Done: ${fmtCount(c.timer.amount)} ${c.timer.activityName} logged`
    : `${what}: ${fmtMinutes(c.minutes)} ${c.timer.activityName} logged`;
  if (!tgt) {
    toast({ kind: 'error', title: 'Timer finished but not logged', body: 'Its day or activity no longer exists, and no active season covers that date.' });
    return;
  }
  const body = routineDone
    ? `Routine “${routineDone}” complete. Added to ${where}.`
    : next
      ? `Next up: ${nextLabel}.`
      : alreadyDone
        ? 'Nothing more was logged.'
        : `Added to ${where}.`;
  toast({ kind: 'success', title, body, view: { name: 'day', seasonId: tgt.seasonId, dayId: tgt.dayId } });
  if (data.settings.timerSound && !ended) playChime();
  // Logging a finished timer by pressing done needs no notification (it came when the time ran out).
  if (data.settings.systemNotifications && (!ended || advancing)) window.rlj.notify({ title, body });
  const nextRef = next as RoutineItemRef | null;
  if (nextRef) void startRoutineItemTimer(nextRef, false, true);
}

/** Finished timers that auto-next logs right away (so they get the usual notification). */
const autoAdvancing = new Set<string>();
/** Finished timers already handled (sound, auto-next), by id. */
const endedSeen = new Set<string>();

/**
 * Does a finished routine timer move on by itself? Only with auto-next on and another item of the
 * routine still to do; otherwise (no routine, the last item, auto-next off) it waits at 0:00 for done.
 */
export function advancesOnEnd(data: AppData, t: TimerState): boolean {
  if (!t.routine) return false;
  const day = findSeason(data, t.seasonId)?.days.find((x) => x.id === t.dayId);
  const dr = day ? findDayRoutine(day, t.routine.dayRoutineId) : undefined;
  if (!day || !dr?.autoNext) return false;
  const states = routineItemStates(day);
  return dr.items.some((i) => i.id !== t.routine!.itemId && !states.get(i.id)?.done);
}

/** A countdown reached 0: play the sound, then log it and move on (auto-next) or say it waits for done. */
export function timerEnded(t: TimerState) {
  if (endedSeen.has(t.id)) return;
  endedSeen.add(t.id);
  const { data, toast } = useStore.getState();
  // It may have ended while the app was closed: no sound or notification for that.
  const fresh = Date.now() - (t.endedAt ?? 0) < 60_000;
  if (fresh && data.settings.timerSound) playChime();
  if (advancesOnEnd(data, t)) {
    autoAdvancing.add(t.id);
    void window.rlj.timerControl('finish');
    return;
  }
  const key = data.settings.timerFinishHotkey;
  const title = `Time’s up: ${fmtMinutes(fullMinutes(t))} ${t.activityName}`;
  const body = `Press ✓ on the overlay${key ? ` (or ${shortcutLabel(key)})` : ''} or Done in the app to log it.`;
  toast({ kind: 'success', title, body, view: { name: 'day', seasonId: t.seasonId, dayId: t.dayId } });
  if (fresh && data.settings.systemNotifications) window.rlj.notify({ title, body });
}

function onTimerState(t: TimerState | null) {
  useStore.setState({ timer: t });
  if (t && isEnded(t)) timerEnded(t);
}

function startTimers() {
  window.rlj.timerGet().then(onTimerState);
  window.rlj.onTimerState(onTimerState);
  window.rlj.onTimerComplete((c) => logTimer(c));
  watchCountTimer();
}

/**
 * An amount waiting on the overlay whose item was ticked off another way (a different amount logged
 * with the pen, enough logged by hand, the routine removed) comes off the overlay.
 */
export function watchCountTimer() {
  let dropped = '';
  const check = () => {
    const { timer, data } = useStore.getState();
    if (!timer || !isCount(timer) || !timer.routine || dropped === timer.id) return;
    const day = findSeason(data, timer.seasonId)?.days.find((x) => x.id === timer.dayId);
    const dr = day ? findDayRoutine(day, timer.routine.dayRoutineId) : undefined;
    const item = dr?.items.find((i) => i.id === timer.routine!.itemId);
    if (day && item && !routineItemState(day, item.id).done) return;
    dropped = timer.id;
    void window.rlj.timerControl('cancel');
  };
  return useStore.subscribe(check);
}

function startUpdates() {
  let announced = '';
  window.rlj.updateStatus().then((u) => useStore.setState({ update: u }));
  window.rlj.onUpdateStatus((u) => {
    useStore.setState({ update: u });
    const { data, toast } = useStore.getState();
    // With automatic updates off, say once per version that an update is waiting.
    if (u.state === 'available' && announced !== u.version) {
      announced = u.version;
      toast({ kind: 'info', title: `Update ${u.version} available`, body: 'Open Settings to install it with one click.', view: { name: 'settings', tab: 'app' } });
      if (data.settings.systemNotifications) window.rlj.notify({ title: 'RL Journal update available', body: `Version ${u.version} is ready to install.` });
    }
  });
  // Save right away before the updater restarts the app.
  window.rlj.onBeforeUpdate(() => flushSave());

  // "Updated to vX" after an update restarted the app.
  window.rlj.version().then((version) => {
    const { data, mutate, toast } = useStore.getState();
    const prev = data.settings.lastRunVersion;
    if (prev === version) return;
    mutate((d) => {
      d.settings.lastRunVersion = version;
    });
    if (prev && prev !== version) {
      toast({ kind: 'success', title: `Updated to version ${version}`, body: 'RL Journal installed the latest update. Your journal was kept.' });
      if (data.settings.systemNotifications) window.rlj.notify({ title: 'RL Journal updated', body: `Now on version ${version}.` });
    }
  });
}
