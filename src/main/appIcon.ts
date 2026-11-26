// The app icon: the built-in one, or a picture the user picked in Settings → Appearance.
// The picked picture is stored in the data folder and used for the window, the tray, notifications,
// the Linux menu entry and (Windows) the app's own shortcuts on the desktop, Start menu and taskbar.
import { app, nativeImage, shell, type NativeImage } from 'electron';
import { promises as fs, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { log } from './log';

const ICON_SIZE = 512;
const customPng = () => path.join(app.getPath('userData'), 'app-icon.png');
/** Windows shortcut icons (.ico), a new name each time so Explorer doesn't keep showing a cached one. */
const icoName = /^app-icon-\d+\.ico$/;

export function builtInIconPath(): string | undefined {
  const candidates = [path.join(app.getAppPath(), 'assets', 'icon.png'), path.join(__dirname, '..', 'assets', 'icon.png')];
  return candidates.find((p) => existsSync(p));
}

export function hasCustomIcon() {
  return existsSync(customPng());
}

/** The icon file to use right now. */
export function iconPath(): string | undefined {
  return hasCustomIcon() ? customPng() : builtInIconPath();
}

export function iconImage(size?: number): NativeImage {
  const file = iconPath();
  const img = file ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  return size && !img.isEmpty() ? img.resize({ width: size, height: size, quality: 'best' }) : img;
}

/** The custom icon as a data URL for the app's own UI (null = the built-in icon). */
export function customIconDataUrl(): string | null {
  if (!hasCustomIcon()) return null;
  const img = nativeImage.createFromPath(customPng());
  return img.isEmpty() ? null : img.toDataURL();
}

function currentIco(): string | undefined {
  try {
    const dir = app.getPath('userData');
    const name = readdirSync(dir).filter((f) => icoName.test(f)).sort().pop();
    return name ? path.join(dir, name) : undefined;
  } catch {
    return undefined;
  }
}

/** An .ico with PNG images inside (Windows Vista and newer read these). */
function makeIco(img: NativeImage): Buffer {
  const sizes = [256, 64, 48, 32, 24, 16];
  const pngs = sizes.map((s) => img.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, at);
    header.writeUInt8(s >= 256 ? 0 : s, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[i].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** Save a picked picture (a PNG data URL from the app, already square) as the app icon. */
export async function setCustomIcon(dataUrl: string): Promise<boolean> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > 8_000_000) return false;
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) return false;
  const square = img.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' });
  await fs.writeFile(customPng(), square.toPNG());
  if (process.platform === 'win32') {
    const old = currentIco();
    await fs.writeFile(path.join(app.getPath('userData'), `app-icon-${Date.now()}.ico`), makeIco(square));
    if (old) await fs.unlink(old).catch(() => undefined);
  }
  log('custom app icon set');
  return true;
}

export async function clearCustomIcon() {
  await fs.unlink(customPng()).catch(() => undefined);
  const ico = currentIco();
  syncShortcutIcons();
  if (ico) await fs.unlink(ico).catch(() => undefined);
  log('custom app icon removed');
}

function shortcutFiles(): string[] {
  const appData = app.getPath('appData');
  const dirs = [
    app.getPath('desktop'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
  ];
  const out: string[] = [];
  const scan = (dir: string, depth: number) => {
    let names: import('node:fs').Dirent[];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of names) {
      const full = path.join(dir, d.name);
      if (d.isFile() && /\.lnk$/i.test(d.name)) out.push(full);
      else if (d.isDirectory() && depth > 0) scan(full, depth - 1);
    }
  };
  for (const dir of dirs) scan(dir, 1);
  return out;
}

/**
 * Windows: point the shortcuts that start this RL Journal at the custom icon (or back at the app's
 * own icon). Only shortcuts whose target is this app's exe are touched, and only in the installed app.
 */
export function syncShortcutIcons() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const exe = path.resolve(process.execPath).toLowerCase();
  const ico = hasCustomIcon() ? currentIco() : undefined;
  let changed = 0;
  for (const file of shortcutFiles()) {
    try {
      const link = shell.readShortcutLink(file);
      if (!link.target || path.resolve(link.target).toLowerCase() !== exe) continue;
      const icon = (link.icon ?? '').toLowerCase();
      if (ico) {
        if (icon === ico.toLowerCase()) continue;
        shell.writeShortcutLink(file, 'update', { ...link, icon: ico, iconIndex: 0 });
      } else {
        // Back to the app's own icon, but only for shortcuts that had a custom one.
        if (!icoName.test(path.basename(icon))) continue;
        shell.writeShortcutLink(file, 'update', { ...link, icon: process.execPath, iconIndex: 0 });
      }
      changed++;
    } catch (err) {
      log('shortcut icon update failed', path.basename(file), String(err));
    }
  }
  if (changed) log('shortcut icons updated', changed);
}
