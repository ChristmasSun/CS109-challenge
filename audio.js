/* AUDIO system uses Markov. 

   Lower entropy (more certain) → calmer, consonant music
   Higher entropy (more uncertain) → tenser, dissonant music
 */

// (Hz): C4, D4, E4, G4, A4, C5, D5
const NOTES = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3];
const NOTE_NAMES = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5'];
const N = NOTES.length;

// Calm: prefers stepwise motion, smooth intervals
const CALM_MATRIX = [
  [0.10, 0.30, 0.20, 0.15, 0.10, 0.10, 0.05],  // from C4
  [0.20, 0.10, 0.30, 0.15, 0.10, 0.10, 0.05],  // from D4
  [0.10, 0.20, 0.10, 0.30, 0.15, 0.10, 0.05],  // from E4
  [0.10, 0.10, 0.20, 0.10, 0.30, 0.10, 0.10],  // from G4
  [0.10, 0.10, 0.10, 0.20, 0.10, 0.30, 0.10],  // from A4
  [0.15, 0.10, 0.10, 0.10, 0.20, 0.10, 0.25],  // from C5
  [0.10, 0.15, 0.10, 0.10, 0.15, 0.25, 0.15],  // from D5
];

// Tense: more jumps, repeated notes, wider intervals
const TENSE_MATRIX = [
  [0.25, 0.05, 0.10, 0.05, 0.20, 0.05, 0.30],  // from C4 — big jumps
  [0.15, 0.25, 0.05, 0.10, 0.05, 0.25, 0.15],  // from D4
  [0.20, 0.05, 0.25, 0.05, 0.15, 0.10, 0.20],  // from E4
  [0.10, 0.20, 0.05, 0.30, 0.05, 0.20, 0.10],  // from G4
  [0.25, 0.05, 0.20, 0.05, 0.25, 0.05, 0.15],  // from A4
  [0.30, 0.10, 0.05, 0.20, 0.05, 0.20, 0.10],  // from C5
  [0.25, 0.15, 0.15, 0.05, 0.10, 0.05, 0.25],  // from D5
];

function blendMatrices(calm, tense, tension) {
  const t = Math.max(0, Math.min(1, tension));
  const result = [];
  for (let i = 0; i < N; i++) {
    result[i] = [];
    for (let j = 0; j < N; j++) {
      result[i][j] = (1 - t) * calm[i][j] + t * tense[i][j];
    }
  }
  return result;
}

function sampleFromRow(row) {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < row.length; i++) {
    cumulative += row[i];
    if (r < cumulative) return i;
  }
  return row.length - 1;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicPlaying = false;
    this.currentNote = 0;
    this.tension = 0;        // 0 = calm, 1 = tense
    this.blendedMatrix = CALM_MATRIX;
    this.musicInterval = null;
    this.musicGain = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.07;
    this.musicGain.connect(this.ctx.destination);
  }

  _tone(freq, dur, type = 'sine', vol = 0.15, dest = null) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g).connect(dest || this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  // --- Sound effects ---
  ping() { this._tone(900, 0.25, 'sine', 0.1); setTimeout(() => this._tone(1300, 0.15, 'sine', 0.06), 60); }
  hit() { this._tone(120, 0.3, 'sawtooth', 0.2); this._tone(80, 0.4, 'square', 0.1); }
  step() { this._tone(300, 0.05, 'triangle', 0.04); }
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'sine', 0.12), i * 150)); }
  scan() { this._tone(600, 0.4, 'sine', 0.08); this._tone(750, 0.3, 'sine', 0.06); }

  // --- Markov chain music ---
  setTension(t) {
    this.tension = Math.max(0, Math.min(1, t));
    this.blendedMatrix = blendMatrices(CALM_MATRIX, TENSE_MATRIX, this.tension);
  }

  _playMusicNote() {
    if (!this.ctx || !this.musicPlaying || this.muted) return;
    const nextNote = sampleFromRow(this.blendedMatrix[this.currentNote]);
    this.currentNote = nextNote;
    const freq = NOTES[nextNote];

    // Slight detuning for warmth
    const detune = (Math.random() - 0.5) * 4;
    const dur = 0.3 + (1 - this.tension) * 0.3; // tense = shorter notes

    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = detune;

    // ADSR-ish envelope
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.02);        // attack
    g.gain.linearRampToValueAtTime(0.07, now + 0.08);        // decay
    g.gain.setValueAtTime(0.07, now + dur - 0.1);            // sustain
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);    // release

    o.connect(g).connect(this.musicGain);
    o.start(now);
    o.stop(now + dur);

    // Add a quiet octave harmonic for richness
    const o2 = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(0.02, now + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.7);
    o2.connect(g2).connect(this.musicGain);
    o2.start(now);
    o2.stop(now + dur);
  }

  startMusic() {
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.currentNote = Math.floor(Math.random() * N);
    // Tempo: faster when tense
    const scheduleNext = () => {
      if (!this.musicPlaying) return;
      this._playMusicNote();
      const interval = 400 + (1 - this.tension) * 300; // 400-700ms
      this.musicInterval = setTimeout(scheduleNext, interval);
    };
    scheduleNext();
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicInterval) clearTimeout(this.musicInterval);
  }

  // --- Expose for visualization ---
  getState() {
    return {
      noteNames: NOTE_NAMES,
      currentNote: this.currentNote,
      tension: this.tension,
      matrix: this.blendedMatrix
    };
  }
}

export const audio = new AudioEngine();
