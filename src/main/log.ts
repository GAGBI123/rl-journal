// Small main-process log (userData/logs/main.log) for diagnosing updates and startup on users' PCs.
import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;
let file: string | null = null;

function target() {
  if (file) return file;
  const dir = path.join(app.getPath('userData'), 'logs');
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'main.log');
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, path.join(dir, 'main.old.log'));
  } catch {
    /* no log yet */
  }
  return file;
}

export function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} [${process.pid}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try {
    appendFileSync(target(), line, 'utf8');
  } catch {
    /* logging must never break the app */
  }
  if (!app.isPackaged) process.stdout.write(line);
}
