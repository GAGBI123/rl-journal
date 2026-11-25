import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'journal.json');
const backupDir = () => path.join(dataDir(), 'backups');

export async function loadData(): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(dataFile(), 'utf8');
    return JSON.parse(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    // Corrupt file: keep a copy and try the newest backup.
    try {
      await fs.copyFile(dataFile(), path.join(dataDir(), `journal.corrupt-${Date.now()}.json`));
    } catch {
      /* ignore */
    }
    return loadNewestBackup();
  }
}

async function loadNewestBackup(): Promise<unknown | null> {
  try {
    const files = (await fs.readdir(backupDir())).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.reverse()) {
      try {
        return JSON.parse(await fs.readFile(path.join(backupDir(), f), 'utf8'));
      } catch {
        /* try older */
      }
    }
  } catch {
    /* no backups */
  }
  return null;
}

let writing: Promise<void> = Promise.resolve();

/** Atomic save (write temp + rename), serialized so writes never interleave. */
export function saveData(data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  writing = writing.then(async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = dataFile() + '.tmp';
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, dataFile());
    await dailyBackup(json);
  }).catch((err) => {
    console.error('Failed to save data', err);
  });
  return writing;
}

let lastBackupDay = '';
async function dailyBackup(json: string) {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastBackupDay) return;
  lastBackupDay = day;
  await fs.mkdir(backupDir(), { recursive: true });
  await fs.writeFile(path.join(backupDir(), `journal-${day}.json`), json, 'utf8');
  const files = (await fs.readdir(backupDir())).filter((f) => f.startsWith('journal-')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 14))) {
    await fs.unlink(path.join(backupDir(), f)).catch(() => undefined);
  }
}

export function getDataFolder() {
  return dataDir();
}
