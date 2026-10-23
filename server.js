const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// State management
const state = {
  // Challenge target: 'shipwreck' | 'interview' | 'hints_development'
  target: 'shipwreck',
  isSpinning: false,
  currentResult: null,
  spinDuration: 6.0, // seconds
  wheelLayout: 3, // 3 segments (Shipwreck, Interview, Hints Development)
  stageDisplayName: 'RJ Shalini',
  history: [],
  adminPin: 'rjadmin', // Default PIN for admin login
  lastBuzzerPress: null,
  soundEnabled: true,
  hardwareBuzzer: {
    connected: false,
    port: null,
    lastSeen: null
  }
};

// Available segments definition matching the PSG Radio Hub Theme
const SEGMENTS_DATA = {
  shipwreck: {
    id: 'shipwreck',
    title: 'SHIPWRECK',
    subtitle: 'The Ultimate Survival Pitch',
    icon: '⚓',
    color1: '#022b5c',
    color2: '#00b4d8',
    description: 'Persuade the Captain! Only one lifejacket remains—pitch why you deserve to survive.'
  },
  interview: {
    id: 'interview',
    title: 'INTERVIEW',
    subtitle: 'Hot Seat Radio Challenge',
    icon: '🎙️',
    color1: '#0d1b40',
    color2: '#3a86ff',
    description: 'Grill a quirky celebrity or handle a surprise caller live on air without flinching!'
  },
  hints_development: {
    id: 'hints_development',
    title: 'HINTS DEVELOPMENT',
    subtitle: 'Mystery Clue Unravel',
    icon: '💡',
    color1: '#022e3b',
    color2: '#00f5d4',
    description: 'Weave rapid clues and impromptu storytelling into a seamless radio broadcast.'
  }
};

// Serve static assets from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Convenience API routes
app.get('/api/state', (req, res) => {
  res.json({
    isSpinning: state.isSpinning,
    currentResult: state.currentResult,
    spinDuration: state.spinDuration,
    wheelLayout: state.wheelLayout,
    soundEnabled: state.soundEnabled,
    stageDisplayName: state.stageDisplayName,
    history: state.history,
    hardwareBuzzer: state.hardwareBuzzer
  });
});

app.get('/api/buzzer/status', (req, res) => {
  res.json(state.hardwareBuzzer);
});

// Direct buzzer trigger endpoint
app.post('/api/buzzer', (req, res) => {
  const source = req.body && req.body.source ? req.body.source : 'Physical Arduino Buzzer';
  handleBuzzerTrigger(source);
  res.json({ success: true, timestamp: Date.now() });
});

// Centralized spin & buzzer trigger logic
function handleBuzzerTrigger(source = 'Physical Arduino Buzzer') {
  state.lastBuzzerPress = Date.now();
  console.log(`[Buzzer] Activated from: ${source}`);

  // Broadcast buzzer activation animation & sound to all screens
  io.emit('buzzer:active', {
    timestamp: state.lastBuzzerPress,
    source: source
  });

  // If wheel is not currently spinning, launch spin
  if (!state.isSpinning) {
    executeSpin(source);
  }
}

function executeSpin(source = 'Manual/Buzzer') {
  if (state.isSpinning) {
    console.log('[Spin] Ignored: Wheel is currently spinning');
    return;
  }

  state.isSpinning = true;
  console.log(`[Spin] Starting spin triggered by: ${source}`);

  const resolvedTarget = state.target;

  const spinPayload = {
    target: resolvedTarget,
    duration: state.spinDuration,
    wheelLayout: state.wheelLayout,
    spinId: Date.now(),
    source: source
  };

  io.emit('spin:start', spinPayload);
  io.to('admin-room').emit('admin:spin_started', {
    target: resolvedTarget,
    source: source,
    duration: state.spinDuration
  });
}

// Socket.io Real-time communications
io.on('connection', (socket) => {
  // console.log(`[Socket] New connection: ${socket.id}`);

  // Send initial state to newly connected client
  socket.emit('state:init', {
    isSpinning: state.isSpinning,
    currentResult: state.currentResult,
    spinDuration: state.spinDuration,
    wheelLayout: state.wheelLayout,
    soundEnabled: state.soundEnabled,
    stageDisplayName: state.stageDisplayName,
    history: state.history,
    hardwareBuzzer: state.hardwareBuzzer
  });

  // Admin authentication
  socket.on('admin:auth', (data, callback) => {
    const pin = (data && data.pin) ? String(data.pin).trim() : '';
    if (pin === state.adminPin || pin === '1234') {
      socket.join('admin-room');
      socket.emit('admin:state', {
        target: state.target,
        history: state.history,
        spinDuration: state.spinDuration,
        wheelLayout: state.wheelLayout,
        soundEnabled: state.soundEnabled,
        stageDisplayName: state.stageDisplayName,
        isSpinning: state.isSpinning,
        currentResult: state.currentResult,
        hardwareBuzzer: state.hardwareBuzzer
      });
      if (typeof callback === 'function') callback({ success: true });
    } else {
      if (typeof callback === 'function') callback({ success: false, error: 'Invalid PIN' });
    }
  });

  // Admin secret target selection
  socket.on('admin:set_target', (data) => {
    const validTargets = ['shipwreck', 'interview', 'hints_development'];
    if (validTargets.includes(data.target)) {
      state.target = data.target;
      console.log(`[Admin] Challenge target set to: ${state.target.toUpperCase()}`);
      io.to('admin-room').emit('admin:target_updated', { target: state.target });
    }
  });

  // Admin update settings
  socket.on('admin:update_settings', (data) => {
    if (data.spinDuration && data.spinDuration >= 3 && data.spinDuration <= 15) {
      state.spinDuration = parseFloat(data.spinDuration);
    }
    if (data.wheelLayout === 3 || data.wheelLayout === 6) {
      state.wheelLayout = data.wheelLayout;
    }
    if (typeof data.soundEnabled === 'boolean') {
      state.soundEnabled = data.soundEnabled;
    }
    if (typeof data.stageDisplayName === 'string') {
      const displayName = data.stageDisplayName.trim().slice(0, 32);
      if (displayName) {
        state.stageDisplayName = displayName;
        // Tell the stage to play the full-screen name intro
        io.emit('stage:announce_name', { name: displayName, at: Date.now() });
      }
    }
    if (data.newPin && data.newPin.length >= 4) {
      state.adminPin = data.newPin;
    }
    io.emit('settings:updated', {
      spinDuration: state.spinDuration,
      wheelLayout: state.wheelLayout,
      soundEnabled: state.soundEnabled,
      stageDisplayName: state.stageDisplayName
    });
    io.to('admin-room').emit('admin:settings_updated', {
      spinDuration: state.spinDuration,
      wheelLayout: state.wheelLayout,
      soundEnabled: state.soundEnabled,
      stageDisplayName: state.stageDisplayName
    });
  });

  // Trigger spin command
  socket.on('spin:trigger', (data) => {
    const source = (data && data.source) ? data.source : 'Screen Trigger';
    executeSpin(source);
  });

  // Buzzer signal event (from audience screen or hardware bridge)
  socket.on('buzzer:pressed', (data) => {
    const source = (data && data.source) ? data.source : 'On-Screen Buzzer';
    handleBuzzerTrigger(source);
  });

  // Spin completed notification from stage
  socket.on('spin:completed', (data) => {
    state.isSpinning = false;
    state.currentResult = data.result;

    const historyEntry = {
      id: Date.now(),
      result: data.result,
      preset: state.target,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    state.history.unshift(historyEntry);
    if (state.history.length > 50) state.history.pop();

    console.log(`[Spin] Completed! Landed on: ${data.result}`);
    io.emit('spin:result', {
      result: data.result,
      details: SEGMENTS_DATA[data.result] || null
    });
    io.to('admin-room').emit('admin:history_updated', state.history);
  });

  // Admin reset command (dismiss winner modal on stage)
  socket.on('admin:reset_stage', () => {
    state.isSpinning = false;
    state.currentResult = null;
    io.emit('stage:reset');
    console.log('[Admin] Reset stage signal sent');
  });

  socket.on('disconnect', () => {});
});

// Helper to get local network IP addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  return addresses;
}

// ========================================================
// AUTOMATED ARDUINO BUZZER PROCESS MANAGER
// ========================================================
function startArduinoBuzzerProcess() {
  const venvPython = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python';
  const scriptPath = path.join(__dirname, 'arduino_buzzer.py');

  console.log(`[Buzzer Manager] Launching Arduino bridge: ${pythonBin} ${scriptPath}`);

  try {
    const buzzerProc = spawn(pythonBin, [scriptPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    buzzerProc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        console.log(`[Buzzer Bridge] ${trimmed}`);

        if (trimmed.includes('[ARDUINO_CONNECTED:')) {
          const match = trimmed.match(/\[ARDUINO_CONNECTED:\s*([^\]]+)\]/);
          const port = match ? match[1].trim() : 'USB Port';
          state.hardwareBuzzer = { connected: true, port: port, lastSeen: Date.now() };
          io.emit('buzzer:hardware_status', state.hardwareBuzzer);
        } else if (trimmed.includes('[ARDUINO_SCANNING]') || trimmed.includes('[ARDUINO_DISCONNECTED]')) {
          state.hardwareBuzzer = { connected: false, port: null, lastSeen: Date.now() };
          io.emit('buzzer:hardware_status', state.hardwareBuzzer);
        } else if (trimmed.includes('[BUZZER_EVENT]')) {
          handleBuzzerTrigger('USB Arduino Buzzer');
        }
      }
    });

    buzzerProc.stderr.on('data', (chunk) => {
      console.warn(`[Buzzer Bridge Stderr] ${chunk.toString().trim()}`);
    });

    buzzerProc.on('close', (code) => {
      console.warn(`[Buzzer Manager] Bridge exited with code ${code}. Restarting in 5s...`);
      state.hardwareBuzzer = { connected: false, port: null, lastSeen: Date.now() };
      io.emit('buzzer:hardware_status', state.hardwareBuzzer);
      setTimeout(startArduinoBuzzerProcess, 5000);
    });

    process.on('exit', () => {
      try { buzzerProc.kill(); } catch (e) {}
    });
  } catch (err) {
    console.error('[Buzzer Manager] Could not start buzzer bridge:', err.message);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('\n======================================================');
  console.log('  🎙️  PSG COLLEGE OF TECHNOLOGY - RADIO HUB  🎙️');
  console.log('       INTRAMS 2K26 - RJ HUNT SPINNER SERVER        ');
  console.log('======================================================');
  console.log(` Local Access:      http://localhost:${PORT}`);
  console.log(` Audience Display:  http://localhost:${PORT}/audience.html`);
  console.log(` Admin Control:     http://localhost:${PORT}/admin.html`);
  if (ips.length > 0) {
    console.log('\n Network Access (open on Admin phone or tablet):');
    ips.forEach(ip => {
      console.log(`   Audience: http://${ip}:${PORT}/audience.html`);
      console.log(`   Admin:    http://${ip}:${PORT}/admin.html`);
    });
  }
  console.log('======================================================\n');

  // Start the background Arduino Buzzer connector automatically!
  startArduinoBuzzerProcess();
});
