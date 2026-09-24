// AudioManager – ALLE Geräusche werden hier mit der Web Audio API
// "synthetisch" erzeugt (aus Rauschen und Schwingungen). Es werden keine
// Sounddateien geladen. Vorteil: nichts herunterladen, keine Lizenzprobleme.
//
// Grundidee Web Audio: Man verbindet "Knoten" wie Kabel an einem Mischpult:
//   Quelle (Oszillator / Rauschen) → Filter → Lautstärke (Gain) → Ausgang
import { Vector3 } from 'three';
import { clamp, lerp } from './utils.js';
import { settings } from './Settings.js';
import { Music } from './Music.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.birdTimer = 2;
    this.goatVoices = 0;
  }

  /** Muss nach einem Klick/Tastendruck aufgerufen werden (Browser-Regel). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    // Mischpult: master → Kompressor (verhindert Übersteuern) → Lautsprecher
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);

    // Hall (Reverb) für Musik, Glocken, Donner, Brüllen
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.noiseBuffer = this._makeNoise(3);
    this.brownBuffer = this._makeBrownNoise(4);
    this.crackleBuffer = this._makeCrackle(3);

    this._setupWind();
    this._setupRain();
    this._setupFire();
    this._setupBurnCrackle();
    this._setupCrickets();

    this.music = new Music(this);
    this.applyVolumes();
    settings.onChange((k) => {
      if (['masterVolume', 'musicVolume', 'sfxVolume', 'muted'].includes(k)) this.applyVolumes();
    });
    this.ready = true;
    this.music.start();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = settings.get('muted') ? 0 : settings.get('masterVolume');
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.get('musicVolume') * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.get('sfxVolume'), t, 0.05);
    this.ambBus.gain.setTargetAtTime(settings.get('sfxVolume') * 0.9, t, 0.05);
  }

  // ---------- Hilfsfunktionen zum Erzeugen von Klang-Material ----------

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Braunes Rauschen = tiefer, "weicher" (gut für Wind und Donner)
  _makeBrownNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  // Knistern = seltene kurze Knackser (für Feuer)
  _makeCrackle(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0009) {
        const amp = 0.3 + Math.random() * 0.7;
        const l = Math.floor(sr * (0.002 + Math.random() * 0.01));
        for (let j = 0; j < l && i + j < len; j++) d[i + j] += (Math.random() * 2 - 1) * amp * (1 - j / l);
      }
    }
    return buf;
  }

  // Impulsantwort für den Hall: abklingendes Rauschen in Stereo
  _makeImpulse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _loop(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = Math.random() * buffer.duration * 0.5;
    src.start(0, Math.random() * buffer.duration);
    return src;
  }

  _gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  _filter(type, freq, q = 1) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // ---------- Dauer-Geräusche (Loops) ----------

  _setupWind() {
    // Tiefes Rauschen (Rumpeln) + pfeifender Anteil bei hoher Geschwindigkeit
    this.windLow = this._gain();
    this.windLowF = this._filter('lowpass', 300, 0.7);
    this._loop(this.brownBuffer).connect(this.windLowF).connect(this.windLow).connect(this.ambBus);

    this.windHigh = this._gain();
    this.windHighF = this._filter('bandpass', 900, 2.5);
    this._loop(this.noiseBuffer).connect(this.windHighF).connect(this.windHigh).connect(this.ambBus);
  }

  _setupRain() {
    this.rainGain = this._gain();
    const hp = this._filter('highpass', 900, 0.5);
    const lp = this._filter('lowpass', 7500, 0.5);
    this._loop(this.noiseBuffer).connect(hp).connect(lp).connect(this.rainGain).connect(this.ambBus);
    this.rainLow = this._gain();
    this._loop(this.brownBuffer).connect(this._filter('lowpass', 400, 0.5)).connect(this.rainLow).connect(this.ambBus);
  }

  _setupFire() {
    // Feuerstoss: Rauschen + Brummen + Knistern
    this.fireGain = this._gain();
    const bp = this._filter('bandpass', 650, 0.6);
    this._loop(this.noiseBuffer).connect(bp).connect(this.fireGain);
    const low = this._gain(0.9);
    this._loop(this.brownBuffer).connect(this._filter('lowpass', 250, 0.8)).connect(low).connect(this.fireGain);
    const cr = this._gain(1.2);
    this._loop(this.crackleBuffer).connect(this._filter('highpass', 1500, 0.5)).connect(cr).connect(this.fireGain);
    this.fireGain.connect(this.sfxBus);
  }

  _setupBurnCrackle() {
    this.burnGain = this._gain();
    this.burnFilter = this._filter('lowpass', 3000, 0.5);
    this._loop(this.crackleBuffer).connect(this.burnFilter).connect(this.burnGain).connect(this.ambBus);
    const rumble = this._gain(0.25);
    this._loop(this.brownBuffer).connect(this._filter('lowpass', 180, 0.5)).connect(rumble).connect(this.burnGain);
  }

  _setupCrickets() {
    // Grillen: hoher Ton, der schnell "an/aus" moduliert wird
    this.cricketGain = this._gain();
    const make = (freq, rate, slow) => {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const am = this._gain(0.5);
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = rate;
      const lfoAmt = this._gain(0.5);
      lfo.connect(lfoAmt).connect(am.gain);
      const am2 = this._gain(0.5);
      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = slow;
      const lfo2Amt = this._gain(0.5);
      lfo2.connect(lfo2Amt).connect(am2.gain);
      osc.connect(am).connect(am2).connect(this.cricketGain);
      osc.start();
      lfo.start();
      lfo2.start();
    };
    make(4300, 28, 0.9);
    make(4750, 33, 0.63);
    make(3900, 24, 1.3);
    this.cricketGain.connect(this.ambBus);
  }

  // ---------- Update jedes Bild ----------

  /**
   * @param {object} s Zustand: speed, agl (Höhe über Boden), fire (0..1),
   *   rain, night (0..1), day (0..1), wind, burnNearby, burnDist, paused, inMenu
   */
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const tc = 0.12;
    const paused = s.paused ? 0.25 : 1;

    // Wind wird mit der Geschwindigkeit lauter und höher
    const sp = clamp(s.speed / 110, 0, 1.3);
    const gust = s.wind || 0;
    this.windLow.gain.setTargetAtTime((0.05 + sp * 0.55 + gust * 0.15 + (s.inCloud || 0) * 0.15) * paused, t, tc);
    this.windLowF.frequency.setTargetAtTime(200 + sp * 500, t, tc);
    this.windHigh.gain.setTargetAtTime(clamp(sp * sp * 0.2 + gust * 0.04, 0, 0.3) * paused, t, tc);
    this.windHighF.frequency.setTargetAtTime(600 + sp * 1600 + Math.sin(t * 0.7) * 120, t, 0.3);

    this.rainGain.gain.setTargetAtTime(s.rain * 0.3 * paused, t, 0.5);
    this.rainLow.gain.setTargetAtTime(s.rain * 0.18 * paused, t, 0.5);

    this.fireGain.gain.setTargetAtTime(s.fire * 0.55 * paused, t, 0.05);

    this.burnGain.gain.setTargetAtTime(clamp(s.burnNearby, 0, 1) * 0.6 * paused, t, 0.3);
    this.burnFilter.frequency.setTargetAtTime(lerp(600, 4000, clamp(1 - s.burnDist / 400, 0, 1)), t, 0.3);

    const nearGround = clamp(1 - s.agl / 180, 0, 1);
    this.cricketGain.gain.setTargetAtTime(s.night * nearGround * (1 - s.rain) * 0.018 * paused, t, 0.8);

    // Vögel zwitschern zufällig am Tag, in Bodennähe
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.2 + Math.random() * 4;
      const vol = s.day * nearGround * (1 - s.rain) * paused;
      if (vol > 0.05 && !s.inMenu) this.playBirdSong(vol);
    }

    if (this.music) this.music.update();
  }

  /** Hörer-Position = Kamera (für räumliche Ziegen-Geräusche). */
  setListener(camera) {
    if (!this.ready) return;
    const L = this.ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this._tmpDir || (this._tmpDir = new Vector3()));
    const up = camera.up;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t);
      L.positionY.setValueAtTime(p.y, t);
      L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t);
      L.forwardY.setValueAtTime(f.y, t);
      L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(up.x, t);
      L.upY.setValueAtTime(up.y, t);
      L.upZ.setValueAtTime(up.z, t);
    } else if (L.setPosition) {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, up.x, up.y, up.z);
    }
  }

  // ---------- Einmal-Geräusche ----------

  _noiseBurst(dest, { dur = 0.4, type = 'lowpass', freq = 800, q = 1, gain = 0.5, attack = 0.01, freqEnd = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this._filter(type, freq, q);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this._gain(0);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
    return g;
  }

  _tone(dest, { freq, type = 'sine', dur = 0.3, gain = 0.3, attack = 0.005, when = 0, freqEnd = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  /** Flügelschlag: dumpfes "Wuusch" */
  playFlap(strength = 1) {
    if (!this.ready) return;
    const s = clamp(strength, 0, 1.5);
    this._noiseBurst(this.sfxBus, { dur: 0.45, freq: 380, freqEnd: 140, q: 0.8, gain: 0.35 * s, attack: 0.06 });
    this._noiseBurst(this.sfxBus, { dur: 0.25, type: 'bandpass', freq: 900, q: 1.2, gain: 0.08 * s, attack: 0.04 });
    this._tone(this.sfxBus, { freq: 70, freqEnd: 40, dur: 0.3, gain: 0.25 * s, attack: 0.03 });
  }

  /** Glocke beim Durchfliegen eines Rings. Tonhöhe steigt pro Ring. */
  playChime(index = 0) {
    if (!this.ready) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
    const base = 523.25 * Math.pow(2, scale[index % scale.length] / 12);
    const partials = [
      [1, 0.35, 1.6],
      [2.0, 0.14, 1.0],
      [3.01, 0.08, 0.7],
      [4.2, 0.05, 0.5],
    ];
    for (const [r, g, d] of partials) {
      const node = this._tone(this.sfxBus, { freq: base * r, dur: d, gain: g });
      node.connect(this.reverbSend);
    }
    this._noiseBurst(this.sfxBus, { dur: 0.5, type: 'highpass', freq: 3000, gain: 0.05, attack: 0.02 });
  }

  /** Ziel-Fanfare */
  playFinish(newRecord = false) {
    if (!this.ready) return;
    const notes = newRecord ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12];
    notes.forEach((n, i) => {
      const f = 392 * Math.pow(2, n / 12);
      const g1 = this._tone(this.sfxBus, { freq: f, type: 'triangle', dur: 1.2, gain: 0.18, when: i * 0.11 });
      g1.connect(this.reverbSend);
      this._tone(this.sfxBus, { freq: f * 2, dur: 0.8, gain: 0.06, when: i * 0.11 });
    });
  }

  playCountdown(final = false) {
    if (!this.ready) return;
    const f = final ? 880 : 440;
    const g = this._tone(this.sfxBus, { freq: f, type: 'triangle', dur: final ? 0.8 : 0.35, gain: 0.25 });
    g.connect(this.reverbSend);
    if (final) this._tone(this.sfxBus, { freq: f * 1.5, dur: 0.7, gain: 0.1 });
  }

  playClick() {
    if (!this.ready) return;
    this._tone(this.sfxBus, { freq: 820, freqEnd: 600, dur: 0.07, gain: 0.08 });
  }

  playHover() {
    if (!this.ready) return;
    this._tone(this.sfxBus, { freq: 1300, dur: 0.035, gain: 0.025 });
  }

  playSuccess() {
    if (!this.ready) return;
    this._tone(this.sfxBus, { freq: 660, type: 'triangle', dur: 0.25, gain: 0.15 }).connect(this.reverbSend);
    this._tone(this.sfxBus, { freq: 990, type: 'triangle', dur: 0.45, gain: 0.15, when: 0.1 }).connect(this.reverbSend);
  }

  playError() {
    if (!this.ready) return;
    this._tone(this.sfxBus, { freq: 220, type: 'square', dur: 0.2, gain: 0.05 });
  }

  /** Feuer zündet ein Objekt an: "Wumm" */
  playIgnite(vol = 1) {
    if (!this.ready) return;
    this._noiseBurst(this.sfxBus, { dur: 0.7, freq: 200, freqEnd: 1200, q: 0.7, gain: 0.25 * vol, attack: 0.08 });
  }

  playSplash(strength = 1) {
    if (!this.ready) return;
    const s = clamp(strength, 0.1, 1.5);
    this._noiseBurst(this.sfxBus, { dur: 0.3 + s * 0.5, type: 'bandpass', freq: 1400, freqEnd: 500, q: 0.6, gain: 0.3 * s, attack: 0.01 });
    this._tone(this.sfxBus, { freq: 90, freqEnd: 45, dur: 0.3, gain: 0.2 * s });
  }

  playImpact(strength = 1) {
    if (!this.ready) return;
    const s = clamp(strength, 0.1, 1.5);
    this._tone(this.sfxBus, { freq: 60, freqEnd: 30, dur: 0.5, gain: 0.5 * s });
    this._noiseBurst(this.sfxBus, { dur: 0.6, freq: 500, freqEnd: 100, gain: 0.35 * s });
  }

  /** Überschall-Knall: zwei harte Schläge kurz nacheinander + tiefes Grollen */
  playBoom() {
    if (!this.ready) return;
    const crack = () => {
      this._noiseBurst(this.sfxBus, { dur: 0.4, freq: 3000, freqEnd: 180, q: 0.5, gain: 0.75, attack: 0.002 });
      this._tone(this.sfxBus, { freq: 55, freqEnd: 28, dur: 0.9, gain: 0.6, attack: 0.004 });
    };
    crack();
    setTimeout(crack, 110);
    this.playThunder(0.05, 0.45);
  }

  /** Boost: anschwellendes "Wuuusch" */
  playWhoosh() {
    if (!this.ready) return;
    this._noiseBurst(this.sfxBus, { dur: 0.7, type: 'bandpass', freq: 280, freqEnd: 1600, q: 0.9, gain: 0.35, attack: 0.18 });
    this._tone(this.sfxBus, { freq: 60, freqEnd: 95, dur: 0.6, gain: 0.25, attack: 0.1 });
  }

  /** Ziegen-Meckern: "Määäh". pos = Weltposition (für räumlichen Klang) */
  playBleat(pos = null, volume = 1) {
    if (!this.ready || this.goatVoices > 4) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.75 + Math.random() * 0.35;
    const f0 = 330 + Math.random() * 120;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 1.08, t);
    osc.frequency.linearRampToValueAtTime(f0, t + 0.12);
    osc.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur);
    // Vibrato = das typische "Zittern" der Ziegenstimme
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5 + Math.random() * 2;
    const vibAmt = this._gain(f0 * 0.07);
    vib.connect(vibAmt).connect(osc.frequency);
    const trem = this._gain(0.6);
    const tremAmt = this._gain(0.4);
    vib.connect(tremAmt).connect(trem.gain);

    // Formant-Filter lassen es wie ein "ä" klingen
    const f1 = this._filter('bandpass', 750, 4);
    const f2 = this._filter('bandpass', 1650, 6);
    const env = this._gain(0);
    env.gain.linearRampToValueAtTime(0.9 * volume, t + 0.04);
    env.gain.setValueAtTime(0.9 * volume, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(trem);
    trem.connect(f1).connect(env);
    trem.connect(f2).connect(env);

    let out = env;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 25;
      p.maxDistance = 2000;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      env.connect(p);
      out = p;
    }
    out.connect(this.sfxBus);
    out.connect(this.reverbSend);
    osc.start(t);
    vib.start(t);
    osc.stop(t + dur + 0.1);
    vib.stop(t + dur + 0.1);
    this.goatVoices++;
    osc.onended = () => this.goatVoices--;
  }

  /** Drachen-Gebrüll: verzerrte tiefe Schwingung mit wanderndem Filter */
  playRoar() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 2.0;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(75, t);
    o1.frequency.linearRampToValueAtTime(105, t + 0.4);
    o1.frequency.linearRampToValueAtTime(62, t + dur);
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(37, t);
    o2.frequency.linearRampToValueAtTime(50, t + 0.4);
    o2.frequency.linearRampToValueAtTime(30, t + dur);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const nGain = this._gain(0.5);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 4);
    }
    shaper.curve = curve;

    const bp = this._filter('bandpass', 400, 1.8);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.linearRampToValueAtTime(950, t + 0.5);
    bp.frequency.linearRampToValueAtTime(380, t + dur);
    const lp = this._filter('lowpass', 2400, 0.7);
    const env = this._gain(0);
    env.gain.linearRampToValueAtTime(0.55, t + 0.18);
    env.gain.setValueAtTime(0.55, t + 1.1);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pre = this._gain(0.4);
    o1.connect(pre);
    o2.connect(pre);
    n.connect(nGain).connect(pre);
    pre.connect(shaper).connect(bp).connect(lp).connect(env);
    env.connect(this.sfxBus);
    env.connect(this.reverbSend);
    [o1, o2, n].forEach((s) => {
      s.start(t);
      s.stop(t + dur + 0.1);
    });
  }

  /** Donner. delay = Sekunden bis der Schall ankommt (Blitz-Entfernung). */
  playThunder(delay = 1, strength = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const dur = 4 + Math.random() * 2;
    const src = ctx.createBufferSource();
    src.buffer = this.brownBuffer;
    const lp = this._filter('lowpass', 900, 0.6);
    lp.frequency.setValueAtTime(delay < 1.5 ? 2500 : 900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = this._gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * strength, t + 0.08);
    // mehrere "Rumpler"
    let tt = t + 0.3;
    while (tt < t + dur - 0.5) {
      g.gain.linearRampToValueAtTime((0.3 + Math.random() * 0.6) * strength, tt);
      tt += 0.2 + Math.random() * 0.6;
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g);
    g.connect(this.ambBus);
    g.connect(this.reverbSend);
    src.start(t, Math.random());
    src.stop(t + dur + 0.1);
  }

  playBirdSong(vol) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = this._gain(vol * 0.045);
    if (pan) out.connect(pan).connect(this.ambBus);
    else out.connect(this.ambBus);
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = 2200 + Math.random() * 1800;
    let when = 0;
    for (let i = 0; i < notes; i++) {
      const f = base * (0.85 + Math.random() * 0.4);
      this._tone(out, { freq: f, freqEnd: f * (Math.random() < 0.5 ? 1.35 : 0.75), dur: 0.06 + Math.random() * 0.08, gain: 1, when });
      when += 0.08 + Math.random() * 0.1;
    }
  }

  /** Musik-Intensität: 0 = ruhig, 1 = Rennen (mit Trommeln) */
  setMusicIntensity(v) {
    if (this.music) this.music.intensity = v;
  }
}
