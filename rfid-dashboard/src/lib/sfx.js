// rfid-dashboard/src/lib/sfx.js
let ctx;
export function softClick() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 1800; // Hz
    g.gain.value = 0.02;
    o.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    o.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    o.stop(now + 0.06);
  } catch {
    /* ignore audio failures */
  }
}
