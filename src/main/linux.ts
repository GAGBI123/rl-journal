// Linux desktop integration: app-menu entry for the AppImage, "start when I log in" and XWayland.
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DESKTOP_FILE = 'rl-journal.desktop';

const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
const configHome = () => process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

/** The file to launch: the AppImage when running from one, otherwise the executable. */
function launchTarget() {
  return process.env.APPIMAGE || process.execPath;
}

/** What to start to run under XWayland, or null when this instance should just carry on. */
export function xwaylandRelaunchPlan(
  env: NodeJS.ProcessEnv,
  argv: string[],
  hasSwitch: (name: string) => boolean,
  execPath: string,
): { file: string; args: string[]; env: NodeJS.ProcessEnv } | null {
  if (!onWayland(env)) return null;
  if (!env.DISPLAY) return null; // no XWayland on this desktop
  if (env.RLJ_WAYLAND === '1' || env.RLJ_XWAYLAND_RELAUNCH === '1') return null;
  if (hasSwitch('ozone-platform') || hasSwitch('ozone-platform-hint')) return null;
  const next: NodeJS.ProcessEnv = { ...env, RLJ_XWAYLAND_RELAUNCH: '1' };
  // The AppImage launcher put this mount's folders in front of these; the new AppImage mounts its own
  // copy and this one goes away when this instance exits.
  const appDir = env.APPDIR;
  if (appDir) {
    for (const key of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']) {
      const kept = (env[key] ?? '').split(':').filter((p) => p && p !== appDir && !p.startsWith(`${appDir}/`));
      if (kept.length) next[key] = kept.join(':');
      else delete next[key];
    }
    delete next.APPDIR;
  }
  delete next.GDK_BACKEND; // GTK has to follow the X11 window system, not a Wayland setting
  return { file: env.APPIMAGE || execPath, args: [...argv.slice(1), '--ozone-platform=x11'], env: next };
}

/** Electron picks native Wayland for itself under these conditions (its default since Electron 38). */
export function onWayland(env = process.env) {
  return env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY || !!env.WAYLAND_SOCKET;
}

/**
 * Wayland doesn't let an app keep a window above other windows (Electron: alwaysOnTop "not supported on
 * Wayland"), so the timer overlay never showed over the game. Rocket League runs through Proton on XWayland
 * anyway, so on a Wayland desktop RL Journal starts itself again under XWayland (--ozone-platform=x11),
 * where the overlay (focusable: false = left alone by the window manager) stays on top of the game, in
 * fullscreen too. Call before taking the single-instance lock; true = a new instance was started, so quit.
 * RLJ_WAYLAND=1 (or passing --ozone-platform yourself) keeps the native Wayland window.
 */
export function relaunchUnderXWayland(): boolean {
  if (process.platform !== 'linux') return false;
  const plan = xwaylandRelaunchPlan(process.env, process.argv, (s) => app.commandLine.hasSwitch(s), process.execPath);
  // Only guards this one hop: apps this instance starts later (e.g. after an update) decide for themselves.
  delete process.env.RLJ_XWAYLAND_RELAUNCH;
  if (!plan) return false;
  try {
    const child = spawn(plan.file, plan.args, { detached: true, stdio: 'ignore', env: plan.env });
    child.unref();
    return true;
  } catch (err) {
    console.warn('Starting under XWayland failed', err);
    return false;
  }
}

function quoteExec(p: string) {
  return `"${p.replace(/(["`$\\])/g, '\\$1')}"`;
}

function desktopEntry(args: string, extra = '') {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RL Journal',
    'Comment=Rocket League training and games journal',
    `Exec=${quoteExec(launchTarget())}${args}`,
    'Icon=rl-journal',
    'Terminal=false',
    'Categories=Game;Utility;',
    'StartupWMClass=RL Journal',
    extra,
  ]
    .filter(Boolean)
    .join('\n') + '\n';
}

async function writeIfChanged(file: string, text: string) {
  const current = await fs.readFile(file, 'utf8').catch(() => null);
  if (current === text) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}

/**
 * When started from an AppImage, add RL Journal to the app menu (and keep the path current,
 * since updates and moving the file change it). Runs on every start; cheap when nothing changed.
 */
export async function integrateAppImage(iconFile: string | undefined) {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return;
  try {
    if (iconFile && existsSync(iconFile)) {
      const dest = path.join(dataHome(), 'icons', 'hicolor', '512x512', 'apps', 'rl-journal.png');
      // Compared byte for byte: the icon can be a picture the user picked (Settings → Appearance).
      const [a, b] = await Promise.all([fs.readFile(iconFile).catch(() => null), fs.readFile(dest).catch(() => null)]);
      if (!b || !a || !a.equals(b)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(iconFile, dest);
      }
    }
    await writeIfChanged(path.join(dataHome(), 'applications', DESKTOP_FILE), desktopEntry(' %U'));
  } catch (err) {
    console.warn('AppImage integration failed', err);
  }
}

/** Linux autostart via ~/.config/autostart (the XDG standard all desktops follow). */
export async function setLinuxAutostart(enabled: boolean) {
  if (process.platform !== 'linux' || !app.isPackaged) return;
  const file = path.join(configHome(), 'autostart', DESKTOP_FILE);
  try {
    if (enabled) await writeIfChanged(file, desktopEntry(' --hidden', 'X-GNOME-Autostart-enabled=true'));
    else await fs.unlink(file).catch(() => undefined);
  } catch (err) {
    console.warn('Autostart setup failed', err);
  }
}
