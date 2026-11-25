import type {
  LiveMatchResult,
  LiveStatus,
  StatsApiSetupResult,
  TrackerFetchResult,
} from '../shared/model';

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
      trackerFetch(req: { platform: string; username: string; apiKey: string; baseUrl: string }): Promise<TrackerFetchResult>;
      liveConfigure(cfg: { enabled: boolean; port: number }): Promise<LiveStatus>;
      liveReady(): Promise<LiveStatus>;
      onLiveStatus(cb: (s: LiveStatus) => void): () => void;
      onLiveMatch(cb: (m: LiveMatchResult) => void): () => void;
      onLivePlayers(cb: (p: { name: string; primaryId?: string }[]) => void): () => void;
      statsApiStatus(dir?: string): Promise<StatsApiStatus>;
      statsApiSetup(dir?: string): Promise<StatsApiSetupResult & { webPort?: number }>;
      statsApiChooseDir(): Promise<string | null>;
      statsApiReveal(file: string): Promise<void>;
      notify(n: { title: string; body: string }): Promise<void>;
      applySettings(s: { closeToTray: boolean; startWithWindows: boolean }): Promise<void>;
      version(): Promise<string>;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
