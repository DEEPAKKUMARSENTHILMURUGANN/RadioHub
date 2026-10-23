/**
 * Web Audio API Sound Synthesizer for RJ Hunt Spinning Wheel
 * High-fidelity procedural audio: zero external audio files, 100% offline & instantaneous!
 */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.85;
    this.initAudioContext();
  }

  initAudioContext() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 1. PHYSICAL ARDUINO BUZZER SOUND
  // Punchy game-show buzzer alert when contestant smashes the Arduino buzzer!
  playBuzzer() {
    if (!this.enabled) return;
    this.initAudioContext();
    if (!this.ctx) return;
    this.resume();

    const now = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.9, now);
    masterGain.connect(this.ctx.destination);

    // Dual-tone buzzer synth (Square + Sawtooth with high energy)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(220, now);
    osc1.frequency.exponentialRampToValueAtTime(140, now + 0.35);

    osc2.type = 'square';
    osc2.frequency.setValueAtTime(440, now);
    osc2.frequency.exponentialRampToValueAtTime(280, now + 0.35);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.35);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.7, now);
    gain.gain.linearRampToValueAtTime(0.9, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  }

  // 2. WHEEL PEG TICK SOUND
  // Realistic wooden/metallic peg tick when flapper hits a divider pin
  playTick(velocity = 1.0) {
    if (!this.enabled) return;
    this.initAudioContext();
    if (!this.ctx) return;
    this.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pitch dynamically shifts slightly with rotational speed
    const baseFreq = 650 + Math.min(velocity * 80, 400);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.025);

    // Short crisp impulse
    const tickVolume = Math.min(0.15 + velocity * 0.12, 0.4) * this.volume;
    gain.gain.setValueAtTime(tickVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  // 3. WHOOSH / TENSION RISER
  playSpinStart() {
    if (!this.enabled) return;
    this.initAudioContext();
    if (!this.ctx) return;
    this.resume();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.8);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.35 * this.volume, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.9);
  }

  // 4. WINNER FANFARE CHORDS
  playWinnerFanfare() {
    if (!this.enabled) return;
    this.initAudioContext();
    if (!this.ctx) return;
    this.resume();

    const chords = [
      { notes: [261.63, 329.63, 392.00], time: 0, duration: 0.25 }, // C Major
      { notes: [293.66, 369.99, 440.00], time: 0.26, duration: 0.25 }, // D Major
      { notes: [329.63, 415.30, 493.88], time: 0.52, duration: 0.3 }, // E Major
      { notes: [523.25, 659.25, 783.99, 1046.50], time: 0.84, duration: 1.4 } // High C Major triumphant
    ];

    const now = this.ctx.currentTime;

    chords.forEach(chord => {
      const chordStart = now + chord.time;
      chord.notes.forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, chordStart);

        gain.gain.setValueAtTime(0.12 * this.volume, chordStart);
        gain.gain.exponentialRampToValueAtTime(0.001, chordStart + chord.duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(chordStart);
        osc.stop(chordStart + chord.duration);
      });
    });

    // Add crowd applause simulation
    this.playCheer(now + 0.5);
  }

  // 5. APPLAUSE / CROWD CHEER SYNTHESIS
  playCheer(startTime) {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Pink / White noise for applause
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 1.5));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, startTime);
    filter.Q.setValueAtTime(1.5, startTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, startTime);
    gain.gain.linearRampToValueAtTime(0.22 * this.volume, startTime + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 2.2);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(startTime);
    noise.stop(startTime + 2.2);
  }
}

// Export singleton
window.soundEngine = new SoundEngine();
