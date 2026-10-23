/**
 * Admin FX: cursor spotlight on panels, key tilt, ripples, result flash,
 * and a live mini "mirror" of the stage wheel.
 * window.adminFX.{setTarget, spin, result, reset}
 */
(function () {
  const COLORS = { shipwreck: '#22b8f0', interview: '#8f7bff', hints_development: '#2ee6c0' };
  const ORDER = ['shipwreck', 'interview', 'hints_development'];
  const LABELS = { shipwreck: 'SHIP', interview: 'INTV', hints_development: 'HINTS' };
  const body = document.body;

  // ---------- panel spotlight ----------
  document.addEventListener('pointermove', (e) => {
    document.querySelectorAll('.panel').forEach(p => {
      const r = p.getBoundingClientRect();
      p.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      p.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }, { passive: true });

  // ---------- ripple on keys + buttons ----------
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.key, .btn');
    if (!el || el.disabled) return;
    const r = el.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.left = (e.clientX - r.left) + 'px';
    s.style.top = (e.clientY - r.top) + 'px';
    el.appendChild(s);
    setTimeout(() => s.remove(), 750);
  });

  // ---------- key tilt ----------
  const fine = window.matchMedia('(pointer: fine)').matches;
  if (fine) document.querySelectorAll('.key').forEach(k => {
    k.addEventListener('pointermove', (e) => {
      const r = k.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      k.classList.add('tilt');
      k.style.transform = `translateY(-4px) rotateX(${(-y * 14).toFixed(1)}deg) rotateY(${(x * 14).toFixed(1)}deg)`;
    });
    k.addEventListener('pointerleave', () => { k.classList.remove('tilt'); k.style.transform = ''; });
  });

  // ---------- result flash element ----------
  const flash = document.createElement('div');
  flash.className = 'result-flash';
  body.appendChild(flash);

  // ---------- mirror wheel ----------
  const cv = document.getElementById('mirrorWheel');
  const ctx = cv ? cv.getContext('2d') : null;
  let angle = -Math.PI / 2 - Math.PI / 3, spinning = false, lockKey = null, lockT = 0, energy = 0, prev = angle;
  const slice = (Math.PI * 2) / 3;

  function size() {
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 148;
    cv.width = w * dpr; cv.height = w * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size(); window.addEventListener('resize', size);

  function draw(now) {
    if (!ctx) return;
    const w = cv.clientWidth || 148, c = w / 2, R = c - 8;
    if (!spinning) angle += 0.003;
    energy += (Math.min(1, Math.abs(angle - prev) / 0.25) - energy) * 0.2; prev = angle;
    if (lockT > 0) lockT = Math.max(0, lockT - 0.006);
    ctx.clearRect(0, 0, w, w);

    // glow ring
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R + 4, 0, Math.PI * 2);
    ctx.strokeStyle = lockKey && lockT > 0 ? COLORS[lockKey] : `rgba(127,176,255,${0.35 + energy * 0.6})`;
    ctx.lineWidth = 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12 + energy * 20; ctx.stroke();
    ctx.restore();

    ctx.save(); ctx.translate(c, c); ctx.rotate(angle);
    ORDER.forEach((k, i) => {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i * slice, (i + 1) * slice); ctx.closePath();
      const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
      g.addColorStop(0, '#030714'); g.addColorStop(1, COLORS[k]);
      ctx.globalAlpha = lockKey && lockT > 0 && lockKey !== k ? 0.3 : 1;
      ctx.fillStyle = g; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(230,238,255,.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(i * slice) * R, Math.sin(i * slice) * R); ctx.stroke();
      const mid = i * slice + slice / 2;
      ctx.save(); ctx.rotate(mid); ctx.translate(R * 0.62, 0); ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#fff'; ctx.font = '700 10px Unbounded, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(LABELS[k], 0, 0); ctx.restore();
    });
    ctx.restore();

    // hub
    ctx.beginPath(); ctx.arc(c, c, R * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = spinning ? '#ff2d55' : '#dce7ff'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = spinning ? 16 : 6; ctx.fill(); ctx.shadowBlur = 0;
    // needle
    ctx.beginPath(); ctx.moveTo(c - 7, 2); ctx.lineTo(c + 7, 2); ctx.lineTo(c, 18); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();

    requestAnimationFrame(draw);
  }
  if (ctx) requestAnimationFrame(draw);

  function spinTo(target, duration) {
    const idx = Math.max(0, ORDER.indexOf(target));
    const pointer = (3 * Math.PI) / 2;
    const want = pointer - (idx * slice + slice / 2);
    const start = angle;
    let delta = (((want - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const total = 6 * Math.PI * 2 + delta;
    const ms = ((duration || 6) + 0.55) * 1000;
    const t0 = performance.now();
    spinning = true; lockKey = null; lockT = 0;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      angle = start + total * (1 - Math.pow(1 - p, 4.2));
      if (p < 1) requestAnimationFrame(step); else spinning = false;
    };
    requestAnimationFrame(step);
  }

  window.adminFX = {
    setTarget(key) { document.documentElement.style.setProperty('--sel-hue', COLORS[key] || '#22b8f0'); },
    spin(target, duration) { body.classList.add('is-live-admin'); spinTo(target, duration); },
    result(key) {
      spinning = false; lockKey = key; lockT = 1;
      flash.style.setProperty('--flash', (COLORS[key] || '#ffffff') + '88');
      flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    },
    reset() { body.classList.remove('is-live-admin'); lockKey = null; lockT = 0; }
  };
})();
