// Checks GitHub Releases for new versions and installs them (Windows installer + Linux AppImage).
import { app } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/model';
import { log } from './log';

const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;

export interface UpdaterHooks {
  onStatus: (s: UpdateStatus) => void;
  /** Whether it's a good moment to restart without asking (not in a match, user not using the window). */
  canRestartQuietly: () => boolean;
  /** Called right before the app quits to install. */
  beforeInstall: () => void;
}

function notesText(info: UpdateInfo): string | undefined {
  const n = info.releaseNotes;
  if (!n) return undefined;
  const raw = typeof n === 'string' ? n : n.map((x) => x.note ?? '').join('\n');
  return raw.replace(/<[^>]+>/g, '').trim() || undefined;
}

export class Updater {
  private status: UpdateStatus = { state: 'idle' };
  private auto = true;
  private installWhenReady = false;
  private timer: NodeJS.Timeout | null = null;
  private quietTimer: NodeJS.Timeout | null = null;
  private lastCheck?: string;
  readonly supported: boolean;
  private reason = '';

  constructor(private hooks: UpdaterHooks) {
    const feed = process.env.RLJ_UPDATE_URL;
    if (!app.isPackaged && !feed) this.reason = 'Updates work in the installed app.';
    else if (process.platform === 'linux' && !process.env.APPIMAGE) this.reason = 'Automatic updates work when you run the AppImage.';
    else if (process.env.PORTABLE_EXECUTABLE_FILE) this.reason = 'The portable version cannot update itself. Use the installer.';
    else if (process.platform !== 'win32' && process.platform !== 'linux') this.reason = 'Updates are not available on this system.';
    this.supported = !this.reason;
    if (!this.supported) {
      this.status = { state: 'unsupported', reason: this.reason };
      return;
    }
    if (feed) {
      // Lets a local test server stand in for GitHub Releases.
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
      if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
    }
    autoUpdater.logger = {
      info: (m: unknown) => log('[updater]', m),
      warn: (m: unknown) => log('[updater] warn', m),
      error: (m: unknown) => log('[updater] error', m),
      debug: () => undefined,
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => {
      this.lastCheck = new Date().toISOString();
      this.set({ state: 'none', lastCheck: this.lastCheck });
    });
    autoUpdater.on('update-available', (info) => {
      this.lastCheck = new Date().toISOString();
      if (this.auto || this.installWhenReady) this.set({ state: 'downloading', version: info.version, percent: 0 });
      else this.set({ state: 'available', version: info.version, notes: notesText(info) });
    });
    autoUpdater.on('download-progress', (p) => {
      const version = 'version' in this.status ? this.status.version : '';
      this.set({ state: 'downloading', version, percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ state: 'downloaded', version: info.version, notes: notesText(info) });
      if (this.installWhenReady) this.install();
      else if (this.auto) this.scheduleQuietInstall();
    });
    autoUpdater.on('error', (err) => {
      const message = String(err?.message ?? err).split('\n')[0];
      // Offline or GitHub unreachable: stay quiet and try again later.
      this.set({ state: 'error', message: friendly(message) });
      this.installWhenReady = false;
    });
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  private set(s: UpdateStatus) {
    this.status = s;
    this.hooks.onStatus(s);
  }

  /** auto = download and install by itself; otherwise only announce. */
  configure(auto: boolean) {
    this.auto = auto;
    if (!this.supported) return;
    autoUpdater.autoDownload = auto;
    if (auto && this.status.state === 'downloaded') this.scheduleQuietInstall();
    if (!this.timer) {
      setTimeout(() => void this.check(), 15000);
      this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    }
  }

  async check(): Promise<UpdateStatus> {
    if (!this.supported) return this.status;
    if (this.status.state === 'downloading' || this.status.state === 'installing' || this.status.state === 'checking') return this.status;
    if (this.status.state === 'downloaded') return this.status;
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      /* reported through the error event */
    }
    return this.status;
  }

  /** One click: download if needed, then restart into the new version. */
  async installNow(): Promise<void> {
    if (!this.supported) return;
    this.installWhenReady = true;
    if (this.status.state === 'downloaded') return this.install();
    if (this.status.state === 'available' || this.status.state === 'error' || this.status.state === 'none' || this.status.state === 'idle') {
      try {
        if (this.status.state !== 'available') await autoUpdater.checkForUpdates();
        // With automatic updates on, the download already started by itself.
        const now = this.getStatus();
        if (!this.auto && (now.state === 'available' || now.state === 'downloading')) {
          this.set({ state: 'downloading', version: now.version, percent: 0 });
          await autoUpdater.downloadUpdate();
        }
      } catch {
        /* reported through the error event */
      }
    }
  }

  private scheduleQuietInstall() {
    if (this.quietTimer) return;
    // Install by itself once the app isn't being used and no match is running.
    let quietFor = 0;
    this.quietTimer = setInterval(() => {
      if (this.status.state !== 'downloaded' || !this.auto) {
        clearInterval(this.quietTimer!);
        this.quietTimer = null;
        return;
      }
      quietFor = this.hooks.canRestartQuietly() ? quietFor + 1 : 0;
      if (quietFor >= 2) {
        clearInterval(this.quietTimer!);
        this.quietTimer = null;
        this.install();
      }
    }, 30000);
  }

  private install() {
    if (this.status.state !== 'downloaded') return;
    this.set({ state: 'installing', version: this.status.version });
    this.hooks.beforeInstall();
    // Give the renderer a moment to save, then run the installer silently and relaunch.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 800);
  }
}

function friendly(message: string) {
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(message)) return 'Could not reach the update server. Check your internet connection.';
  if (/404/.test(message)) return 'No published release found yet.';
  return message.length > 160 ? message.slice(0, 157) + '…' : message;
}
