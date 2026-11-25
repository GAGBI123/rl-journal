// Wires the live game connection and app updates into the store.
import type { AppNotification, LocalPlayer, MainSettings } from '../shared/model';
import type { TimerCompletion } from '../shared/timer';
import { applyLiveMatch } from './lib/sync';
import { activityById, addToDay, dayNumber, ensureSyncDay, findSeason, seasonLabel } from './lib/journal';
import { fmtMinutes } from './lib/format';
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
export function logTimer(c: TimerCompletion) {
  const { mutate, toast, data } = useStore.getState();
  let where = '';
  let target: { seasonId: string; dayId: string } | null = null;
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
    addToDay(day, { activityId: t.activityId, measure: 'time', minutes: c.minutes, unit: c.unit, note: t.note });
    where = `${seasonLabel(season)}, Day ${dayNumber(season, day)}`;
    target = { seasonId: season.id, dayId: day.id };
  });
  const tgt = target as { seasonId: string; dayId: string } | null;
  const what = c.timer.mode === 'up' ? 'Stopwatch stopped' : c.early ? 'Timer stopped' : 'Timer done';
  const title = `${what}: ${fmtMinutes(c.minutes)} ${c.timer.activityName} logged`;
  if (!tgt) {
    toast({ kind: 'error', title: 'Timer finished but not logged', body: 'Its day or activity no longer exists, and no active season covers that date.' });
    return;
  }
  toast({ kind: 'success', title, body: `Added to ${where}.`, view: { name: 'day', seasonId: tgt.seasonId, dayId: tgt.dayId } });
  if (data.settings.timerSound) playChime();
  if (data.settings.systemNotifications) window.rlj.notify({ title, body: `Added to ${where}.` });
}

function startTimers() {
  window.rlj.timerGet().then((t) => useStore.setState({ timer: t }));
  window.rlj.onTimerState((t) => useStore.setState({ timer: t }));
  window.rlj.onTimerComplete((c) => logTimer(c));
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
      toast({ kind: 'info', title: `Update ${u.version} available`, body: 'Open Settings to install it with one click.', view: { name: 'settings' } });
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
