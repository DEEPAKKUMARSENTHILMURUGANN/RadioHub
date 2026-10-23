/**
 * Confetti engine — side cannons + centre burst, fluttering paper physics.
 * start(durationMs, colors?) · burst(count, colors?) · stop()
 */
class ConfettiEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.animId = null;
    this.colors = ['#3d7bff', '#dce7ff', '#ffffff', '#ffb547', '#8f7bff'];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  spawn(x, y, angle, spread, power, count, colors) {
    const unit = Math.min(this.w, this.h) / 900;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = power * (0.55 + Math.random() * 0.6) * unit;
      const ribbon = Math.random() < 0.18;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: (ribbon ? 4 : 8 + Math.random() * 7) * unit,
        h: (ribbon ? 22 + Math.random() * 18 : 5 + Math.random() * 5) * unit,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        tilt: Math.random() * Math.PI * 2,
        vtilt: 0.08 + Math.random() * 0.12,
        drag: 0.985 - Math.random() * 0.01,
        g: 0.32 * unit,
        life: 1
      });
    }
    if (!this.animId) this.animId = requestAnimationFrame(() => this.animate());
  }

  burst(count = 160, colors = this.colors) {
    if (!this.canvas) return;
    this.resize();
    this.spawn(this.w * 0.5, this.h * 0.45, -Math.PI / 2, Math.PI * 2, 26, count, colors);
  }

  start(duration = 4000, colors) {
    if (!this.canvas) return;
    this.resize();
    const c = colors && colors.length ? colors : this.colors;
    // corner cannons
    this.spawn(0, this.h, -Math.PI / 3.2, 0.5, 44, 110, c);
    this.spawn(this.w, this.h, -Math.PI + Math.PI / 3.2, 0.5, 44, 110, c);
    setTimeout(() => this.burst(120, c), 180);
    // gentle rain while it lasts
    clearInterval(this.rainTimer);
    const end = Date.now() + duration;
    this.rainTimer = setInterval(() => {
      if (Date.now() > end) { clearInterval(this.rainTimer); return; }
      for (let i = 0; i < 6; i++) this.spawn(Math.random() * this.w, -20, Math.PI / 2, 0.6, 3, 1, c);
    }, 90);
  }

  animate() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g;
      p.vx += Math.sin(p.tilt) * 0.15;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.vrot; p.tilt += p.vtilt;
      if (p.y > this.h * 0.75) p.life -= 0.02;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt));        // paper flip
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();

      if (p.life <= 0 || p.y > this.h + 60 || p.x < -80 || p.x > this.w + 80) this.particles.splice(i, 1);
    }
    if (this.particles.length) this.animId = requestAnimationFrame(() => this.animate());
    else { this.animId = null; ctx.clearRect(0, 0, this.w, this.h); }
  }

  stop() {
    clearInterval(this.rainTimer);
    this.particles = [];
    if (this.ctx) this.ctx.clearRect(0, 0, this.w || 0, this.h || 0);
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
  }
}

window.ConfettiEngine = ConfettiEngine;
