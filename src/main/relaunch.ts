// Makes sure the app comes back after a Windows update.
// The NSIS installer is asked to restart the app (--force-run), but that step is unreliable, so a tiny
// hidden watcher waits for this process and the installer to finish, then starts the app unless it is
// already running. Duplicate launches are ignored in the second-instance handler (they carry --updated).
import { spawn } from 'node:child_process';
import { log } from './log';

const ps = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function scheduleRelaunchAfterWindowsUpdate() {
  if (process.platform !== 'win32') return; // the AppImage updater starts the new file itself
  const exe = process.execPath;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Wait-Process -Id ${process.pid} -Timeout 120`,
    'Start-Sleep -Seconds 2',
    '$deadline = (Get-Date).AddMinutes(10)',
    "while ((Get-Process -Name 'RL-Journal-Setup*') -and ((Get-Date) -lt $deadline)) { Start-Sleep -Seconds 1 }",
    'Start-Sleep -Seconds 3',
    `if (-not (Get-Process | Where-Object { $_.Path -eq ${ps(exe)} })) { Start-Process -FilePath ${ps(exe)} -ArgumentList '--updated' }`,
  ].join('; ');
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log('relaunch watcher started', child.pid);
  } catch (err) {
    log('relaunch watcher failed', String(err));
  }
}
