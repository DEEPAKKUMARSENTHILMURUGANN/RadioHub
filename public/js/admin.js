/**
 * Admin control room — RJ Hunt
 * Set the next outcome, trigger/reset the stage, watch telemetry, tune settings.
 * Socket protocol unchanged from the original server.js.
 */

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const body = document.body;

  const authOverlay = $('authOverlay');
  const authForm = $('authForm');
  const adminPinInput = $('adminPinInput');
  const authError = $('authError');

  const targetCards = document.querySelectorAll('.target-card');
  const readout = $('readout');
  const readoutIcon = $('readoutIcon');
  const currentTargetLabel = $('currentTargetLabel');
  const modeChip = $('modeChip');
  const modeChipText = $('modeChipText');
  const stageStatusBadge = $('stageStatusBadge');
  const spinProgress = $('spinProgress');
  const lastResultVal = $('lastResultVal');
  const spinCount = $('spinCount');
  const lastBuzzerVal = $('lastBuzzerVal');
  const buzzerRow = $('buzzerRow');
  const buzzDot = $('buzzDot');
  const btnRemoteSpin = $('btnRemoteSpin');
  const btnRemoteReset = $('btnRemoteReset');
  const btnTestBuzzer = $('btnTestBuzzer');
  const durationSlider = $('durationSlider');
  const durationVal = $('durationVal');
  const wheelLayoutSelect = $('wheelLayoutSelect');
  const adminSoundToggle = $('adminSoundToggle');
  const historyList = $('historyTableBody');
  const btnChangePin = $('btnChangePin');
  const newPinInput = $('newPinInput');
  const stageDisplayNameInput = $('stageDisplayNameInput');
  const btnStageDisplayName = $('btnStageDisplayName');
  const connState = $('connState');
  const adminOnAir = $('adminOnAir');
  const toastEl = $('toast');

  const TARGETS = {
    shipwreck: { name: 'Shipwreck', hue: '#22b8f0' },
    interview: { name: 'Interview', hue: '#8f7bff' },
    hints_development: { name: 'Hints Development', hue: '#2ee6c0' }
  };

  let socket = null;
  let currentTarget = 'shipwreck';
  let spinDuration = 6;
  let lastHistoryTopId = null;

  try { socket = io(); } catch (err) { console.error('Socket connection error', err); }

  // ---------------- helpers ----------------
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  let toastTimer;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function prettyResult(key) {
    return (TARGETS[key] && TARGETS[key].name) || (key ? String(key).replace(/_/g, ' ') : 'None yet');
  }

  // ---------------- auth ----------------
  function attemptAuth(pin, silent) {
    if (!socket) return;
    socket.emit('admin:auth', { pin }, (res) => {
      if (res && res.success) {
        sessionStorage.setItem('rj_admin_pin', pin);
        authError.classList.remove('show');
        authOverlay.classList.add('is-unlocking');
        setTimeout(() => {
          authOverlay.classList.add('is-hidden');
          body.classList.remove('is-locked');
          body.classList.add('is-ready');
        }, silent ? 0 : 350);
      } else {
        sessionStorage.removeItem('rj_admin_pin');
        if (!silent) {
          authError.classList.add('show');
          restart(authForm, 'shake');
          adminPinInput.select();
        }
      }
    });
  }

  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    attemptAuth(adminPinInput.value.trim());
  });

  $('btnAdminLogout').addEventListener('click', () => {
    sessionStorage.removeItem('rj_admin_pin');
    location.reload();
  });

  // ---------------- socket ----------------
  function setConn(state, label) {
    connState.className = 'conn ' + state;
    connState.querySelector('span').textContent = label;
  }

  if (socket) {
    socket.on('connect', () => {
      setConn('is-online', 'Stage connected');
      const savedPin = sessionStorage.getItem('rj_admin_pin');
      if (savedPin) attemptAuth(savedPin, true);
    });
    socket.on('disconnect', () => setConn('is-offline', 'Server offline'));

    socket.on('admin:state', (data) => {
      currentTarget = data.target || 'shipwreck';
      updateTargetUI(currentTarget, false);
      updateTelemetry(data);
      if (data.history) renderHistory(data.history, true);
      if (data.spinDuration) setDuration(data.spinDuration);
      if (data.wheelLayout) setLayout(data.wheelLayout);
      if (typeof data.soundEnabled === 'boolean') adminSoundToggle.checked = data.soundEnabled;
      if (typeof data.stageDisplayName === 'string') stageDisplayNameInput.value = data.stageDisplayName;
      if (data.hardwareBuzzer) setHardware(data.hardwareBuzzer);
    });

    socket.on('state:init', (data) => { if (data.hardwareBuzzer) setHardware(data.hardwareBuzzer); });

    socket.on('admin:target_updated', (data) => {
      const changed = data.target !== currentTarget;
      currentTarget = data.target;
      updateTargetUI(currentTarget, changed);
    });

    socket.on('admin:settings_updated', (data) => {
      if (data.spinDuration) setDuration(data.spinDuration);
      if (data.wheelLayout) setLayout(data.wheelLayout);
      if (typeof data.soundEnabled === 'boolean') adminSoundToggle.checked = data.soundEnabled;
      if (typeof data.stageDisplayName === 'string') stageDisplayNameInput.value = data.stageDisplayName;
    });

    socket.on('buzzer:hardware_status', setHardware);

    socket.on('buzzer:active', (data) => {
      const t = new Date(data && data.timestamp ? data.timestamp : Date.now()).toLocaleTimeString();
      lastBuzzerVal.textContent = `Pressed at ${t}${data && data.source ? ' · ' + data.source : ''}`;
      restart(buzzerRow, 'hit');
      setTimeout(() => buzzerRow.classList.remove('hit'), 1600);
    });

    socket.on('admin:spin_started', (data) => { setSpinning(data && data.duration); if (window.adminFX && data) window.adminFX.spin(data.target, data.duration); });
    socket.on('spin:start', (data) => setSpinning(data && data.duration));

    socket.on('spin:result', (data) => {
      if (window.adminFX) window.adminFX.result(data.result);
      setStatus('result', 'Result on screen');
      btnRemoteSpin.disabled = false;
      adminOnAir.classList.add('is-live');
      spinProgress.classList.remove('run');
      spinProgress.classList.add('done');
      showResult(data.result);
    });

    socket.on('stage:reset', () => { setIdle(); if (window.adminFX) window.adminFX.reset(); });
    socket.on('admin:history_updated', (history) => renderHistory(history));
  }

  // ---------------- telemetry ----------------
  function setStatus(cls, text) {
    stageStatusBadge.className = 'status ' + cls;
    stageStatusBadge.textContent = text;
  }

  function setSpinning(duration) {
    setStatus('spinning', 'Spinning');
    btnRemoteSpin.disabled = true;
    adminOnAir.classList.add('is-live');
    spinProgress.classList.remove('done');
    spinProgress.style.setProperty('--dur', ((duration || spinDuration) + 0.5) + 's');
    restart(spinProgress, 'run');
  }

  function setIdle() {
    setStatus('idle', 'Ready');
    btnRemoteSpin.disabled = false;
    adminOnAir.classList.remove('is-live');
    spinProgress.classList.remove('run', 'done');
  }

  function showResult(key) {
    lastResultVal.textContent = prettyResult(key);
    lastResultVal.style.setProperty('--hue-res', (TARGETS[key] || {}).hue || '#dce7ff');
    restart(lastResultVal, 'pop');
  }

  function updateTelemetry(data) {
    if (data.isSpinning) setSpinning(data.spinDuration);
    else if (data.currentResult) {
      setStatus('result', 'Result on screen');
      btnRemoteSpin.disabled = false;
      showResult(data.currentResult);
    } else setIdle();
  }

  function setHardware(hw) {
    if (hw && hw.connected) {
      buzzDot.classList.add('on');
      lastBuzzerVal.textContent = `Connected on ${hw.port || 'USB'}`;
    } else {
      buzzDot.classList.remove('on');
      lastBuzzerVal.textContent = 'Searching for USB Arduino… key A works on stage';
    }
  }

  // ---------------- outcome ----------------
  targetCards.forEach(card => {
    card.addEventListener('click', () => {
      const target = card.getAttribute('data-target');
      if (!target || target === currentTarget) return;
      currentTarget = target;
      updateTargetUI(target, true);
      if (socket && socket.connected) socket.emit('admin:set_target', { target });
      if (navigator.vibrate) navigator.vibrate(12);
    });
  });

  // keyboard shortcuts on the admin page too
  window.addEventListener('keydown', (e) => {
    if (body.classList.contains('is-locked')) return;
    if (/input|textarea/i.test((e.target && e.target.tagName) || '')) return;
    const map = { '1': 'shipwreck', '2': 'interview', '3': 'hints_development' };
    if (map[e.key]) {
      const card = document.querySelector(`.target-card[data-target="${map[e.key]}"]`);
      if (card) card.click();
    }
  });

  function updateTargetUI(target, animate) {
    const t = TARGETS[target] || { name: target, hue: '#dce7ff' };
    targetCards.forEach(c => {
      const on = c.getAttribute('data-target') === target;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    readout.style.setProperty('--hue', t.hue);
    readoutIcon.innerHTML = `<svg><use href="#i-${target}"/></svg>`;
    const wm = document.getElementById('readoutWatermark');
    if (wm) wm.innerHTML = `<use href="#i-${target}"/>`;
    if (window.adminFX) window.adminFX.setTarget(target);
    currentTargetLabel.textContent = t.name;
    modeChip.classList.add('is-armed');
    modeChipText.textContent = 'Selected';
    if (animate) restart(readout, 'swap');
  }

  // ---------------- actions ----------------
  btnRemoteSpin.addEventListener('click', () => {
    if (socket && socket.connected) socket.emit('spin:trigger', { source: 'Admin Remote Button' });
    else toast('Server offline. Check the laptop running the stage.', true);
  });

  btnRemoteReset.addEventListener('click', () => {
    if (socket && socket.connected) {
      socket.emit('admin:reset_stage');
      setIdle();
      toast('Stage reset');
    }
  });

  btnTestBuzzer.addEventListener('click', () => {
    if (socket && socket.connected) socket.emit('buzzer:pressed', { source: 'Admin test' });
  });

  // ---------------- settings ----------------
  function paintRange() {
    const min = +durationSlider.min, max = +durationSlider.max;
    durationSlider.style.setProperty('--fill', ((durationSlider.value - min) / (max - min) * 100) + '%');
  }
  function setDuration(v) {
    spinDuration = parseFloat(v);
    durationSlider.value = spinDuration;
    durationVal.textContent = `${spinDuration.toFixed(1)}s`;
    paintRange();
  }
  durationSlider.addEventListener('input', (e) => {
    durationVal.textContent = `${parseFloat(e.target.value).toFixed(1)}s`;
    paintRange();
  });
  durationSlider.addEventListener('change', (e) => {
    const val = parseFloat(e.target.value);
    spinDuration = val;
    if (socket && socket.connected) socket.emit('admin:update_settings', { spinDuration: val });
    toast(`Spin length set to ${val.toFixed(1)}s`);
  });
  paintRange();

  function setLayout(n) {
    wheelLayoutSelect.dataset.value = String(n);
    wheelLayoutSelect.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.value === String(n) ? 'true' : 'false'));
  }
  wheelLayoutSelect.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const val = parseInt(b.dataset.value, 10);
      setLayout(val);
      if (socket && socket.connected) socket.emit('admin:update_settings', { wheelLayout: val });
    });
  });
  setLayout(3);

  adminSoundToggle.addEventListener('change', (e) => {
    if (socket && socket.connected) socket.emit('admin:update_settings', { soundEnabled: e.target.checked });
    toast(e.target.checked ? 'Stage sound on' : 'Stage sound muted');
  });

  btnStageDisplayName.addEventListener('click', () => {
    const stageDisplayName = stageDisplayNameInput.value.trim();
    if (!stageDisplayName) {
      toast('Enter a display name first', true);
      stageDisplayNameInput.focus();
      return;
    }
    if (socket && socket.connected) {
      socket.emit('admin:update_settings', { stageDisplayName });
      toast('Name is playing on the stage screen');
    } else {
      toast('Server offline. Name was not saved.', true);
    }
  });
  stageDisplayNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnStageDisplayName.click();
  });

  btnChangePin.addEventListener('click', () => {
    const newPin = newPinInput.value.trim();
    if (newPin.length < 4) { toast('PIN needs at least 4 characters', true); newPinInput.focus(); return; }
    if (socket && socket.connected) {
      socket.emit('admin:update_settings', { newPin });
      sessionStorage.setItem('rj_admin_pin', newPin);
      newPinInput.value = '';
      toast('PIN saved');
    }
  });
  newPinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnChangePin.click(); });

  // ---------------- history ----------------
  function renderHistory(history, initial) {
    historyList.innerHTML = '';
    spinCount.textContent = history ? history.length : 0;
    if (!history || history.length === 0) {
      historyList.innerHTML = `<li class="log-empty">No spins yet. Hit the buzzer or press Spin now to start.</li>`;
      lastHistoryTopId = null;
      return;
    }
    const newTop = history[0].id;
    history.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'log-item';
      if (!initial && index === 0 && newTop !== lastHistoryTopId) li.classList.add('is-new');
      const t = TARGETS[item.result] || { name: prettyResult(item.result), hue: '#7fb0ff' };
      const set = item.preset && item.preset !== 'random';
      li.style.setProperty('--hue', t.hue);
      li.innerHTML = `
        <span class="log-num">#${history.length - index}</span>
        <span class="log-icon"><svg><use href="#i-${item.result}"/></svg></span>
        <span class="log-main"><strong></strong><span>${item.timestamp || 'Just now'}</span></span>
        <span class="log-mode ${set ? 'set' : 'fair'}">${set ? 'Set' : 'Fair'}</span>`;
      li.querySelector('strong').textContent = t.name;
      historyList.appendChild(li);
    });
    lastHistoryTopId = newTop;
  }
  renderHistory([], true);
});
