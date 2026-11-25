// Linux desktop integration: app-menu entry for the AppImage and "start when I log in".
import { app } from 'electron';
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
      const [a, b] = await Promise.all([fs.stat(iconFile).catch(() => null), fs.stat(dest).catch(() => null)]);
      if (!b || !a || a.size !== b.size) {
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
