// Finds Rocket League on Linux, where it runs through Proton (Steam) or Wine (Heroic / Lutris / Bottles).
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function steamInstalls(home: string): Promise<string[]> {
  const roots = [
    path.join(home, '.local/share/Steam'),
    path.join(home, '.steam/steam'),
    path.join(home, '.steam/root'),
    path.join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),
    path.join(home, '.var/app/com.valvesoftware.Steam/data/Steam'),
  ];
  const libs = new Set<string>(roots);
  for (const root of roots) {
    try {
      const vdf = await fs.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1]);
    } catch {
      /* no Steam here */
    }
  }
  return [...libs].map((l) => path.join(l, 'steamapps', 'common', 'rocketleague'));
}

/** Heroic and legendary keep Epic installs in installed.json: { appName: { title, install_path } }. */
async function legendaryInstalls(home: string): Promise<string[]> {
  const files = [
    path.join(home, '.config/heroic/legendaryConfig/legendary/installed.json'),
    path.join(home, '.var/app/com.heroicgameslauncher.hgl/config/heroic/legendaryConfig/legendary/installed.json'),
    path.join(home, '.config/legendary/installed.json'),
  ];
  const out: string[] = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(f, 'utf8'));
      for (const v of Object.values<any>(j)) {
        if (/rocket\s*league/i.test(v?.title ?? '') && v?.install_path) out.push(String(v.install_path));
      }
    } catch {
      /* not installed */
    }
  }
  return out;
}

/** Convert a Windows path from a Wine prefix ("C:\\Program Files\\…") to the Linux path inside drive_c. */
export function winePathToLinux(driveC: string, winPath: string) {
  const rel = winPath.replace(/^[A-Za-z]:[\\/]/, '').split(/[\\/]+/).filter(Boolean);
  return path.posix.join(driveC, ...rel);
}

/** Epic Games Launcher inside a Wine prefix (Lutris, Bottles, plain Wine). */
async function winePrefixInstalls(home: string): Promise<string[]> {
  const prefixes = [path.join(home, '.wine')];
  for (const base of [path.join(home, 'Games'), path.join(home, '.local/share/bottles/bottles')]) {
    try {
      for (const d of await fs.readdir(base)) prefixes.push(path.join(base, d));
    } catch {
      /* none */
    }
  }
  const out: string[] = [];
  for (const prefix of prefixes) {
    const driveC = path.join(prefix, 'drive_c');
    if (!existsSync(driveC)) continue;
    const manifests = path.join(driveC, 'ProgramData/Epic/EpicGamesLauncher/Data/Manifests');
    try {
      for (const f of await fs.readdir(manifests)) {
        if (!f.endsWith('.item')) continue;
        try {
          const j = JSON.parse(await fs.readFile(path.join(manifests, f), 'utf8'));
          if (/rocket\s*league/i.test(j.DisplayName ?? '') && j.InstallLocation) out.push(winePathToLinux(driveC, String(j.InstallLocation)));
        } catch {
          /* skip */
        }
      }
    } catch {
      /* no Epic launcher in this prefix */
    }
    out.push(path.join(driveC, 'Program Files/Epic Games/rocketleague'));
  }
  return out;
}

export async function linuxRocketLeagueCandidates(home = os.homedir()): Promise<string[]> {
  return [
    ...(await legendaryInstalls(home)),
    ...(await steamInstalls(home)),
    ...(await winePrefixInstalls(home)),
    path.join(home, 'Games/Heroic/rocketleague'),
    path.join(home, 'Games/rocketleague'),
  ];
}
