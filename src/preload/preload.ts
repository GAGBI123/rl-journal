import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string) => (cb: (payload: any) => void) => {
  const listener = (_e: unknown, payload: any) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api = {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data: unknown) => ipcRenderer.invoke('data:save', data),
  dataFolder: () => ipcRenderer.invoke('data:folder'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  exportData: (json: string) => ipcRenderer.invoke('data:export', json),
  importData: () => ipcRenderer.invoke('data:import'),
  liveConfigure: (cfg: unknown) => ipcRenderer.invoke('live:configure', cfg),
  liveReady: () => ipcRenderer.invoke('live:ready'),
  onLiveStatus: on('live:status'),
  onLiveMatch: on('live:match'),
  onLivePlayers: on('live:players'),
  statsApiStatus: (dir?: string) => ipcRenderer.invoke('statsapi:status', dir),
  statsApiSetup: (dir?: string) => ipcRenderer.invoke('statsapi:setup', dir),
  statsApiChooseDir: () => ipcRenderer.invoke('statsapi:choose-dir'),
  statsApiReveal: (file: string) => ipcRenderer.invoke('statsapi:reveal', file),
  notify: (n: { title: string; body: string }) => ipcRenderer.invoke('notify', n),
  applySettings: (s: unknown) => ipcRenderer.invoke('app:settings', s),
  version: () => ipcRenderer.invoke('app:version'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,
  updateStatus: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: on('update:status'),
  onBeforeUpdate: on('app:before-update'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  timerGet: () => ipcRenderer.invoke('timer:get'),
  timerStart: (t: unknown) => ipcRenderer.invoke('timer:start', t),
  timerControl: (action: string) => ipcRenderer.invoke('timer:control', action),
  overlayPress: (action: string) => ipcRenderer.invoke('overlay:press', action),
  hotkeyCheck: (accel: string) => ipcRenderer.invoke('hotkey:check', accel) as Promise<'ok' | 'taken' | 'invalid'>,
  hotkeySuspend: (on: boolean) => ipcRenderer.invoke('hotkey:suspend', on),
  fetchSeasons: () => ipcRenderer.invoke('seasons:fetch'),
  onOverlayFlash: on('overlay:flash'),
  onTimerState: on('timer:state'),
  onTimerComplete: on('timer:complete'),
  onOverlayHint: on('overlay:hint'),
};

contextBridge.exposeInMainWorld('rlj', api);

export type RljApi = typeof api;
