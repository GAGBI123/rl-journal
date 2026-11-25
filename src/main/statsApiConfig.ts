// Finds the Rocket League install and enables the official Stats API in its ini file.
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type { StatsApiSetupResult } from '../shared/model';
import { linuxRocketLeagueCandidates } from './rlInstallLinux';

const SECTION = '[TAGame.MatchStatsExporter_TA]';

async function epicInstalls(): Promise<string[]> {
  const dir = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';
  const out: string[] = [];
  try {
    for (const f of await fs.readdir(dir)) {
      if (!f.endsWith('.item')) continue;
      try {
        const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        if (/rocket\s*league/i.test(j.DisplayName ?? '') && j.InstallLocation) out.push(j.InstallLocation);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no Epic */
  }
  return out;
}

async function steamInstalls(): Promise<string[]> {
  const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];
  const libs = new Set<string>(roots);
  for (const root of roots) {
    try {
      const vdf = await fs.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
    } catch {
      /* no Steam here */
    }
  }
  return [...libs].map((l) => path.join(l, 'steamapps', 'common', 'rocketleague'));
}

export async function findRocketLeagueInstall(): Promise<string | null> {
  if (process.platform === 'linux') {
    const found = (await linuxRocketLeagueCandidates()).find((c) => existsSync(path.join(c, 'TAGame', 'Config')));
    return found ?? null;
  }
  const candidates = [
    ...(await epicInstalls()),
    ...(await steamInstalls()),
    'C:\\Program Files\\Epic Games\\rocketleague',
    'D:\\Epic Games\\rocketleague',
    'D:\\Program Files\\Epic Games\\rocketleague',
    'D:\\SteamLibrary\\steamapps\\common\\rocketleague',
    'E:\\Epic Games\\rocketleague',
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'TAGame', 'Config'))) return c;
  }
  return null;
}

function configFile(installDir: string): string | null {
  const dir = path.join(installDir, 'TAGame', 'Config');
  for (const name of ['TAStatsAPI.ini', 'DefaultStatsAPI.ini']) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Set keys inside the Stats API section, keeping everything else intact. */
export function applyStatsApiSettings(ini: string, wanted: { PacketSendRate: number; Port: number; WebPort: number }) {
  const eol = ini.includes('\r\n') ? '\r\n' : '\n';
  const lines = ini.length ? ini.split(/\r?\n/) : [];
  let start = lines.findIndex((l) => l.trim().toLowerCase() === SECTION.toLowerCase());
  if (start === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(SECTION);
    start = lines.length - 1;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const current: Record<string, string> = {};
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/);
    if (m) current[m[1]] = m[2];
  }
  const rate = Number(current.PacketSendRate);
  const port = Number(current.Port);
  const webPort = Number(current.WebPort);
  const final = {
    PacketSendRate: rate > 0 ? rate : wanted.PacketSendRate,
    Port: port > 0 ? port : wanted.Port,
    WebPort: webPort > 0 ? webPort : wanted.WebPort,
  };
  if (final.Port === final.WebPort) final.Port = final.WebPort - 1;
  const section = lines.slice(start + 1, end).filter((l) => !/^\s*(PacketSendRate|Port|WebPort)\s*=/.test(l));
  while (section.length && section[section.length - 1].trim() === '') section.pop();
  const newSection = [
    ...section,
    `PacketSendRate=${final.PacketSendRate}`,
    `Port=${final.Port}`,
    `WebPort=${final.WebPort}`,
  ];
  const tail = lines.slice(end);
  const out = [...lines.slice(0, start + 1), ...newSection, ...(tail.length ? ['', ...tail] : [''])];
  return { text: out.join(eol), final, changed: rate <= 0 || !(webPort > 0) || !(port > 0) || isNaN(rate) };
}

export async function getStatsApiStatus(installDir?: string) {
  const dir = installDir || (await findRocketLeagueInstall());
  if (!dir) return { found: false as const };
  const file = configFile(dir);
  if (!file) return { found: true as const, installDir: dir, file: null, enabled: false };
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const { final, changed } = applyStatsApiSettings(text, { PacketSendRate: 0, Port: 0, WebPort: 0 });
  return {
    found: true as const,
    installDir: dir,
    file,
    enabled: !changed && final.PacketSendRate > 0 && final.WebPort > 0,
    webPort: final.WebPort,
    packetSendRate: final.PacketSendRate,
  };
}

export async function setupStatsApi(installDir?: string): Promise<StatsApiSetupResult & { webPort?: number }> {
  const dir = installDir || (await findRocketLeagueInstall());
  if (!dir) {
    return { ok: false, message: 'Rocket League install folder not found. Choose it manually (the folder that contains "TAGame").' };
  }
  const file = configFile(dir);
  if (!file) {
    return {
      ok: false,
      path: path.join(dir, 'TAGame', 'Config'),
      message: 'No TAStatsAPI.ini or DefaultStatsAPI.ini found in TAGame\\Config. Update Rocket League, then try again.',
    };
  }
  const text = await fs.readFile(file, 'utf8');
  const { text: updated, final, changed } = applyStatsApiSettings(text, { PacketSendRate: 2, Port: 49123, WebPort: 49124 });
  if (!changed) {
    return { ok: true, path: file, webPort: final.WebPort, message: `Stats API is already enabled (WebSocket port ${final.WebPort}).` };
  }
  try {
    const backup = file + '.rljournal.bak';
    if (!existsSync(backup)) await fs.copyFile(file, backup);
    await fs.writeFile(file, updated, 'utf8');
  } catch (err: any) {
    const denied = err?.code === 'EPERM' || err?.code === 'EACCES';
    return {
      ok: false,
      path: file,
      message: denied
        ? process.platform === 'win32'
          ? 'Windows blocked writing to the game folder. Run RL Journal as administrator once and try again, or edit the file manually.'
          : 'No permission to write to the game folder. Edit the file manually (see below).'
        : `Could not write the file: ${err?.message ?? err}`,
    };
  }
  return {
    ok: true,
    path: file,
    webPort: final.WebPort,
    needsRestart: true,
    message: `Stats API enabled (WebSocket port ${final.WebPort}). Restart Rocket League for it to take effect.`,
  };
}
