// In-game timer overlay: shows the running timer and lets you pause / resume it.
import { displayMs, elapsedMs, fmtClock, isCountUp, isRunning, type TimerState } from '../shared/timer';

const $ = (id: string) => document.getElementById(id)!;
const PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

let timer: TimerState | null = null;

function render() {
  const pill = $('pill');
  if (!timer) {
    pill.classList.add('hidden');
    return;
  }
  pill.classList.remove('hidden');
  const running = isRunning(timer);
  pill.classList.toggle('paused', !running);
  pill.style.setProperty('--c', timer.color ?? '#3b82f6');
  $('label').textContent = timer.label;
  const up = isCountUp(timer);
  $('time').textContent = fmtClock(displayMs(timer));
  // Paused shows PAUSED; a running stopwatch shows STOPWATCH so it's clear the time counts up.
  const state = $('state');
  state.textContent = running ? 'STOPWATCH' : 'PAUSED';
  state.classList.toggle('sw', running);
  state.classList.toggle('hidden', running && !up);
  const pct = up ? 100 : Math.min(100, (elapsedMs(timer) / Math.max(1, timer.durationMs)) * 100);
  ($('bar') as HTMLDivElement).style.width = `${pct}%`;
  ($('bar') as HTMLDivElement).style.opacity = up ? '0.35' : '1';
  $('done').title = up ? 'Stop and log the time' : 'Finish now and log the time so far';
  const btn = $('toggle');
  const icon = running ? PAUSE : PLAY;
  if (btn.innerHTML !== icon) btn.innerHTML = icon;
  btn.title = running ? 'Pause' : 'Resume';
}

// React on press, not click: while the game has focus it can swallow the mouse release.
let lastPress = 0;
$('toggle').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const now = Date.now();
  if (now - lastPress < 400) return;
  lastPress = now;
  void window.rlj.timerControl('toggle');
});

$('done').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const now = Date.now();
  if (now - lastPress < 400) return;
  lastPress = now;
  void window.rlj.timerControl('finish');
});

window.rlj.onOverlayHint((hint) => {
  $('hint').textContent = hint;
  $('hint').classList.toggle('hidden', !hint);
});

window.rlj.onTimerState((t) => {
  timer = t;
  render();
});
void window.rlj.timerGet().then((t) => {
  timer = t;
  render();
});
setInterval(render, 250);
