// Small always-on-top timer overlay shown over Rocket League while a timer runs.
// Shown only when: the overlay is enabled, a timer exists, Rocket League is running and the
// RL Journal window itself is not the active window. It never takes focus away from the game.
import { BrowserWindow, screen } from 'electron';
import { execFile } from 'node:child_process';
import type { OverlayPosition } from '../shared/model';
import type { TimerState } from '../shared/timer';

const WIDTH = 330;
const HEIGHT = 92;

export interface OverlayHooks {
  preload: string;
  load: (win: BrowserWindow) => void;
  icon?: string;
  mainWindowFocused: () => boolean;
  /** True when the Stats API connection reports the game (cheap, no polling needed). */
  gameConnected: () => boolean;
  getTimer: () => TimerState | null;
  /** e.g. "Ctrl + Alt + P to pause" */
  hint: () => string;
}

/** Is RocketLeague.exe running? (also under Proton / Wine on Linux) */
export function rocketLeagueRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', 'IMAGENAME eq RocketLeague.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 4000 }, (err, out) =>
        resolve(!err && /RocketLeague\.exe/i.test(String(out))),
      );
    } else {
      execFile('ps', ['-eo', 'args'], { timeout: 4000 }, (err, out) => resolve(!err && /RocketLeague(\.exe)?\b/i.test(String(out))));
    }
  });
}

export class OverlayManager {
  private win: BrowserWindow | null = null;
  private enabled = true;
  private position: OverlayPosition = 'top-center';
  private rlRunning = false;
  private poll: NodeJS.Timeout | null = null;

  constructor(private hooks: OverlayHooks) {}

  configure(enabled: boolean, position: OverlayPosition) {
    const moved = position !== this.position;
    this.enabled = enabled;
    this.position = position;
    if (moved && this.win) this.place();
    this.update();
  }

  /** Re-evaluate whether the overlay should be visible. Call on any relevant change. */
  update() {
    const timer = this.hooks.getTimer();
    const wanted = this.enabled && !!timer;
    if (wanted && !this.poll) {
      void this.checkGame();
      this.poll = setInterval(() => void this.checkGame(), 4000);
    } else if (!wanted && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    const show = wanted && (this.rlRunning || this.hooks.gameConnected()) && !this.hooks.mainWindowFocused();
    if (show) {
      const w = this.ensure();
      w.webContents.send('timer:state', timer);
      if (!w.isVisible()) {
        this.place();
        w.showInactive();
        w.setAlwaysOnTop(true, 'screen-saver');
      }
    } else if (this.win?.isVisible()) {
      this.win.hide();
    }
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('timer:state', timer);
      this.win.webContents.send('overlay:hint', this.hooks.hint());
    }
  }

  private async checkGame() {
    const running = await rocketLeagueRunning();
    if (running !== this.rlRunning) {
      this.rlRunning = running;
      this.update();
    }
  }

  private ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      title: 'RL Journal timer',
      icon: this.hooks.icon,
      backgroundColor: '#00000000',
      webPreferences: { preload: this.hooks.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('timer:state', this.hooks.getTimer());
      win.webContents.send('overlay:hint', this.hooks.hint());
    });
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.hooks.load(win);
    this.win = win;
    return win;
  }

  private place() {
    if (!this.win) return;
    // Rocket League normally runs on the main display.
    const { bounds } = screen.getPrimaryDisplay();
    const x =
      this.position === 'top-left' ? bounds.x + 16 : this.position === 'top-right' ? bounds.x + bounds.width - WIDTH - 16 : bounds.x + Math.round((bounds.width - WIDTH) / 2);
    this.win.setBounds({ x, y: bounds.y + 10, width: WIDTH, height: HEIGHT });
  }

  destroy() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
