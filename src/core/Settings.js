// Alle Einstellungen an einem Ort. Werden im localStorage gespeichert,
// damit sie beim nächsten Start noch da sind.
import { storage } from './utils.js';

const KEY = 'dragontwin.settings.v1';

export const DEFAULT_SETTINGS = {
  // Grafik
  quality: 'auto', // 'low' | 'medium' | 'high' | 'auto'
  showFps: false,
  // Welt
  timeOfDay: 16.5, // Startzeit in Stunden (0–24)
  timeRunning: true,
  dayLengthMin: 20, // ein kompletter Tag dauert so viele echte Minuten
  weather: 'auto', // 'auto' | 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm'
  // Audio
  masterVolume: 0.8,
  musicVolume: 0.45,
  sfxVolume: 0.9,
  muted: false,
  // Spielhilfe / Steuerung
  invertPitch: false,
  flightAssist: true, // automatisches Ausrichten + Flügelschlag-Hilfe
  mouseCamera: true,
  showMinimap: true,
  cameraShake: true,
  ghost: true,
  enemies: true, // Armbrust-Türme schiessen auf den Drachen
};

class SettingsStore {
  constructor() {
    this.data = { ...DEFAULT_SETTINGS, ...storage.get(KEY, {}) };
    this.listeners = new Set();
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (this.data[key] === value) return;
    this.data[key] = value;
    storage.set(KEY, this.data);
    for (const fn of this.listeners) fn(key, value);
  }

  /** Callback wird bei jeder Änderung aufgerufen: fn(key, value) */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  reset() {
    for (const k of Object.keys(DEFAULT_SETTINGS)) this.set(k, DEFAULT_SETTINGS[k]);
  }
}

export const settings = new SettingsStore();
