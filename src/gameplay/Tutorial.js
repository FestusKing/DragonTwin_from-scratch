// Flug-Tutorial: stellt jede Steuerung einzeln vor. Jeder Schritt wartet,
// bis du die Aktion eine Weile ausgeführt hast. Überspringen jederzeit möglich.
import { keyLabel } from '../core/Input.js';

const STEPS = [
  { text: 'Willkommen, Drachenreiter! Ich zeige dir die Steuerung Schritt für Schritt.', info: true, keys: [['Enter']] },
  { text: 'Nase hochziehen → der Drache steigt.', keys: [['pitchUp']], check: (s) => s.input.pitch > 0.4, need: 1.0 },
  { text: 'Nase nach unten → der Drache sinkt und wird schneller.', keys: [['pitchDown']], check: (s) => s.input.pitch < -0.4, need: 1.0 },
  {
    text: 'Zur Seite rollen → so fliegst du Kurven. Probiere beide Seiten!',
    keys: [['rollLeft'], ['rollRight']],
    check: (s, st) => {
      if (s.input.roll < -0.5) st.l = (st.l || 0) + s.dt;
      if (s.input.roll > 0.5) st.r = (st.r || 0) + s.dt;
      return false;
    },
    done: (st) => (st.l || 0) > 0.6 && (st.r || 0) > 0.6,
    progress: (st) => (Math.min(st.l || 0, 0.6) + Math.min(st.r || 0, 0.6)) / 1.2,
  },
  { text: 'Flügelschlag halten → mehr Höhe und mehr Tempo.', keys: [['flap']], check: (s) => s.input.flap, need: 2.0 },
  { text: 'Sturzflug: Der Drache legt die Flügel an. Höhe wird zu Geschwindigkeit!', keys: [['dive']], check: (s) => s.input.dive, need: 1.5 },
  { text: 'Boost! Er kostet Ausdauer (goldener Balken unten). Sie lädt sich wieder auf.', keys: [['boost']], check: (s) => s.physics.boosting, need: 1.5 },
  { text: 'Bremsen und Schweben. Beim Schweben drehst du dich mit den Roll-Tasten auf der Stelle.', keys: [['hover']], check: (s) => s.physics.hovering, need: 2.0 },
  { text: 'Feuer speien! Aber Vorsicht: Zu lange → Überhitzung (roter Balken).', keys: [['fire']], check: (s) => s.input.fire, need: 2.0 },
  {
    text: 'Kamera wechseln: in die Reiter-Sicht und wieder zurück.',
    keys: [['camera']],
    check: () => false,
    done: (st, s) => s.cameraToggles >= 2,
    progress: (st, s) => Math.min(1, s.cameraToggles / 2),
  },
  { text: 'Super – du bist bereit! Tipp: Irgendwo auf der Insel verstecken sich Ziegen… Hörst du sie meckern? 🐐', info: true, auto: 7, keys: [] },
];

export class Tutorial {
  constructor(input, audio, ui) {
    this.input = input;
    this.audio = audio;
    this.ui = ui; // { show(step, index, total, keys, progress), hide(), success() }
    this.active = false;
  }

  start() {
    this.active = true;
    this.index = 0;
    this.st = {};
    this.t = 0;
    this.cameraToggles = 0;
    this._show();
  }

  stop() {
    this.active = false;
    this.ui.hide();
  }

  onCameraToggle() {
    this.cameraToggles++;
  }

  _labels(step) {
    return step.keys.map((group) =>
      group.map((a) => (a === 'Enter' ? 'Enter' : keyLabel(this.input.bindings[a]?.[0]) + (this.input.bindings[a]?.[1] ? ' / ' + keyLabel(this.input.bindings[a][1]) : '')))
    );
  }

  _show(progress = 0) {
    const step = STEPS[this.index];
    this.ui.show(step.text, this.index, STEPS.length, this._labels(step), progress, !!step.info);
  }

  /** s = { dt, input: {pitch, roll, flap, dive, fire}, physics } */
  update(s) {
    if (!this.active) return;
    const step = STEPS[this.index];
    s.cameraToggles = this.cameraToggles;
    this.t += s.dt;
    let progress = 0;
    let done = false;
    if (step.info) {
      if (step.auto) {
        progress = this.t / step.auto;
        done = this.t >= step.auto;
      } else done = this.input.justPressed.has('Enter') || this.input.padPressed(0);
    } else if (step.done) {
      step.check(s, this.st);
      done = step.done(this.st, s);
      progress = step.progress(this.st, s);
    } else {
      if (step.check(s, this.st)) this.st.held = (this.st.held || 0) + s.dt;
      progress = (this.st.held || 0) / step.need;
      done = progress >= 1;
    }
    if (done) {
      this.index++;
      this.st = {};
      this.t = 0;
      if (this.index >= STEPS.length) {
        this.active = false;
        this.ui.hide();
        this.ui.finished?.();
        return;
      }
      this.audio?.playSuccess();
      this.ui.success?.();
      this._show(0);
    } else {
      this.ui.progress(Math.min(1, progress));
    }
  }
}
