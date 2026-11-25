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
  trackerFetch: (req: unknown) => ipcRenderer.invoke('tracker:fetch', req),
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
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
};

contextBridge.exposeInMainWorld('rlj', api);

export type RljApi = typeof api;
