import type { LiveMatchResult, LiveStatus, LocalPlayer, StatsApiSetupResult, UpdateStatus } from '../shared/model';

export interface StatsApiStatus {
  found: boolean;
  installDir?: string;
  file?: string | null;
  enabled?: boolean;
  webPort?: number;
  packetSendRate?: number;
}

declare global {
  interface Window {
    rlj: {
      loadData(): Promise<unknown | null>;
      saveData(data: unknown): Promise<void>;
      dataFolder(): Promise<string>;
      openDataFolder(): Promise<void>;
      exportData(json: string): Promise<boolean>;
      importData(): Promise<unknown | null>;
      liveConfigure(cfg: { enabled: boolean; port: number }): Promise<LiveStatus>;
      liveReady(): Promise<LiveStatus>;
      onLiveStatus(cb: (s: LiveStatus) => void): () => void;
      onLiveMatch(cb: (m: LiveMatchResult) => void): () => void;
      onLivePlayers(cb: (p: LocalPlayer[]) => void): () => void;
      statsApiStatus(dir?: string): Promise<StatsApiStatus>;
      statsApiSetup(dir?: string): Promise<StatsApiSetupResult & { webPort?: number }>;
      statsApiChooseDir(): Promise<string | null>;
      statsApiReveal(file: string): Promise<void>;
      notify(n: { title: string; body: string }): Promise<void>;
      applySettings(s: { closeToTray: boolean; startWithWindows: boolean; autoUpdate: boolean }): Promise<void>;
      version(): Promise<string>;
      appInfo(): Promise<{ version: string; platform: string }>;
      platform: string;
      updateStatus(): Promise<UpdateStatus>;
      checkForUpdates(): Promise<UpdateStatus>;
      installUpdate(): Promise<void>;
      onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
      onBeforeUpdate(cb: () => void): () => void;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
