// Eingabe: Tastatur, Maus und Gamepad.
// Das Spiel fragt nie direkt "ist W gedrückt?", sondern "ist die AKTION
// pitchDown aktiv?". So kann man die Tasten frei neu belegen.
import { clamp, storage } from './utils.js';
import { settings } from './Settings.js';

const KEY = 'dragontwin.keys.v1';

// Aktionen mit deutscher Beschriftung (für das Einstellungsmenü)
export const ACTIONS = [
  { id: 'pitchUp', label: 'Nase hoch (steigen)' },
  { id: 'pitchDown', label: 'Nase runter (sinken)' },
  { id: 'rollLeft', label: 'Rollen links' },
  { id: 'rollRight', label: 'Rollen rechts' },
  { id: 'flap', label: 'Flügelschlag' },
  { id: 'dive', label: 'Sturzflug (Flügel anlegen)' },
  { id: 'boost', label: 'Boost' },
  { id: 'fire', label: 'Feuer speien' },
  { id: 'hover', label: 'Bremsen / Schweben' },
  { id: 'camera', label: 'Kamera wechseln' },
  { id: 'roar', label: 'Brüllen' },
  { id: 'restart', label: 'Rennen neu starten' },
  { id: 'photo', label: 'HUD ein/aus (Fotomodus)' },
  { id: 'help', label: 'Steuerung anzeigen' },
  { id: 'mute', label: 'Ton an/aus' },
  { id: 'pause', label: 'Pause' },
];

// Standard-Belegung. Pro Aktion bis zu 2 Tasten.
// Hinweis: Boost liegt primär auf E, weil Strg+W im Browser den Tab schliesst!
export const DEFAULT_BINDINGS = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  flap: ['Space', null],
  dive: ['ShiftLeft', 'ShiftRight'],
  boost: ['KeyE', 'ControlLeft'],
  fire: ['KeyF', null],
  hover: ['KeyV', null],
  camera: ['KeyC', null],
  roar: ['KeyQ', null],
  restart: ['KeyR', null],
  photo: ['KeyP', null],
  help: ['KeyH', null],
  mute: ['KeyM', null],
  pause: ['Escape', null],
};

// Gamepad (Standard-Layout, z. B. Xbox-Controller)
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_ACTIONS = {
  flap: PAD.A,
  dive: PAD.B,
  fire: PAD.X,
  camera: PAD.Y,
  roar: PAD.RB,
  boost: PAD.RT,
  hover: PAD.LT,
  pause: PAD.START,
  help: PAD.BACK,
  restart: PAD.LB,
};

const KEY_LABELS = {
  Space: 'Leertaste', ShiftLeft: 'Shift', ShiftRight: 'Shift rechts',
  ControlLeft: 'Strg', ControlRight: 'Strg rechts', AltLeft: 'Alt', AltRight: 'AltGr',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Feststell',
  Backquote: '§', Minus: "'", Equal: '^', BracketLeft: 'Ü', BracketRight: '¨',
  Semicolon: 'Ö', Quote: 'Ä', Backslash: '$', Comma: ',', Period: '.', Slash: '-',
};

// Chrome/Edge kennen das echte Tastatur-Layout → noch bessere Beschriftung
let layoutMap = null;
try {
  navigator.keyboard?.getLayoutMap?.().then((m) => (layoutMap = m)).catch(() => {});
} catch {
  /* nicht unterstützt */
}

export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  const real = layoutMap?.get(code);
  if (real && real.trim()) return real.toUpperCase();
  if (code.startsWith('Key')) {
    // Schweizer/Deutsche Tastatur: Y und Z sind vertauscht
    const k = code.slice(3);
    if (k === 'Y') return 'Z';
    if (k === 'Z') return 'Y';
    return k;
  }
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.bindings = this._loadBindings();
    this.down = new Set(); // aktuell gedrückte Tasten (event.code)
    this.justPressed = new Set(); // seit dem letzten update() gedrückt
    this.padPrev = [];
    this.padNow = [];
    this.padAxes = [0, 0, 0, 0];
    this.hasPad = false;
    this.lastDevice = 'keyboard';
    this.gameActive = false; // true = Spieltasten blockieren Browser-Aktionen
    this.captureCallback = null;

    // Geglättete Achsen (Tastatur fühlt sich so analoger an)
    this.pitch = 0;
    this.roll = 0;

    // Maus-Kamera
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.dragging = false;
    this.lastDragTime = -10;

    this._bindEvents();
  }

  _loadBindings() {
    const saved = storage.get(KEY, null);
    const b = {};
    for (const a of ACTIONS) {
      b[a.id] = saved && Array.isArray(saved[a.id]) ? saved[a.id].slice(0, 2) : DEFAULT_BINDINGS[a.id].slice();
      while (b[a.id].length < 2) b[a.id].push(null);
    }
    return b;
  }

  saveBindings() {
    storage.set(KEY, this.bindings);
  }

  resetBindings() {
    for (const a of ACTIONS) this.bindings[a.id] = DEFAULT_BINDINGS[a.id].slice();
    this.saveBindings();
  }

  /** Belegt eine Aktion neu. slot 0 = primär, 1 = sekundär. */
  rebind(action, slot, code) {
    // Taste von anderen Aktionen entfernen, damit es keine Doppelbelegung gibt
    for (const a of ACTIONS) {
      const arr = this.bindings[a.id];
      for (let i = 0; i < 2; i++) if (arr[i] === code) arr[i] = null;
    }
    this.bindings[action][slot] = code;
    this.saveBindings();
  }

  /** Nächste gedrückte Taste abfangen (für die Neubelegung). */
  captureNext(cb) {
    this.captureCallback = cb;
  }

  _isBound(code) {
    for (const a of ACTIONS) if (this.bindings[a.id].includes(code)) return true;
    return false;
  }

  _bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (this.captureCallback) {
        e.preventDefault();
        const cb = this.captureCallback;
        this.captureCallback = null;
        cb(e.code === 'Escape' ? null : e.code);
        return;
      }
      this.lastDevice = 'keyboard';
      if (!e.repeat) this.justPressed.add(e.code);
      this.down.add(e.code);
      // Im Spiel: Browser-Kürzel wie Strg+F (Suchen) oder Leertaste (Scrollen) blockieren
      if (this.gameActive && (this._isBound(e.code) || e.ctrlKey)) {
        if (!['F5', 'F11', 'F12'].includes(e.code)) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    // Fenster verliert Fokus → alle Tasten loslassen (sonst "klemmt" eine Taste)
    window.addEventListener('blur', () => {
      this.down.clear();
      this.dragging = false;
    });

    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      if (!settings.get('mouseCamera')) return;
      this.dragging = true;
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
      this.lastDragTime = performance.now() / 1000;
    });
    const up = (e) => {
      this.dragging = false;
      c.releasePointerCapture?.(e.pointerId);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false }
    );
    window.addEventListener('gamepadconnected', () => (this.hasPad = true));
  }

  _pollGamepad() {
    this.padPrev = this.padNow;
    this.padNow = [];
    this.padAxes = [0, 0, 0, 0];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.hasPad = !!pad;
    if (!pad) return;
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      this.padNow[i] = b.value > 0.4 || b.pressed;
      if (this.padNow[i] && !this.padPrev[i]) this.lastDevice = 'gamepad';
    }
    for (let i = 0; i < 4; i++) {
      let v = pad.axes[i] || 0;
      // Totzone: kleine Stick-Bewegungen ignorieren
      v = Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85;
      this.padAxes[i] = v;
      if (v !== 0) this.lastDevice = 'gamepad';
    }
  }

  /** Einmal pro Bild aufrufen (VOR dem Spiel-Update). */
  update(dt) {
    this._pollGamepad();

    // Tastatur-Achsen weich hochfahren (≈0.15 s) und schneller zurück
    const kp = (this.isDown('pitchUp') ? 1 : 0) - (this.isDown('pitchDown') ? 1 : 0);
    const kr = (this.isDown('rollRight') ? 1 : 0) - (this.isDown('rollLeft') ? 1 : 0);
    const approach = (cur, tgt) => {
      const rate = tgt === 0 || Math.sign(tgt) !== Math.sign(cur) ? 10 : 6.5;
      const d = tgt - cur;
      const step = rate * dt;
      return Math.abs(d) <= step ? tgt : cur + Math.sign(d) * step;
    };
    this.pitch = approach(this.pitch, kp);
    this.roll = approach(this.roll, kr);
  }

  /** Nach dem Spiel-Update aufrufen: "gerade gedrückt"-Status zurücksetzen. */
  endFrame() {
    this.justPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  isDown(action) {
    const codes = this.bindings[action];
    if (codes) for (const c of codes) if (c && this.down.has(c)) return true;
    const pb = PAD_ACTIONS[action];
    if (pb !== undefined && this.padNow[pb]) return true;
    return false;
  }

  pressed(action) {
    const codes = this.bindings[action];
    if (codes) for (const c of codes) if (c && this.justPressed.has(c)) return true;
    const pb = PAD_ACTIONS[action];
    if (pb !== undefined && this.padNow[pb] && !this.padPrev[pb]) return true;
    return false;
  }

  /** Nase hoch = +1, Nase runter = -1 (Tastatur + linker Stick). */
  getPitch() {
    // Stick nach vorne (negativ) = Nase runter, wie im Flugzeug
    let p = this.pitch + this.padAxes[1];
    if (settings.get('invertPitch')) p = -p;
    return clamp(p, -1, 1);
  }

  /** Rollen rechts = +1 */
  getRoll() {
    return clamp(this.roll + this.padAxes[0], -1, 1);
  }

  /** Rechter Stick für die Kamera */
  getLook() {
    return { x: this.padAxes[2], y: this.padAxes[3] };
  }

  padPressed(btn) {
    return this.padNow[btn] && !this.padPrev[btn];
  }

  /** Irgendeine Taste/Knopf gedrückt? */
  anyPressed() {
    return this.justPressed.size > 0 || this.padNow.some((b, i) => b && !this.padPrev[i]);
  }
}

export { PAD };
