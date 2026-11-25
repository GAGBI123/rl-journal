import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { getDataFolder, loadData, saveData } from './storage';
import { fetchTrackerProfile, type TrackerRequest } from './tracker';
import { LiveGameClient } from './liveGame';
import { getStatsApiStatus, setupStatsApi } from './statsApiConfig';
import type { LiveMatchResult } from '../shared/model';

const isDev = !!process.env.VITE_DEV_SERVER_URL;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let closeToTray = true;
let rendererReady = false;
const pendingMatches: LiveMatchResult[] = [];

// Lets tests and dev runs use a separate profile instead of the real journal.
if (process.env.RLJ_USER_DATA) app.setPath('userData', process.env.RLJ_USER_DATA);

app.setAppUserModelId('com.rljournal.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function iconPath() {
  const candidates = [
    path.join(app.getAppPath(), 'assets', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ];
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

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
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
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#070b16', symbolColor: '#9fb0d0', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
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
  const img = icon ? nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
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

  ipcMain.handle('tracker:fetch', (_e, req: TrackerRequest) => fetchTrackerProfile(req));

  ipcMain.handle('live:configure', (_e, cfg: { enabled: boolean; port: number }) => {
    live.configure(cfg.enabled, cfg.port);
    return live.getStatus();
  });
  ipcMain.handle('live:ready', () => {
    rendererReady = true;
    const queued = pendingMatches.splice(0);
    for (const m of queued) send('live:match', m);
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

  ipcMain.handle('app:settings', (_e, s: { closeToTray: boolean; startWithWindows: boolean }) => {
    closeToTray = !!s.closeToTray;
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: !!s.startWithWindows, args: ['--hidden'] });
    }
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https:\/\/(www\.)?(tracker\.gg|rocketleague\.com|github\.com)\//.test(url)) shell.openExternal(url);
  });
}

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  createTray();
  if (process.argv.includes('--hidden')) win?.once('ready-to-show', () => win?.hide());
});

app.on('before-quit', () => {
  quitting = true;
  live.stop();
});

app.on('window-all-closed', () => {
  if (!tray || !closeToTray) app.quit();
});
