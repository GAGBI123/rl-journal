// Wires the live game connection and app updates into the store.
import type { AppNotification, LocalPlayer } from '../shared/model';
import { applyLiveMatch } from './lib/sync';
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
    const key = JSON.stringify([s.liveGameEnabled, s.liveGamePort, s.closeToTray, s.startWithWindows, s.autoUpdate]);
    if (key === lastKey) return;
    lastKey = key;
    window.rlj.liveConfigure({ enabled: s.liveGameEnabled, port: s.liveGamePort }).then((st) => useStore.setState({ liveStatus: st }));
    window.rlj.applySettings({ closeToTray: s.closeToTray, startWithWindows: s.startWithWindows, autoUpdate: s.autoUpdate });
  };
  pushSettings();
  useStore.subscribe(pushSettings);
  window.rlj.liveReady().then((st) => useStore.setState({ liveStatus: st }));

  startUpdates();
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
