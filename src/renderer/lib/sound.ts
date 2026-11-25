// A short, soft two-note chime for "timer finished" (no audio files needed).
export function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [
      { f: 880, at: 0 },
      { f: 1318.5, at: 0.18 },
      { f: 1760, at: 0.36 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      const t = ctx.currentTime + n.at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    }
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* sound is optional */
  }
}
