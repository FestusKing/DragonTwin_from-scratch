// Prozedurale Musik: eine ruhige, mittelalterliche Melodie in d-Moll,
// die live aus Akkorden, Harfe (gezupfte Saite), Flöte und Trommeln
// zusammengesetzt wird. Sie wiederholt sich nie ganz genau gleich.
//
// Die "Harfe" nutzt den Karplus-Strong-Algorithmus: Man füllt einen kurzen
// Speicher mit Rauschen und mittelt ihn immer wieder → klingt wie eine Saite.

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Akkorde als MIDI-Noten: [Bass, Quinte, Grundton, Terz, Quinte]
const CHORDS = {
  Dm: [50, 57, 62, 65, 69],
  Bb: [46, 53, 58, 62, 65],
  F: [41, 48, 53, 57, 60],
  C: [48, 55, 60, 64, 67],
  Gm: [43, 50, 55, 58, 62],
  A: [45, 52, 57, 61, 64],
};
const PROGRESSION = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'];
const SCALE = [62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 79, 81]; // d-Moll (äolisch)
const ARP_PATTERNS = [
  [0, 1, 2, 3, 2, 1, 4, 2],
  [0, 2, 1, 3, 0, 2, 4, 3],
  [0, 1, 2, 1, 3, 2, 4, 1],
];

export class Music {
  constructor(audio) {
    this.a = audio;
    this.ctx = audio.ctx;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(audio.musicBus);
    this.send = this.ctx.createGain();
    this.send.gain.value = 0.7;
    this.send.connect(audio.reverbSend);
    this.out.connect(this.send);

    this.intensity = 0;
    this._int = 0;
    this.step = 0;
    this.bar = 0;
    this.section = 0;
    this.nextTime = 0;
    this.melodyNote = 69;
    this.pattern = ARP_PATTERNS[0];
    this.plucks = new Map();
    this.running = false;
  }

  start() {
    this.nextTime = this.ctx.currentTime + 0.5;
    this.running = true;
  }

  update() {
    if (!this.running) return;
    this._int += (this.intensity - this._int) * 0.02;
    const lookahead = 0.35;
    // Falls der Tab lange weg war: nicht alle verpassten Noten nachholen
    if (this.nextTime < this.ctx.currentTime - 0.5) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + lookahead) {
      this._playStep(this.nextTime);
      const bpm = 66 + this._int * 22;
      this.nextTime += 60 / bpm / 2; // Achtelnoten
    }
  }

  _playStep(t) {
    const chord = CHORDS[PROGRESSION[this.bar % PROGRESSION.length]];
    const s = this.step;
    const barDur = (60 / (66 + this._int * 22)) * 4;

    if (s === 0) {
      if (this.bar % 4 === 0) this.pattern = ARP_PATTERNS[Math.floor(Math.random() * ARP_PATTERNS.length)];
      this._pad([chord[2], chord[3], chord[4]], t, barDur);
      this._bass(chord[0] - 12 >= 36 ? chord[0] - 12 : chord[0], t, barDur);
    }

    // Harfen-Arpeggio
    const arpTones = [chord[2], chord[3], chord[4], chord[2] + 12, chord[3] + 12];
    if (Math.random() < 0.82 || s === 0) {
      const idx = this.pattern[s];
      const vel = (s % 2 === 0 ? 1 : 0.7) * (0.75 + Math.random() * 0.25);
      this._pluck(arpTones[idx], t, vel);
    }

    // Flöten-Melodie in jedem zweiten Abschnitt
    if (this.section % 2 === 1 && s % 2 === 0 && Math.random() < 0.55) {
      const i = SCALE.indexOf(this._nearestScale(this.melodyNote));
      let ni = i + Math.floor(Math.random() * 5) - 2;
      ni = Math.max(0, Math.min(SCALE.length - 1, ni));
      // Auf Akkordtönen landen klingt harmonischer
      let note = SCALE[ni];
      if (s === 0) note = chord[3] + 12;
      this.melodyNote = note;
      this._flute(note + 12, t, (60 / (66 + this._int * 22)) * (Math.random() < 0.5 ? 1 : 2));
    }

    // Trommeln, wenn es spannend wird (Rennen)
    if (this._int > 0.25) {
      if (s === 0 || s === 4) this._drum(t, 0.9 * this._int);
      else if (s === 6 || (s === 3 && Math.random() < 0.5)) this._drum(t, 0.45 * this._int, true);
    }

    this.step++;
    if (this.step >= 8) {
      this.step = 0;
      this.bar++;
      if (this.bar % PROGRESSION.length === 0) this.section++;
    }
  }

  _nearestScale(m) {
    let best = SCALE[0];
    for (const n of SCALE) if (Math.abs(n - m) < Math.abs(best - m)) best = n;
    return best;
  }

  _pad(notes, t, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650 + this._int * 500;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 1.4);
    g.gain.setValueAtTime(0.045, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.8);
    lp.connect(g).connect(this.out);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 2);
      }
    }
  }

  _bass(n, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiToFreq(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.25);
    g.gain.linearRampToValueAtTime(0.07, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.4);
  }

  _getPluck(midi) {
    let buf = this.plucks.get(midi);
    if (buf) return buf;
    // Karplus-Strong: Rauschen in einer Schleife mitteln → Saitenklang
    const sr = this.ctx.sampleRate;
    const f = midiToFreq(midi);
    const N = Math.max(2, Math.round(sr / f));
    const len = Math.floor(sr * 2.4);
    buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      prev = prev * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = prev;
    }
    const decay = 0.9965;
    for (let i = N; i < len; i++) {
      const a = d[i - N];
      const b = i - N - 1 >= 0 ? d[i - N - 1] : 0;
      d[i] = decay * 0.5 * (a + b);
    }
    // sanft ausblenden
    const fade = Math.floor(sr * 0.2);
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    this.plucks.set(midi, buf);
    return buf;
  }

  _pluck(midi, t, vel) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._getPluck(midi);
    const g = this.ctx.createGain();
    g.gain.value = 0.33 * vel;
    src.connect(g).connect(this.out);
    src.start(t);
  }

  _flute(midi, t, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiToFreq(midi);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, t);
    vibAmt.gain.linearRampToValueAtTime(midiToFreq(midi) * 0.006, t + 0.4);
    vib.connect(vibAmt).connect(o.frequency);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = midiToFreq(midi) * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    o2.connect(g2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.12);
    g.gain.setValueAtTime(0.05, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    o.connect(g);
    g2.connect(g);
    g.connect(this.out);
    for (const x of [o, o2, vib]) {
      x.start(t);
      x.stop(t + dur + 0.3);
    }
  }

  _drum(t, strength, light = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(light ? 140 : 85, t);
    o.frequency.exponentialRampToValueAtTime(light ? 80 : 42, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * strength, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (light ? 0.2 : 0.45));
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.5);
    // Fell-Geräusch
    const n = ctx.createBufferSource();
    n.buffer = this.a.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = light ? 1200 : 500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.18 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(lp).connect(ng).connect(this.out);
    n.start(t, Math.random());
    n.stop(t + 0.15);
  }
}
