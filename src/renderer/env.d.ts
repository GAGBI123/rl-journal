import type { LiveMatchResult, LiveStatus, LocalPlayer, MainSettings, RlSeasonInfo, StatsApiSetupResult, UpdateStatus } from '../shared/model';
import type { TimerAction, TimerCompletion, TimerStart, TimerState } from '../shared/timer';

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
      applySettings(s: MainSettings): Promise<void>;
      version(): Promise<string>;
      appInfo(): Promise<{ version: string; platform: string }>;
      platform: string;
      updateStatus(): Promise<UpdateStatus>;
      checkForUpdates(): Promise<UpdateStatus>;
      installUpdate(): Promise<void>;
      onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
      onBeforeUpdate(cb: () => void): () => void;
      openExternal(url: string): Promise<void>;
      timerGet(): Promise<TimerState | null>;
      timerStart(t: TimerStart): Promise<TimerState>;
      timerControl(action: TimerAction): Promise<TimerState | null>;
      onTimerState(cb: (t: TimerState | null) => void): () => void;
      onTimerComplete(cb: (c: TimerCompletion) => void): () => void;
      onOverlayHint(cb: (hint: string) => void): () => void;
      overlayPress(action: TimerAction): Promise<TimerState | null>;
      hotkeyCheck(accel: string): Promise<'ok' | 'taken' | 'invalid'>;
      hotkeySuspend(on: boolean): Promise<void>;
      fetchSeasons(): Promise<RlSeasonInfo[] | null>;
      /** The custom app icon as a data URL, or null for the built-in icon. */
      iconGet(): Promise<string | null>;
      iconSet(dataUrl: string): Promise<string | null>;
      iconReset(): Promise<null>;
      setTitleBar(c: { color: string; symbolColor: string }): Promise<void>;
      onOverlayFlash(cb: (action: TimerAction) => void): () => void;
    };
  }
}

export {};
