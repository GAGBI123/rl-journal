import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { promises as fs, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDataFolder, loadData, saveData } from './storage';
import { LiveGameClient } from './liveGame';
import { getStatsApiStatus, setupStatsApi } from './statsApiConfig';
import { Updater } from './updater';
import { integrateAppImage, setLinuxAutostart } from './linux';
import { log } from './log';
import { scheduleRelaunchAfterWindowsUpdate } from './relaunch';
import type { LiveMatchResult } from '../shared/model';
import { playlistInfo } from '../shared/playlists';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isWin = process.platform === 'win32';
const smokeTest = !!process.env.RLJ_SMOKE_TEST;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let closeToTray = true;
let rendererReady = false;
const pendingMatches: LiveMatchResult[] = [];
let lastQuiet: boolean | null = null;

// Lets tests and dev runs use a separate profile instead of the real journal.
if (process.env.RLJ_USER_DATA) app.setPath('userData', process.env.RLJ_USER_DATA);

if (isWin) app.setAppUserModelId('com.rljournal.app');

log('start', app.getVersion(), process.platform, process.argv.slice(1).join(' '));
if (!app.requestSingleInstanceLock()) {
  log('another instance is running; handing over and quitting');
  app.quit();
}

/** Written right before an update restarts the app, so it comes back the way it was (hidden / in the background). */
const relaunchFlag = () => path.join(app.getPath('userData'), '.update-relaunch');
type StartMode = 'show' | 'hidden' | 'inactive' | 'minimized';
function takeRelaunchMode(): Exclude<StartMode, 'show'> | null {
  try {
    const mode = readFileSync(relaunchFlag(), 'utf8').trim();
    unlinkSync(relaunchFlag());
    return mode === 'hidden' || mode === 'inactive' || mode === 'minimized' ? mode : null;
  } catch {
    return null;
  }
}

function iconPath() {
  const candidates = [path.join(app.getAppPath(), 'assets', 'icon.png'), path.join(__dirname, '..', 'assets', 'icon.png')];
  return candidates.find((p) => existsSync(p));
}

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

const live = new LiveGameClient({
  onStatus: (s) => send('live:status', s),
  onPlayers: (p) => send('live:players', p),
  onMatch: (m) => {
    if (rendererReady) send('live:match', m);
    else pendingMatches.push(m);
  },
});

const updater = new Updater({
  onStatus: (s) => {
    if (s.state !== 'downloading') log('update', s);
    send('update:status', s);
  },
  canRestartQuietly: () => {
    const s = live.getStatus();
    // Freeplay / training don't count: restarting then is harmless. Unknown playlist = assume a match.
    const inMatch = s.state === 'connected' && s.inMatch && (s.playlistId === undefined || playlistInfo(s.playlistId).kind !== 'practice');
    const away = !win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !win.isFocused();
    const quiet = !inMatch && away;
    if (quiet !== lastQuiet) log('update ready; good moment to restart:', quiet, { inMatch, away });
    lastQuiet = quiet;
    return quiet;
  },
  beforeInstall: () => {
    log('installing update now');
    quitting = true;
    // Note: Electron reports a minimized window as not visible, so check minimized first.
    const mode = !win || win.isDestroyed() ? 'hidden' : win.isMinimized() ? 'minimized' : !win.isVisible() ? 'hidden' : win.isFocused() ? '' : 'inactive';
    try {
      if (mode) writeFileSync(relaunchFlag(), mode);
    } catch {
      /* not critical */
    }
    send('app:before-update', null);
    scheduleRelaunchAfterWindowsUpdate();
  },
});

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(startMode: StartMode = 'show') {
  const icon = iconPath();
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    backgroundColor: '#070b16',
    title: 'RL Journal',
    icon,
    // Windows gets the custom dark title bar; Linux keeps the desktop's own window frame.
    ...(isWin ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#070b16', symbolColor: '#9fb0d0', height: 40 } } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  if (!isWin) win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    if (smokeTest || startMode === 'hidden') return;
    if (startMode === 'minimized') {
      win?.showInactive();
      win?.minimize();
    } else if (startMode === 'inactive') win?.showInactive();
    else win?.show();
  });
  win.on('close', (e) => {
    if (!quitting && closeToTray && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
  win.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL!)) return;
    e.preventDefault();
  });
  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function createTray() {
  const icon = iconPath();
  const size = isWin ? 16 : 24;
  const img = icon ? nativeImage.createFromPath(icon).resize({ width: size, height: size }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('RL Journal');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open RL Journal', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showWindow);
}

function registerIpc() {
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_e, data: unknown) => saveData(data));
  ipcMain.handle('data:folder', () => getDataFolder());
  ipcMain.handle('data:open-folder', () => shell.openPath(getDataFolder()));

  ipcMain.handle('data:export', async (_e, json: string) => {
    const res = await dialog.showSaveDialog(win!, {
      title: 'Export RL Journal backup',
      defaultPath: `rl-journal-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fs.writeFile(res.filePath, json, 'utf8');
    return true;
  });

  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Import RL Journal backup',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return JSON.parse(await fs.readFile(res.filePaths[0], 'utf8'));
  });

  ipcMain.handle('live:configure', (_e, cfg: { enabled: boolean; port: number }) => {
    live.configure(cfg.enabled, cfg.port);
    return live.getStatus();
  });
  ipcMain.handle('live:ready', () => {
    rendererReady = true;
    const queued = pendingMatches.splice(0);
    for (const m of queued) send('live:match', m);
    if (smokeTest) {
      // CI check: the window loaded and the app started. Exit cleanly.
      console.log('RLJ_SMOKE_OK');
      setTimeout(() => {
        quitting = true;
        app.exit(0);
      }, 500);
    }
    return live.getStatus();
  });

  ipcMain.handle('statsapi:status', (_e, dir?: string) => getStatsApiStatus(dir));
  ipcMain.handle('statsapi:setup', (_e, dir?: string) => setupStatsApi(dir));
  ipcMain.handle('statsapi:choose-dir', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Select your Rocket League install folder (the one containing "TAGame")',
      properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('statsapi:reveal', (_e, file: string) => {
    if (typeof file === 'string' && /StatsAPI\.ini$/i.test(file)) shell.showItemInFolder(file);
  });

  ipcMain.handle('notify', (_e, n: { title: string; body: string }) => {
    if (!Notification.isSupported()) return;
    const icon = iconPath();
    const notification = new Notification({ title: n.title, body: n.body, icon });
    notification.on('click', showWindow);
    notification.show();
  });

  ipcMain.handle('app:settings', (_e, s: { closeToTray: boolean; startWithWindows: boolean; autoUpdate: boolean }) => {
    closeToTray = !!s.closeToTray;
    updater.configure(s.autoUpdate !== false);
    if (!app.isPackaged) return;
    if (isWin) app.setLoginItemSettings({ openAtLogin: !!s.startWithWindows, args: ['--hidden'] });
    else void setLinuxAutostart(!!s.startWithWindows);
  });

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('update:get', () => updater.getStatus());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => updater.installNow());

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https:\/\/(www\.)?(rocketleague\.com|github\.com)\//.test(url)) shell.openExternal(url);
  });
}

app.on('second-instance', (_e, argv) => {
  // A second start right after an update (installer + watcher both relaunch) must not pop the window up.
  if (argv.includes('--updated')) return;
  showWindow();
});

app.whenReady().then(() => {
  registerIpc();
  const relaunch = takeRelaunchMode();
  log('ready', { relaunch, hidden: process.argv.includes('--hidden'), updated: process.argv.includes('--updated') });
  const startHidden = process.argv.includes('--hidden') || relaunch === 'hidden';
  createWindow(startHidden ? 'hidden' : relaunch ?? 'show');
  if (!smokeTest) createTray();
  void integrateAppImage(iconPath());
  if (smokeTest) {
    setTimeout(() => {
      console.error('RLJ_SMOKE_TIMEOUT');
      app.exit(1);
    }, 45000);
  }
});

app.on('before-quit', () => {
  log('before-quit');
  quitting = true;
  live.stop();
});

app.on('window-all-closed', () => {
  if (!tray || !closeToTray) app.quit();
});
