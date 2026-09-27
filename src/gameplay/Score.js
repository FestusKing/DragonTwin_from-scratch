// Punkte und Kombos: Jede Tat gibt Punkte (Feuer, Schafe, Türme, Tiefflug …).
// Kommt die nächste Tat schnell genug (COMBO_TIME), steigt der Kombo-Zähler
// (×2, ×3 … bis ×5) – dann zählt jede Tat mehrfach. Die Punkte zählen auch als
// Erfahrung (XP) für den Drachen-Rang (siehe Missions.js).
import { storage } from '../core/utils.js';

const KEY = 'dragontwin.score.v1';
const COMBO_TIME = 4.5; // Sekunden bis die Kombo verfällt
const MAX_COMBO = 5;

export class Score {
  constructor() {
    const saved = storage.get(KEY, {});
    this.best = saved.best || 0; // beste Punktzahl in einem Flug
    this.points = 0; // Punkte in diesem Flug
    this.combo = 1;
    this.comboTimer = 0;
    this.chain = 0; // Taten in Folge (für die Kombo)
    this.onAdd = null; // (Punkte, Text, Kombo)
    this.onCombo = null; // (Kombo)
    this.onBest = null; // neue Bestleistung
    this._bestShown = false;
  }

  /** Neuer Flug (Neustart, Absturz zählt nicht als Neustart) */
  resetRun() {
    this.points = 0;
    this.combo = 1;
    this.chain = 0;
    this.comboTimer = 0;
    this._bestShown = false;
  }

  /** Kombo verlieren (z. B. bei einem Absturz) */
  breakCombo() {
    this.combo = 1;
    this.chain = 0;
    this.comboTimer = 0;
  }

  /**
   * Punkte vergeben. chain = false: zählt die Kombo nicht hoch (z. B. Tiefflug pro Sekunde)
   * Rückgabe: vergebene Punkte (mit Kombo)
   */
  add(base, label, { chain = true } = {}) {
    if (chain) {
      this.chain++;
      const c = Math.min(MAX_COMBO, 1 + Math.floor(this.chain / 3));
      if (c > this.combo) this.onCombo?.(c);
      this.combo = c;
      this.comboTimer = COMBO_TIME;
    } else if (this.comboTimer > 0) {
      this.comboTimer = Math.max(this.comboTimer, 1.5);
    }
    const pts = Math.round(base * this.combo);
    this.points += pts;
    this.onAdd?.(pts, label, this.combo);
    if (this.points > this.best) {
      this.best = this.points;
      if (!this._bestShown && this.best > 1000) {
        this._bestShown = true;
        this.onBest?.();
      }
      this._saveSoon = true;
    }
    return pts;
  }

  update(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.breakCombo();
    }
    if (this._saveSoon) {
      this._saveTimer = (this._saveTimer || 0) - dt;
      if (this._saveTimer <= 0) {
        this._saveTimer = 3;
        this._saveSoon = false;
        storage.set(KEY, { best: this.best });
      }
    }
  }

  /** 0..1: wie viel Zeit die Kombo noch hat (für die Anzeige) */
  get comboLeft() {
    return this.combo > 1 ? Math.max(0, this.comboTimer / COMBO_TIME) : 0;
  }
}
