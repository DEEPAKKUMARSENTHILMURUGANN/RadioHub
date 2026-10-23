/**
 * RJ Hunt — broadcast wheel engine (v3)
 *
 * Everything on the wheel is painted to one canvas:
 *  - a pre-rendered wheel face (hue sectors, curved titles, icons, chrome dividers, rivets)
 *    rotated each frame — cheap even on a projector laptop
 *  - counter-rotating detail rings (tick ring CCW, filmstrip ring CW)
 *  - live highlight on the sector under the needle (strobes during the spin)
 *  - chrome rim with chasing LEDs, pegs, radial spectrum analyser driven by speed
 *  - hub with the Radio Hub logo that glows red while spinning
 *  - static glass gloss + moving specular glint
 *
 * API (unchanged): new SpinningWheel(canvasId, pointerId, {segmentsCount, onTick, onComplete, onEnergy})
 *                  .spinTo(key, seconds) · .setSegmentsCount(n) · .isSpinning
 */

class SpinningWheel {
  constructor(canvasId, pointerId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.pointerEl = document.getElementById(pointerId);

    // legacy DOM rings (kept so older markup still works; hidden by CSS)
    this.discCenter = document.getElementById('discCenter');
    this.discFilmstrip = document.getElementById('discFilmstrip');
    this.discHands = document.getElementById('discHands');
    this.discMics = document.getElementById('discMics');

    this.options = Object.assign({ segmentsCount: 3, onTick: null, onComplete: null, onEnergy: null }, options);

    this.CHALLENGES = {
      shipwreck:         { id: 'shipwreck',         title: 'SHIPWRECK', label: 'SHIPWRECK',  color: '#22b8f0', deep: '#04243f', icon: 'shipwreck' },
      interview:         { id: 'interview',         title: 'INTERVIEW', label: 'INTERVIEW',  color: '#8f7bff', deep: '#1b1146', icon: 'interview' },
      hints_development: { id: 'hints_development', title: 'HINTS DEV', label: 'HINTS DEV',  color: '#2ee6c0', deep: '#03322c', icon: 'hints_development' }
    };

    this.icons = this.loadIcons();
    this.hubLogo = new Image();
    this.hubLogo.onload = () => { this.faceDirty = true; };
    this.hubLogo.src = 'images/rh%20logo.png';

    this.initSegments();

    this.angleMics = -Math.PI / 2 - this.sliceAngle / 2; // first sector centred under needle at load
    this.angleHands = 0;
    this.angleFilmstrip = 0;

    this.isSpinning = false;
    this.lastPegIndex = -1;
    this.energy = 0;
    this.prevAngle = this.angleMics;
    this.needleAngle = 0;
    this.needleVel = 0;
    this.lockHue = null;
    this.lockT = 0;
    this.lockIndex = -1;
    this.lockPulse = 0;

    this.introStep = 0;
    this.faceScale = 0;       // 0..1 intro scale of wheel face
    this.rimProgress = 0;
    this.BARS = 120;
    this.bars = new Float32Array(this.BARS);
    this.peaks = new Float32Array(this.BARS);

    this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.face = document.createElement('canvas');
    this.faceDirty = true;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { this.faceDirty = true; });

    this.startIntroSequence();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ setup
  loadIcons() {
    const paths = {
      shipwreck: '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V21"/><path d="M8 11h8"/><path d="M4 14c0 4 3.6 7 8 7s8-3 8-7"/><path d="M2.5 15.5 4 14l1.5 1.5M18.5 15.5 20 14l1.5 1.5"/>',
      interview: '<rect x="8.5" y="2.5" width="7" height="12" rx="3.5"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/><path d="M8.5 7h2M8.5 10h2"/>',
      hints_development: '<path d="M9 17.5h6M10 21h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8 1 .8 1.7v1.5h6V16c0-.7.3-1.3.8-1.7A6.5 6.5 0 0 0 12 2.5Z"/><path d="M12 7v3.5l2 1.5"/>'
    };
    const out = {};
    Object.keys(paths).forEach(k => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240"><g fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[k]}</g></svg>`;
      const img = new Image();
      img.onload = () => { this.faceDirty = true; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      out[k] = img;
    });
    return out;
  }

  initSegments() {
    const layout = this.options.segmentsCount || 3;
    const baseKeys = ['shipwreck', 'interview', 'hints_development'];
    this.segments = [];
    baseKeys.forEach(k => this.segments.push(this.CHALLENGES[k]));
    if (layout !== 3) baseKeys.forEach(k => this.segments.push(this.CHALLENGES[k]));
    this.numSegments = this.segments.length;
    this.sliceAngle = (2 * Math.PI) / this.numSegments;
    this.faceDirty = true;
  }

  setSegmentsCount(count) {
    if (this.options.segmentsCount === count) return;
    this.options.segmentsCount = count;
    this.initSegments();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(50, Math.min(rect.width, rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
    this.cx = size / 2;
    this.cy = size / 2;
    this.discR = size * 0.36;
    this.faceDirty = true;
  }

  // ------------------------------------------------------------ pre-rendered face
  renderFace() {
    const R = this.discR;
    const d = Math.ceil(R * 2 * this.dpr);
    this.face.width = d; this.face.height = d;
    const f = this.face.getContext('2d');
    f.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    f.translate(R, R);

    const n = this.numSegments;
    const slice = this.sliceAngle;
    const font = getComputedStyle(document.body).getPropertyValue('--font-display') || 'Unbounded, sans-serif';

    for (let i = 0; i < n; i++) {
      const seg = this.segments[i];
      const a0 = i * slice, a1 = a0 + slice, mid = a0 + slice / 2;

      // sector body
      f.save();
      f.beginPath(); f.moveTo(0, 0); f.arc(0, 0, R, a0, a1); f.closePath(); f.clip();
      const g = f.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
      g.addColorStop(0, '#02050f');
      g.addColorStop(0.35, seg.deep);
      g.addColorStop(0.82, this.mix(seg.color, seg.deep, 0.55));
      g.addColorStop(1, this.mix(seg.color, '#000000', 0.35));
      f.fillStyle = g; f.fillRect(-R, -R, R * 2, R * 2);

      // fine sunburst lines inside sector
      f.globalAlpha = 0.09; f.strokeStyle = seg.color; f.lineWidth = 1;
      const rays = Math.round(28 / (n / 3));
      for (let k = 1; k < rays; k++) {
        const a = a0 + (k / rays) * slice;
        f.beginPath(); f.moveTo(Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.32); f.lineTo(Math.cos(a) * R, Math.sin(a) * R); f.stroke();
      }
      // concentric grooves
      f.globalAlpha = 0.12;
      for (let r = R * 0.38; r < R; r += R * 0.06) { f.beginPath(); f.arc(0, 0, r, a0, a1); f.stroke(); }
      f.globalAlpha = 1;

      // inner edge glow along sector rim
      const rg = f.createRadialGradient(0, 0, R * 0.86, 0, 0, R);
      rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, this.alpha(seg.color, 0.55));
      f.fillStyle = rg; f.fillRect(-R, -R, R * 2, R * 2);
      f.restore();

      // icon (upright relative to sector, pointing outward)
      const ic = this.icons[seg.icon];
      if (ic && ic.complete && ic.naturalWidth) {
        const ir = R * 0.53, is = R * (n === 3 ? 0.2 : 0.14);
        f.save();
        f.translate(Math.cos(mid) * ir, Math.sin(mid) * ir);
        f.rotate(mid + Math.PI / 2);
        f.shadowColor = seg.color; f.shadowBlur = R * 0.06;
        f.drawImage(ic, -is / 2, -is / 2, is, is);
        f.restore();
      }

      // curved label
      const label = seg.label;
      const fs = R * (n === 3 ? 0.105 : 0.078);
      f.save();
      f.font = `800 ${fs}px ${font}`;
      f.textAlign = 'center'; f.textBaseline = 'middle';
      const lr = R * 0.79;
      const widths = [...label].map(ch => f.measureText(ch).width + fs * 0.06);
      const total = widths.reduce((s, w) => s + w, 0);
      let ang = mid - (total / lr) / 2;
      [...label].forEach((ch, ci) => {
        const w = widths[ci];
        const a = ang + (w / lr) / 2;
        f.save();
        f.translate(Math.cos(a) * lr, Math.sin(a) * lr);
        f.rotate(a + Math.PI / 2);
        f.lineWidth = fs * 0.16; f.strokeStyle = 'rgba(2,5,15,.85)'; f.lineJoin = 'round';
        f.strokeText(ch, 0, 0);
        const tg = f.createLinearGradient(0, -fs / 2, 0, fs / 2);
        tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.55, this.mix(seg.color, '#ffffff', 0.55)); tg.addColorStop(1, seg.color);
        f.fillStyle = tg; f.shadowColor = seg.color; f.shadowBlur = fs * 0.5;
        f.fillText(ch, 0, 0);
        f.restore();
        ang += w / lr;
      });
      f.restore();
    }

    // chrome dividers + rivets
    for (let i = 0; i < n; i++) {
      const a = i * slice;
      const x1 = Math.cos(a) * R * 0.28, y1 = Math.sin(a) * R * 0.28;
      const x2 = Math.cos(a) * R, y2 = Math.sin(a) * R;
      f.save();
      f.lineCap = 'round';
      f.strokeStyle = 'rgba(0,0,0,.6)'; f.lineWidth = R * 0.034;
      f.beginPath(); f.moveTo(x1, y1); f.lineTo(x2, y2); f.stroke();
      const lg = f.createLinearGradient(x1 - 10, y1 - 10, x2 + 10, y2 + 10);
      lg.addColorStop(0, '#5d6f9c'); lg.addColorStop(0.5, '#f4f8ff'); lg.addColorStop(1, '#7b8fbf');
      f.strokeStyle = lg; f.lineWidth = R * 0.018;
      f.beginPath(); f.moveTo(x1, y1); f.lineTo(x2, y2); f.stroke();
      [0.45, 0.7, 0.93].forEach(t => {
        const rx = Math.cos(a) * R * t, ry = Math.sin(a) * R * t;
        const rv = f.createRadialGradient(rx - 1, ry - 1, 0, rx, ry, R * 0.016);
        rv.addColorStop(0, '#ffffff'); rv.addColorStop(1, '#4b5d8a');
        f.fillStyle = rv; f.beginPath(); f.arc(rx, ry, R * 0.014, 0, Math.PI * 2); f.fill();
      });
      f.restore();
    }

    // outer dark lip
    f.lineWidth = R * 0.02; f.strokeStyle = 'rgba(2,5,15,.9)';
    f.beginPath(); f.arc(0, 0, R - R * 0.01, 0, Math.PI * 2); f.stroke();

    this.faceDirty = false;
  }

  // ------------------------------------------------------------ intro
  startIntroSequence() {
    [this.discCenter, this.discFilmstrip, this.discHands, this.discMics].forEach(el => { if (el) el.style.opacity = '0'; });
    this.introStart = performance.now() + 200;
    this.introStep = 1;
    setTimeout(() => { this.introStep = 3; this.rimStart = performance.now(); }, 1100);
    setTimeout(() => { this.introStep = 4; document.body.classList.remove('is-intro'); }, 2450);
  }

  // ------------------------------------------------------------ loop
  loop(now) {
    if (this.introStep === 4 && !this.isSpinning) {
      const drift = this.reducedMotion ? 0 : 0.0016;
      this.angleMics += drift;
      this.angleHands -= drift * 1.6;
      this.angleFilmstrip += drift * 2.2;
    }

    // intro face scale (spring)
    if (this.introStep >= 1) {
      const t = Math.max(0, (now - this.introStart) / 1100);
      this.faceScale = t >= 1 ? 1 : this.easeOutBack(Math.min(t, 1));
      this.introSpin = (1 - Math.min(t, 1)) * -2.2;
    }
    if (this.introStep >= 3 && this.rimStart) this.rimProgress = Math.min(1, (now - this.rimStart) / 1300);

    const v = Math.abs(this.angleMics - this.prevAngle);
    this.prevAngle = this.angleMics;
    const target = this.isSpinning ? Math.min(1, v / 0.3) : 0;
    this.energy += (target - this.energy) * (target > this.energy ? 0.35 : 0.06);
    if (typeof this.options.onEnergy === 'function') this.options.onEnergy(this.energy);

    this.needleVel += (-this.needleAngle) * 0.28;
    this.needleVel *= 0.62;
    this.needleAngle += this.needleVel;
    if (this.pointerEl) this.pointerEl.style.transform = `rotate(${this.needleAngle.toFixed(2)}deg)`;

    if (this.lockPulse > 0) this.lockPulse = Math.max(0, this.lockPulse - 0.008);

    this.draw(now);
    requestAnimationFrame(this.loop);
  }

  updateDomTransforms() { /* kept for compatibility — wheel is fully canvas-rendered */ }

  activeIndex() {
    const pointer = (3 * Math.PI) / 2;
    const rel = (((pointer - this.angleMics) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.floor(rel / this.sliceAngle) % this.numSegments;
  }

  // ------------------------------------------------------------ draw
  draw(now) {
    const ctx = this.ctx;
    const { cx, cy, discR: R, size } = this;
    ctx.clearRect(0, 0, size, size);
    if (this.introStep < 1) return;
    if (this.faceDirty) this.renderFace();

    const t = now / 1000;
    const rimP = this.easeOut(this.rimProgress);
    const rimIn = R, rimOut = R + size * 0.036, rimMid = (rimIn + rimOut) / 2;
    const top = -Math.PI / 2;

    // ---- wheel face
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(this.faceScale, this.faceScale);
    ctx.rotate(this.angleMics + (this.introSpin || 0));
    ctx.drawImage(this.face, -R, -R, R * 2, R * 2);
    ctx.restore();

    if (this.faceScale > 0.98) {
      const active = this.activeIndex();
      const seg = this.segments[active];
      // active sector light
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.angleMics);
      const a0 = active * this.sliceAngle, a1 = a0 + this.sliceAngle;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * 0.985, a0, a1); ctx.closePath();
      const strobe = this.isSpinning ? 0.22 + this.energy * 0.25 : 0.1 + 0.05 * Math.sin(t * 2);
      const lockBoost = this.lockIndex === active ? this.lockPulse * 0.5 * (0.6 + 0.4 * Math.sin(t * 18)) : 0;
      ctx.fillStyle = this.alpha(seg.color, strobe + lockBoost);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 3; ctx.strokeStyle = this.alpha('#ffffff', 0.25 + lockBoost);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.97, a0 + 0.02, a1 - 0.02); ctx.stroke();
      ctx.restore();

      // dim non-winning sectors after lock
      if (this.lockIndex >= 0 && this.lockPulse > 0) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(this.angleMics);
        for (let i = 0; i < this.numSegments; i++) {
          if (this.segments[i].id === this.segments[this.lockIndex].id) continue;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i * this.sliceAngle, (i + 1) * this.sliceAngle); ctx.closePath();
          ctx.fillStyle = `rgba(2,5,15,${0.55 * Math.min(1, this.lockPulse * 2)})`; ctx.fill();
        }
        ctx.restore();
      }

      // counter-rotating tick ring (CCW)
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(this.angleHands);
      ctx.strokeStyle = 'rgba(220,231,255,.35)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2, l = i % 5 === 0 ? R * 0.035 : R * 0.018;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.955, Math.sin(a) * R * 0.955); ctx.lineTo(Math.cos(a) * (R * 0.955 - l), Math.sin(a) * (R * 0.955 - l)); ctx.stroke();
      }
      ctx.restore();

      // filmstrip ring (CW, faster)
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(this.angleFilmstrip);
      const fr0 = R * 0.29, fr1 = R * 0.355;
      ctx.beginPath(); ctx.arc(0, 0, fr1, 0, Math.PI * 2); ctx.arc(0, 0, fr0, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(4,8,20,.92)'; ctx.fill();
      ctx.fillStyle = 'rgba(220,231,255,.75)';
      const holes = 36;
      for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2;
        ctx.save(); ctx.rotate(a);
        ctx.fillRect(fr0 + R * 0.012, -R * 0.009, R * 0.016, R * 0.018);
        ctx.fillRect(fr1 - R * 0.028, -R * 0.009, R * 0.016, R * 0.018);
        ctx.restore();
      }
      ctx.restore();
    }

    // ---- hub
    const hubR = R * 0.27 * this.faceScale;
    if (hubR > 1) {
      ctx.save(); ctx.translate(cx, cy);
      const hg = ctx.createLinearGradient(-hubR, -hubR, hubR, hubR);
      hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.3, '#7d92c2'); hg.addColorStop(0.55, '#eef3ff'); hg.addColorStop(1, '#4a5a85');
      ctx.beginPath(); ctx.arc(0, 0, hubR, 0, Math.PI * 2); ctx.fillStyle = hg;
      ctx.shadowColor = this.isSpinning ? 'rgba(255,45,85,.9)' : 'rgba(61,123,255,.8)';
      ctx.shadowBlur = 20 + this.energy * 50 + (this.lockPulse * 40);
      ctx.fill(); ctx.shadowBlur = 0;
      const inner = hubR * 0.86;
      const ig = ctx.createRadialGradient(0, -inner * 0.3, inner * 0.1, 0, 0, inner);
      const hot = this.isSpinning ? this.energy : 0;
      ig.addColorStop(0, this.mix('#1a3a8f', '#ff2d55', hot * 0.8));
      ig.addColorStop(1, '#030714');
      ctx.beginPath(); ctx.arc(0, 0, inner, 0, Math.PI * 2); ctx.fillStyle = ig; ctx.fill();
      if (this.hubLogo.complete && this.hubLogo.naturalWidth) {
        const s = inner * 1.45 * (1 + Math.sin(t * 1.7) * 0.02 + this.energy * 0.06);
        const ar = this.hubLogo.naturalWidth / this.hubLogo.naturalHeight;
        ctx.shadowColor = '#7fb0ff'; ctx.shadowBlur = 16;
        ctx.drawImage(this.hubLogo, -s * ar / 2, -s / 2 - inner * 0.02, s * ar, s);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    if (this.introStep < 3) return;

    // ---- motion streaks
    if (this.energy > 0.05) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        const a = this.angleMics + (i / 18) * Math.PI * 2;
        const r = R * (0.45 + (i % 4) * 0.13);
        ctx.beginPath(); ctx.arc(cx, cy, r, a, a + 0.6 * this.energy);
        ctx.strokeStyle = `rgba(200,220,255,${0.13 * this.energy})`; ctx.lineWidth = R * 0.04; ctx.stroke();
      }
      ctx.restore();
    }

    // ---- spectrum ring
    const barIn = rimOut + size * 0.012, barMax = size * 0.5 - barIn - 2;
    for (let i = 0; i < this.BARS; i++) {
      const idle = 0.07 + 0.06 * (0.5 + 0.5 * Math.sin(t * 1.6 + i * 0.35)) * (0.5 + 0.5 * Math.sin(t * 0.7 - i * 0.12));
      const live = this.energy * (0.25 + 0.75 * Math.random()) * (0.55 + 0.45 * Math.sin(i * 0.5 + t * 9));
      let tg = Math.max(idle, live);
      if (this.lockT > 0) tg = Math.max(tg, this.lockT * (0.6 + 0.4 * Math.sin(i * 0.9 + t * 14)));
      const cur = this.bars[i];
      this.bars[i] = cur + (tg - cur) * (tg > cur ? 0.55 : 0.12);
      this.peaks[i] = Math.max(this.peaks[i] - 0.008, this.bars[i]);
    }
    if (this.lockT > 0) this.lockT = Math.max(0, this.lockT - 0.01);
    const barW = (2 * Math.PI * barIn / this.BARS) * 0.5;
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < this.BARS; i++) {
      if (i / this.BARS > rimP) break;
      const a = top + (i / this.BARS) * Math.PI * 2;
      const h = Math.max(2, this.bars[i] * barMax), hot = this.bars[i];
      let col = hot > 0.82 ? '#ffb547' : hot > 0.45 ? '#9cc0ff' : '#3d7bff';
      if (this.lockHue && this.lockT > 0.02) col = this.lockHue;
      ctx.strokeStyle = col; ctx.globalAlpha = 0.35 + hot * 0.65; ctx.lineWidth = barW;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * barIn, cy + Math.sin(a) * barIn); ctx.lineTo(cx + Math.cos(a) * (barIn + h), cy + Math.sin(a) * (barIn + h)); ctx.stroke();
      const pk = barIn + this.peaks[i] * barMax + 3;
      ctx.globalAlpha = 0.25 + this.peaks[i] * 0.5; ctx.fillStyle = '#dce7ff';
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * pk, cy + Math.sin(a) * pk, barW * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // ---- chrome rim
    ctx.save();
    const rg = ctx.createLinearGradient(cx - rimOut, cy - rimOut, cx + rimOut, cy + rimOut);
    rg.addColorStop(0, '#f4f8ff'); rg.addColorStop(0.25, '#7d92c2'); rg.addColorStop(0.5, '#e7eeff'); rg.addColorStop(0.75, '#58699a'); rg.addColorStop(1, '#cfdcff');
    ctx.beginPath(); ctx.arc(cx, cy, rimMid, top, top + Math.PI * 2 * rimP);
    ctx.strokeStyle = rg; ctx.lineWidth = rimOut - rimIn;
    ctx.shadowColor = this.lockHue && this.lockT > 0.05 ? this.lockHue : 'rgba(61,123,255,0.8)';
    ctx.shadowBlur = 18 + this.energy * 30 + this.lockT * 30;
    ctx.stroke(); ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(3,7,20,0.9)';
    ctx.beginPath(); ctx.arc(cx, cy, rimIn, top, top + Math.PI * 2 * rimP); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, rimOut, top, top + Math.PI * 2 * rimP); ctx.stroke();
    ctx.restore();

    // ---- LEDs
    const LEDS = 36;
    const off = Math.floor(this.angleMics * 6 + now / (this.isSpinning ? 35 : 260));
    for (let i = 0; i < LEDS; i++) {
      if (i / LEDS > rimP) break;
      const a = top + (i / LEDS) * Math.PI * 2;
      const on = this.lockT > 0.05 ? (Math.floor(t * 10) % 2 === 0) : (i + off) % 3 === 0;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rimMid, cy + Math.sin(a) * rimMid, size * 0.0062, 0, Math.PI * 2);
      if (on) { ctx.fillStyle = '#ffffff'; ctx.shadowColor = this.lockHue && this.lockT > 0.02 ? this.lockHue : '#7fb0ff'; ctx.shadowBlur = 14; }
      else { ctx.fillStyle = '#20366e'; ctx.shadowBlur = 0; }
      ctx.fill(); ctx.shadowBlur = 0;
    }

    // ---- pegs
    if (rimP >= 1) {
      for (let i = 0; i < this.numSegments * 4; i++) {
        const a = i * (this.sliceAngle / 4) + this.angleMics;
        const x = cx + Math.cos(a) * (rimIn - size * 0.004), y = cy + Math.sin(a) * (rimIn - size * 0.004);
        const pr = i % 4 === 0 ? size * 0.01 : size * 0.006;
        const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, pr);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#6f86bd');
        ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      }
    }

    // ---- glass gloss + moving glint (does not rotate)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * this.faceScale, 0, Math.PI * 2); ctx.clip();
    const gl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.55, 0, cx - R * 0.2, cy - R * 0.4, R * 1.1);
    gl.addColorStop(0, 'rgba(255,255,255,.22)'); gl.addColorStop(0.4, 'rgba(255,255,255,.04)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    const sweep = ((t * 0.12) % 1.6) - 0.3;
    const sx = cx - R + sweep * R * 2;
    const sg = ctx.createLinearGradient(sx - R * 0.25, cy - R, sx + R * 0.25, cy + R);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,.08)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    const vg = ctx.createRadialGradient(cx, cy, R * 0.75, cx, cy, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = vg; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }

  // ------------------------------------------------------------ utils
  easeOut(x) { return 1 - Math.pow(1 - x, 3); }
  easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  mix(a, b, k) { const A = this.hex(a), B = this.hex(b); return `rgb(${A.map((v, i) => Math.round(v * (1 - k) + B[i] * k)).join(',')})`; }
  alpha(h, a) { const [r, g, b] = this.hex(h); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`; }

  kickNeedle(strength) { this.needleVel -= strength; }

  lock(hue, index) {
    this.lockHue = hue || '#ffffff';
    this.lockT = 1;
    this.lockIndex = index;
    this.lockPulse = 1;
    this.needleVel += 14;
  }

  // ------------------------------------------------------------ spin
  spinTo(targetKey, durationSeconds = 6) {
    if (this.isSpinning) return;
    this.isSpinning = true;
    this.lockT = 0; this.lockPulse = 0; this.lockIndex = -1;

    const pointerAngle = (3 * Math.PI) / 2;
    let matchingIndices = [];
    for (let i = 0; i < this.segments.length; i++) if (this.segments[i].id === targetKey) matchingIndices.push(i);
    if (matchingIndices.length === 0) {
      const randIdx = Math.floor(Math.random() * this.segments.length);
      matchingIndices = [randIdx];
      targetKey = this.segments[randIdx].id;
    }
    const chosenIndex = matchingIndices[Math.floor(Math.random() * matchingIndices.length)];

    const sliceMargin = this.sliceAngle * 0.22;
    const innerSliceOffset = sliceMargin + Math.random() * (this.sliceAngle - 2 * sliceMargin);
    const targetSliceAngle = chosenIndex * this.sliceAngle + innerSliceOffset;
    const desiredNormalizedAngle = (((pointerAngle - targetSliceAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    const WIND_MS = this.reducedMotion ? 0 : 560;
    const WIND_RAD = 0.45;
    const s0Mics = this.angleMics, s0Hands = this.angleHands, s0Film = this.angleFilmstrip;

    const minFullRotations = Math.floor(6 + Math.random() * 3);
    const startMicsAngle = s0Mics - (WIND_MS ? WIND_RAD : 0);
    const currentNorm = ((startMicsAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let delta = desiredNormalizedAngle - currentNorm;
    if (delta < 0) delta += 2 * Math.PI;
    const totalRotationDelta = minFullRotations * (2 * Math.PI) + delta;
    const finalMicsAngle = startMicsAngle + totalRotationDelta;

    const durationMs = durationSeconds * 1000;
    let lastTickTime = 0, mainStart = 0, startHands, startFilm;
    const t0 = performance.now();

    const windUp = (now) => {
      const k = Math.min((now - t0) / WIND_MS, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.angleMics = s0Mics - WIND_RAD * e;
      this.angleHands = s0Hands + WIND_RAD * 0.8 * e;
      this.angleFilmstrip = s0Film - WIND_RAD * 1.1 * e;
      if (k < 1) requestAnimationFrame(windUp);
      else { this.prevAngle = this.angleMics; mainStart = performance.now(); requestAnimationFrame(animateSpin); }
    };

    const animateSpin = (now) => {
      if (startHands === undefined) { startHands = this.angleHands; startFilm = this.angleFilmstrip; }
      const progress = Math.min((now - mainStart) / durationMs, 1.0);
      const eased = 1 - Math.pow(1 - progress, 4.2);
      this.angleMics = startMicsAngle + totalRotationDelta * eased;
      this.angleHands = startHands - (totalRotationDelta * 0.85) * eased;
      this.angleFilmstrip = startFilm + (totalRotationDelta * 1.15) * eased;

      const norm = ((this.angleMics + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const pegIndex = Math.floor((norm / (2 * Math.PI)) * this.numSegments * 4);
      if (pegIndex !== this.lastPegIndex) {
        this.lastPegIndex = pegIndex;
        const speed = 1.0 - progress;
        this.kickNeedle(6 + speed * 16);
        if (typeof this.options.onTick === 'function' && (now - lastTickTime > 40)) {
          this.options.onTick(speed, this.segments[this.activeIndex()]);
          lastTickTime = now;
        }
      }

      if (progress < 1.0) requestAnimationFrame(animateSpin);
      else {
        this.isSpinning = false;
        this.angleMics = finalMicsAngle;
        const landedSeg = this.CHALLENGES[targetKey] || this.segments[chosenIndex];
        this.lock(landedSeg && landedSeg.color, chosenIndex);
        if (typeof this.options.onComplete === 'function') this.options.onComplete(targetKey, landedSeg);
      }
    };

    if (WIND_MS) requestAnimationFrame(windUp);
    else { mainStart = performance.now(); requestAnimationFrame(animateSpin); }
  }
}

window.SpinningWheel = SpinningWheel;
