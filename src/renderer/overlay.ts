// In-game timer overlay: shows the running timer and lets you pause / resume it. For an amount
// (routine amount item) it shows how many to do and a done button. A timer auto-next moved to shows
// as "ready" until it's started; a countdown that reached 0 flashes at 0:00 until done is pressed.
import { displayMs, elapsedMs, fmtClock, fmtCount, isCount, isCountUp, isEnded, isReady, isRunning, type TimerState } from '../shared/timer';

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
  const count = isCount(timer);
  const ended = isEnded(timer);
  const ready = isReady(timer);
  pill.classList.toggle('count', count);
  pill.classList.toggle('ended', ended);
  pill.classList.toggle('ready', ready);
  $('toggle').classList.toggle('hidden', count || ended);
  if (count) {
    pill.classList.remove('paused');
    pill.style.setProperty('--c', timer.color ?? '#3b82f6');
    $('label').textContent = timer.label;
    $('time').textContent = fmtCount(timer.amount);
    const state = $('state');
    state.textContent = 'PRESS ✓ WHEN DONE';
    state.classList.add('sw');
    state.classList.remove('hidden');
    ($('bar') as HTMLDivElement).style.width = '0%';
    $('done').title = 'Done: tick it off (and start the next item)';
    $('done').setAttribute('aria-label', 'Done: tick it off');
    return;
  }
  if (ended) {
    pill.classList.remove('paused');
    pill.style.setProperty('--c', timer.color ?? '#3b82f6');
    $('label').textContent = timer.label;
    $('time').textContent = '0:00';
    const state = $('state');
    state.textContent = 'DONE · PRESS ✓ TO LOG';
    state.classList.add('sw');
    state.classList.remove('hidden');
    ($('bar') as HTMLDivElement).style.width = '100%';
    ($('bar') as HTMLDivElement).style.opacity = '1';
    $('done').title = 'Log it';
    $('done').setAttribute('aria-label', 'Log the finished timer');
    return;
  }
  const running = isRunning(timer);
  pill.classList.toggle('paused', !running && !ready);
  pill.style.setProperty('--c', timer.color ?? '#3b82f6');
  $('label').textContent = timer.label;
  const up = isCountUp(timer);
  $('time').textContent = fmtClock(displayMs(timer));
  // Paused shows PAUSED; a running stopwatch shows STOPWATCH so it's clear the time counts up.
  const state = $('state');
  state.textContent = ready ? 'READY · PRESS ▶' : running ? 'STOPWATCH' : 'PAUSED';
  state.classList.toggle('sw', running);
  state.classList.toggle('rd', ready);
  state.classList.toggle('hidden', running && !up);
  const pct = up ? 100 : Math.min(100, (elapsedMs(timer) / Math.max(1, timer.durationMs)) * 100);
  ($('bar') as HTMLDivElement).style.width = `${pct}%`;
  ($('bar') as HTMLDivElement).style.opacity = up ? '0.35' : '1';
  $('done').title = up ? 'Stop and log the time' : 'Finish now and log the time so far';
  $('done').setAttribute('aria-label', 'Stop and log the time');
  const btn = $('toggle');
  const icon = running ? PAUSE : PLAY;
  if (btn.innerHTML !== icon) btn.innerHTML = icon;
  btn.title = ready ? 'Start' : running ? 'Pause' : 'Resume';
}

// React on press, not click: while the game has focus it can swallow the mouse release. Every event
// that can carry the press is handled; the main process ignores the repeats (one press = one action).
function bind(id: string, action: 'toggle' | 'finish') {
  const press = (e: Event) => {
    e.preventDefault();
    void window.rlj.overlayPress(action);
  };
  for (const ev of ['pointerdown', 'mousedown', 'click'] as const) $(id).addEventListener(ev, press);
}
bind('toggle', 'toggle');
bind('done', 'finish');

// Flash the button when a press arrives (also from the shortcut), so it's clear it was received.
window.rlj.onOverlayFlash((action) => {
  const el = $(action === 'finish' ? 'done' : 'toggle');
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
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
