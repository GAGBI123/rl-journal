// Wires the live game connection and tracker.gg polling into the store.
import type { AppNotification } from '../shared/model';
import { applyLiveMatch, applyTrackerSnapshot } from './lib/sync';
import { useStore } from './store';

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

export async function syncTrackerAccount(accountId: string): Promise<string | null> {
  const { data, mutate } = useStore.getState();
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return 'Account not found';
  useStore.setState((s) => ({ syncing: { ...s.syncing, [accountId]: true } }));
  try {
    const res = await window.rlj.trackerFetch({
      platform: account.platform,
      username: account.username,
      apiKey: account.tracker.apiKey,
      baseUrl: data.settings.trackerBaseUrl,
    });
    let note: AppNotification | undefined;
    mutate((d) => {
      const acc = d.accounts.find((a) => a.id === accountId);
      if (!acc) return;
      if (res.ok) note = applyTrackerSnapshot(d, accountId, res.snapshot).notification;
      else {
        acc.tracker.lastError = res.error;
        acc.tracker.lastCheckedAt = new Date().toISOString();
      }
    });
    announce(note);
    return res.ok ? null : res.error;
  } finally {
    useStore.setState((s) => ({ syncing: { ...s.syncing, [accountId]: false } }));
  }
}

let started = false;

export function startSyncRuntime() {
  if (started) return;
  started = true;

  window.rlj.onLiveStatus((s) => useStore.setState({ liveStatus: s }));
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
    const key = JSON.stringify([s.liveGameEnabled, s.liveGamePort, s.closeToTray, s.startWithWindows]);
    if (key === lastKey) return;
    lastKey = key;
    window.rlj.liveConfigure({ enabled: s.liveGameEnabled, port: s.liveGamePort }).then((st) => useStore.setState({ liveStatus: st }));
    window.rlj.applySettings({ closeToTray: s.closeToTray, startWithWindows: s.startWithWindows });
  };
  pushSettings();
  useStore.subscribe(pushSettings);
  window.rlj.liveReady().then((st) => useStore.setState({ liveStatus: st }));

  // tracker.gg polling: check every minute which accounts are due.
  const tick = () => {
    const { data, syncing } = useStore.getState();
    const interval = Math.max(2, data.settings.trackerPollMinutes) * 60000;
    for (const a of data.accounts) {
      if (!a.tracker.enabled || syncing[a.id]) continue;
      const last = a.tracker.lastCheckedAt ? new Date(a.tracker.lastCheckedAt).getTime() : 0;
      if (Date.now() - last >= interval) void syncTrackerAccount(a.id);
    }
  };
  setTimeout(tick, 4000);
  setInterval(tick, 60000);
}
