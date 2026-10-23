/**
 * Stage FX: 3D starfield that drifts at idle and turns into a warp tunnel
 * as the wheel speeds up. Centre follows the wheel. window.stageFX.{setEnergy, setHue, burst}
 */
(function () {
  const canvas = document.getElementById('fxCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0;
  let energy = 0, hue = [160, 190, 255], burstT = 0;
  const N = 320;
  const stars = [];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function reset(s, far) {
    s.x = rnd(-1, 1); s.y = rnd(-1, 1); s.z = far ? rnd(0.6, 1) : rnd(0.05, 1);
    s.px = null; s.py = null; s.tw = Math.random() * 6.28;
  }
  for (let i = 0; i < N; i++) { const s = {}; reset(s, false); stars.push(s); }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rig = document.getElementById('wheelRig');
    if (rig) { const r = rig.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    else { cx = W / 2; cy = H / 2; }
  }
  window.addEventListener('resize', resize);
  setTimeout(resize, 50); resize();

  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    const speed = 0.0012 + energy * 0.03 + burstT * 0.02;
    const k = Math.max(W, H) * 0.55;
    const streak = energy > 0.08 || burstT > 0.05;
    const [r, g, b] = hue;
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.z -= speed;
      if (s.z <= 0.02) { reset(s, true); continue; }
      const sx = cx + (s.x / s.z) * k, sy = cy + (s.y / s.z) * k;
      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) { reset(s, true); continue; }
      const depth = 1 - s.z;
      const a = Math.min(1, depth * 1.3) * (0.55 + 0.45 * Math.sin(now / 400 + s.tw));
      const size = 0.4 + depth * 2.2;
      if (streak && s.px !== null) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.9})`;
        ctx.lineWidth = size;
        ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(sx, sy); ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.8})`;
        ctx.beginPath(); ctx.arc(sx, sy, size * 0.6, 0, 6.283); ctx.fill();
      }
      s.px = sx; s.py = sy;
    }
    if (burstT > 0) burstT = Math.max(0, burstT - 0.012);
    requestAnimationFrame(frame);
  }
  if (!reduced) requestAnimationFrame(frame);

  function hexToRgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }

  window.stageFX = {
    setEnergy(e) { energy = e; },
    setHue(h) { hue = h ? hexToRgb(h).map(v => Math.round(v * 0.6 + 255 * 0.4)) : [160, 190, 255]; },
    burst() { burstT = 1; resize(); }
  };
})();
