/**
 * Audience stage controller — RJ Hunt · PSG Radio Hub
 * - Physical USB Arduino buzzer ('a' / 'aaaa') + on-screen buzzer
 * - Socket.io sync with server + admin
 * - Stealth hotkeys 1 / 2 / 3 / 0 for discreet target override
 * - Broadcast-style choreography: on-air lamp, channel scan, frequency sweep,
 *   wheel lock pulse, letter-by-letter reveal, hue-matched confetti
 */

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const shell = $('stageShell');
  const screenBuzzerBtn = $('screenBuzzerBtn');
  const buzzerShockwave = $('buzzerShockwave');
  const winnerModal = $('winnerModal');
  const winnerBadgeIcon = $('winnerBadgeIcon');
  const winnerTitle = $('winnerTitle');
  const winnerTagline = $('winnerTagline');
  const winnerDesc = $('winnerDesc');
  const revealChannel = $('revealChannel');
  const btnCloseModal = $('btnCloseModal');
  const soundToggleBtn = $('soundToggleBtn');
  const fullscreenToggleBtn = $('fullscreenToggleBtn');
  const stageDisplayName = $('stageDisplayName');
  const stealthDot = $('stealthDot');
  const onAirLamp = $('onAirLamp');
  const freqNum = $('freqNum');
  const flashLayer = $('flashLayer');
  const lockRing = $('lockRing');
  const channelList = $('channelList');
  const channels = Array.from(document.querySelectorAll('.channel'));

  const CHALLENGES = {
    shipwreck: {
      title: 'Shipwreck', channel: 'CH 1', hue: '#22b8f0',
      subtitle: 'The ultimate survival pitch',
      desc: 'You are stranded on a sinking cruise ship with only one lifejacket left. Persuade the Captain, live on air, why you deserve to survive.'
    },
    interview: {
      title: 'Interview', channel: 'CH 2', hue: '#8f7bff',
      subtitle: 'Hot seat radio challenge',
      desc: 'You are live on air with a quirky, unpredictable celebrity caller. Keep the energy electric, handle the curveballs and win over the listeners.'
    },
    hints_development: {
      title: 'Hints Development', channel: 'CH 3', hue: '#2ee6c0',
      subtitle: 'Mystery clue broadcast',
      desc: 'Weave rapid-fire mystery clues and impromptu storytelling into one seamless, high-suspense live broadcast.'
    }
  };

  const confetti = new ConfettiEngine('confettiCanvas');
  let currentTarget = 'shipwreck';
  let spinDuration = 6.0;
  let scanIndex = 0;
  let lastEnergy = -1;
  let revealTimer = null;

  const wheel = new SpinningWheel('wheelCanvas', 'wheelPointer', {
    segmentsCount: 3,
    onTick: (speed) => {
      try { if (window.soundEngine) window.soundEngine.playTick(speed); } catch (err) { console.warn('[Audio] Tick sound unavailable.', err); }
      scanChannels();
      sweepFrequency(speed);
    },
    onEnergy: (e) => {
      const r = Math.round(e * 50) / 50;
      if (r !== lastEnergy) { lastEnergy = r; body.style.setProperty('--energy', r); }
      if (window.stageFX) window.stageFX.setEnergy(e);
    },
    onComplete: (resultKey, segData) => onWheelStopped(resultKey, segData)
  });

  // ---------------- Socket ----------------
  let socket = null;
  try { socket = io(); } catch (err) { console.warn('[Socket] Offline mode.', err); }

  function applySettings(data) {
    if (data.spinDuration) spinDuration = data.spinDuration;
    if (data.wheelLayout) wheel.setSegmentsCount(data.wheelLayout);
    if (typeof data.stageDisplayName === 'string' && stageDisplayName && !nameIntroActive) {
      stageDisplayName.textContent = data.stageDisplayName;
    }
    if (typeof data.soundEnabled === 'boolean' && window.soundEngine) {
      window.soundEngine.enabled = data.soundEnabled;
      updateSoundButton();
    }
  }

  if (socket) {
    socket.on('state:init', (data) => {
      applySettings(data);
    });
    socket.on('settings:updated', applySettings);
    socket.on('stage:announce_name', (data) => { if (data && data.name) queueNameIntro(data.name); });
    socket.on('spin:start', (data) => triggerSpinAnimation(data.target, data.duration || spinDuration));
    socket.on('stage:reset', () => closeWinnerModal());
    socket.on('buzzer:active', () => playOnScreenBuzzerEffect());
  }

  // ---------------- Buzzer ----------------
  let lastBuzzerTimestamp = 0;
  const BUZZER_DEBOUNCE_MS = 1400;
  let keyBuffer = [];
  let lastKeyTime = 0;

  function restart(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function playOnScreenBuzzerEffect() {
    if (window.soundEngine) window.soundEngine.playBuzzer();
    if (screenBuzzerBtn) {
      screenBuzzerBtn.classList.add('smashed');
      setTimeout(() => screenBuzzerBtn.classList.remove('smashed'), 350);
    }
    restart(buzzerShockwave, 'active');
    restart(shell, 'shake');
    flashLayer.classList.add('red');
    restart(flashLayer, 'go');
    setTimeout(() => flashLayer.classList.remove('red'), 900);
  }

  function handleBuzzerTrigger(source = 'USB Buzzer (aaaa)') {
    const now = Date.now();
    if (now - lastBuzzerTimestamp < BUZZER_DEBOUNCE_MS) return;
    lastBuzzerTimestamp = now;

    if (nameIntroActive) { finishNameIntro(true); return; }

    if (winnerModal.classList.contains('show')) { closeWinnerModal(); return; }
    if (wheel.isSpinning) return;

    playOnScreenBuzzerEffect();

    if (socket && socket.connected) socket.emit('spin:trigger', { source });
    else triggerSpinAnimation(currentTarget, spinDuration);
  }

  if (screenBuzzerBtn) screenBuzzerBtn.addEventListener('click', () => handleBuzzerTrigger('On-Screen Buzzer Click'));

  window.addEventListener('keydown', (e) => {
    const now = Date.now();
    if (now - lastKeyTime > 900) keyBuffer = [];
    lastKeyTime = now;

    const lowerKey = (e.key || '').toLowerCase();
    keyBuffer.push(lowerKey);
    if (keyBuffer.length > 8) keyBuffer.shift();
    const recentKeys = keyBuffer.slice(-4).join('');

    if (recentKeys === 'aaaa' || lowerKey === 'a') {
      e.preventDefault();
      handleBuzzerTrigger('USB Arduino Buzzer (Input: aaaa)');
      keyBuffer = [];
      return;
    }
    if (nameIntroActive && (e.code === 'Space' || e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault();
      finishNameIntro(true);
      return;
    }
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (winnerModal.classList.contains('show')) closeWinnerModal();
      else handleBuzzerTrigger('Keyboard (Space/Enter)');
      return;
    }
    if (e.key === 'Escape') { closeWinnerModal(); return; }

    if (e.key === '1') setStealthTarget('shipwreck', '#22b8f0');
    else if (e.key === '2') setStealthTarget('interview', '#8f7bff');
    else if (e.key === '3') setStealthTarget('hints_development', '#2ee6c0');
  });

  function setStealthTarget(target, stealthColor) {
    currentTarget = target;
    if (socket && socket.connected) socket.emit('admin:set_target', { target });
    if (stealthDot) {
      stealthDot.style.background = stealthColor;
      stealthDot.style.opacity = '0.7';
      setTimeout(() => { stealthDot.style.opacity = '0'; }, 800);
    }
  }

  // ---------------- Spin choreography ----------------
  function scanChannels() {
    if (!channels.length) return;
    channels.forEach(c => c.classList.remove('is-scan'));
    scanIndex = (scanIndex + 1) % channels.length;
    channels[scanIndex].classList.add('is-scan');
  }

  function sweepFrequency(speed) {
    if (!freqNum) return;
    const spread = 20 * speed;
    const f = 107.8 + (Math.random() - 0.5) * spread;
    freqNum.textContent = Math.min(108.0, Math.max(87.5, f)).toFixed(1);
  }

  // ---------------- Name intro ----------------
  const nameIntro = $('nameIntro');
  const niName = $('niName');
  let nameIntroActive = false;
  let pendingName = null;
  let niTimers = [];

  function queueNameIntro(name) {
    // never interrupt a spin or a reveal — play it once the stage is free
    if (wheel.isSpinning || winnerModal.classList.contains('show') || nameIntroActive) {
      pendingName = name;
      return;
    }
    playNameIntro(name);
  }

  function flushPendingName() {
    if (pendingName && !wheel.isSpinning && !winnerModal.classList.contains('show') && !nameIntroActive) {
      const n = pendingName; pendingName = null;
      setTimeout(() => queueNameIntro(n), 600);
    }
  }
  setInterval(flushPendingName, 1000);

  function playNameIntro(name) {
    if (!nameIntro || !niName) { if (stageDisplayName) stageDisplayName.textContent = name; return; }
    nameIntroActive = true;
    niTimers.forEach(clearTimeout); niTimers = [];

    // build letters
    niName.textContent = '';
    niName.setAttribute('aria-label', name);
    niName.classList.toggle('is-long', name.length > 14);
    let i = 0;
    name.split(' ').forEach((word, wi, arr) => {
      const w = document.createElement('span'); w.className = 'word';
      for (const ch of word) {
        const s = document.createElement('span');
        s.className = 'ch'; s.style.setProperty('--i', i++);
        s.textContent = ch; s.dataset.ch = ch;
        w.appendChild(s);
      }
      niName.appendChild(w);
      if (wi < arr.length - 1) niName.appendChild(document.createTextNode(' '));
    });

    niName.style.transform = '';
    nameIntro.classList.remove('flying', 'leaving');
    restart(nameIntro, 'show');
    try { if (window.soundEngine) window.soundEngine.playSpinStart(); } catch (err) {}
    if (window.stageFX) { window.stageFX.setHue('#7fb0ff'); window.stageFX.burst(); }
    niTimers.push(setTimeout(() => {
      scramble(Array.from(niName.querySelectorAll('.ch')));
      try { if (window.soundEngine) window.soundEngine.playBuzzer(); } catch (err) {}
      restart(flashLayer, 'go');
    }, 350));

    niTimers.push(setTimeout(() => finishNameIntro(false), 5200));
  }

  function finishNameIntro(fast) {
    if (!nameIntroActive) return;
    niTimers.forEach(clearTimeout); niTimers = [];
    const name = niName.getAttribute('aria-label') || '';
    if (stageDisplayName) {
      stageDisplayName.textContent = name;
      stageDisplayName.style.opacity = '0';
    }

    // fly the big name into the name tag on the right rail
    const from = niName.getBoundingClientRect();
    const to = stageDisplayName ? stageDisplayName.getBoundingClientRect() : null;
    if (to && to.width && !fast) {
      const scale = Math.min(to.height / from.height * 1.1, to.width / from.width);
      const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
      nameIntro.classList.add('flying');
      niName.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    } else {
      nameIntro.classList.add('leaving');
    }

    niTimers.push(setTimeout(() => {
      nameIntro.classList.remove('show', 'flying', 'leaving');
      niName.style.transform = '';
      nameIntroActive = false;
      if (window.stageFX) window.stageFX.setHue(null);
      if (stageDisplayName) {
        stageDisplayName.style.opacity = '';
        const tag = stageDisplayName.closest('.guest') || stageDisplayName;
        restart(tag, 'name-landed');
      }
    }, fast ? 450 : 1050));
  }

  function triggerSpinAnimation(targetKey, duration) {
    if (nameIntroActive) finishNameIntro(true);
    clearTimeout(revealTimer);
    if (winnerModal.classList.contains('show')) hideReveal(true);
    if (channelList) channelList.classList.remove('has-lock');
    channels.forEach(c => c.classList.remove('is-locked', 'is-scan'));
    if (screenBuzzerBtn) screenBuzzerBtn.disabled = true;
    body.classList.add('is-spinning');
    body.classList.remove('is-locked-stage');
    if (window.stageFX) window.stageFX.setHue(null);
    if (onAirLamp) onAirLamp.classList.add('is-live');
    wheel.spinTo(targetKey, duration);
    try { if (window.soundEngine) window.soundEngine.playSpinStart(); } catch (err) { console.warn('[Audio] Spin sound unavailable.', err); }
  }

  function onWheelStopped(resultKey) {
    if (screenBuzzerBtn) screenBuzzerBtn.disabled = false;
    body.classList.remove('is-spinning');
    if (freqNum) freqNum.textContent = '107.8';
    if (socket && socket.connected) socket.emit('spin:completed', { result: resultKey });

    const info = CHALLENGES[resultKey];
    const hue = info ? info.hue : '#ffffff';

    // lock the channel + pulse ring on the wheel
    channels.forEach(c => c.classList.remove('is-scan'));
    const locked = channels.find(c => c.dataset.key === resultKey);
    if (locked && channelList) { channelList.classList.add('has-lock'); locked.classList.add('is-locked'); }
    lockRing.style.setProperty('--lock-hue', hue);
    restart(lockRing, 'go');
    restart(flashLayer, 'go');
    body.style.setProperty('--wash', hexA(hue, 0.35));
    body.classList.add('is-locked-stage');
    ['shock1', 'shock2'].forEach(id => { const el = $(id); if (el) { el.style.setProperty('--shock', hue); restart(el, 'go'); } });
    restart(shell, 'shake');
    if (window.stageFX) { window.stageFX.setHue(hue); window.stageFX.burst(); }

    try { if (window.soundEngine) window.soundEngine.playWinnerFanfare(); } catch (err) { console.warn('[Audio] Winner sound unavailable.', err); }

    revealTimer = setTimeout(() => {
      showWinnerModal(resultKey);
      confetti.start(4500, [hue, '#ffffff', '#dce7ff', '#3d7bff', '#ffb547']);
    }, 750);
  }

  function hexA(h, a) { h = h.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; }

  // "decoding signal" text scramble for the reveal title
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$';
  let scrambleRaf = null;
  function scramble(spans) {
    cancelAnimationFrame(scrambleRaf);
    const t0 = performance.now();
    const plan = spans.map((el, i) => ({ el, final: el.dataset.ch, at: 520 + i * 55 + Math.random() * 260 }));
    let last = 0;
    const step = (now) => {
      const el = now - t0;
      let pending = false;
      const swap = now - last > 45;
      if (swap) last = now;
      plan.forEach(p => {
        if (el >= p.at) { if (p.el.textContent !== p.final) { p.el.textContent = p.final; p.el.classList.remove('scr'); } }
        else { pending = true; if (swap) { p.el.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0]; p.el.classList.add('scr'); } }
      });
      if (pending) scrambleRaf = requestAnimationFrame(step);
    };
    scrambleRaf = requestAnimationFrame(step);
  }

  function fillMarquee(text) {
    const unit = `<span>${text}</span>`.repeat(6);
    ['mq1', 'mq2', 'mq3'].forEach(id => { const el = $(id); if (el) el.innerHTML = unit + unit; });
  }

  function splitTitle(text) {
    winnerTitle.textContent = '';
    winnerTitle.setAttribute('aria-label', text);
    let i = 0;
    text.split(' ').forEach((word, wi, arr) => {
      const w = document.createElement('span');
      w.className = 'word';
      w.setAttribute('aria-hidden', 'true');
      for (const ch of word) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.style.setProperty('--i', i++);
        s.textContent = ch;
        s.dataset.ch = ch;
        w.appendChild(s);
      }
      winnerTitle.appendChild(w);
      if (wi < arr.length - 1) winnerTitle.appendChild(document.createTextNode(' '));
    });
  }

  function showWinnerModal(resultKey) {
    const info = CHALLENGES[resultKey] || {
      title: String(resultKey).replace(/_/g, ' '), channel: 'CH', hue: '#7fb0ff',
      subtitle: 'Impromptu challenge unlocked',
      desc: 'Take the mic and blow the audience away with your radio charisma.'
    };
    winnerModal.style.setProperty('--hue', info.hue);
    revealChannel.textContent = `${info.channel} · locked`;
    winnerBadgeIcon.innerHTML = `<svg><use href="#i-${resultKey}"/></svg>`;
    splitTitle(info.title);
    fillMarquee(info.title.toUpperCase());
    if (!winnerBadgeIcon.querySelector('.orbit-dot')) winnerBadgeIcon.insertAdjacentHTML('beforeend', '<span class="orbit-dot"></span>');
    winnerTitle.classList.toggle('is-long', info.title.length > 11);
    winnerTagline.textContent = info.subtitle;
    winnerDesc.textContent = info.desc;
    winnerModal.classList.remove('closing');
    restart(winnerModal, 'show');
    scramble(Array.from(winnerTitle.querySelectorAll('.ch')));
    setTimeout(() => btnCloseModal && btnCloseModal.focus({ preventScroll: true }), 1500);
  }

  function hideReveal(instant) {
    winnerModal.classList.remove('show', 'closing');
    if (!instant) return;
  }

  function closeWinnerModal() {
    clearTimeout(revealTimer);
    confetti.stop();
    if (onAirLamp) onAirLamp.classList.remove('is-live');
    if (channelList) channelList.classList.remove('has-lock');
    channels.forEach(c => c.classList.remove('is-locked', 'is-scan'));
    body.classList.remove('is-spinning', 'is-locked-stage');
    if (window.stageFX) window.stageFX.setHue(null);
    if (screenBuzzerBtn) screenBuzzerBtn.disabled = false;
    if (!winnerModal.classList.contains('show')) return;
    winnerModal.classList.add('closing');
    setTimeout(() => winnerModal.classList.remove('show', 'closing'), 450);
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeWinnerModal);

  // ---------------- Sound + fullscreen ----------------
  function updateSoundButton() {
    if (!soundToggleBtn || !window.soundEngine) return;
    const on = window.soundEngine.enabled;
    soundToggleBtn.classList.toggle('is-muted', !on);
    soundToggleBtn.title = on ? 'Mute audio' : 'Unmute audio';
  }
  if (soundToggleBtn) soundToggleBtn.addEventListener('click', () => {
    if (window.soundEngine) { window.soundEngine.enabled = !window.soundEngine.enabled; updateSoundButton(); }
  });

  if (fullscreenToggleBtn) fullscreenToggleBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });

  // hide the mouse cursor on the projector after 2.5s of no movement
  let cursorTimer;
  const wake = () => { body.classList.remove('hide-cursor'); clearTimeout(cursorTimer); cursorTimer = setTimeout(() => body.classList.add('hide-cursor'), 2500); };
  window.addEventListener('mousemove', wake); wake();

  if (stealthDot) stealthDot.addEventListener('click', () => {
    const targets = ['shipwreck', 'interview', 'hints_development'];
    const nextIdx = (targets.indexOf(currentTarget) + 1) % targets.length;
    setStealthTarget(targets[nextIdx], '#7fb0ff');
  });

});
