// Aufträge und Drachen-Rang.
// - Aufträge: kleine Ziele (Schlacht gewinnen, Schlucht durchfliegen, Hort finden …).
//   Es sind immer 3 gleichzeitig offen; ist einer geschafft, kommt der nächste.
// - Rang: steigt mit der Erfahrung (XP = alle jemals verdienten Punkte + Auftrags-Bonus).
//   Neue Ränge schalten neue Drachenfarben frei (Customization.js: rank).
// Alles wird im Browser gespeichert.
import { storage } from '../core/utils.js';

const KEY = 'dragontwin.missions.v1';
const ACTIVE = 3;

export const RANKS = [
  { name: 'Jungdrache', xp: 0 },
  { name: 'Feuerspeier', xp: 2000 },
  { name: 'Himmelsjäger', xp: 6000 },
  { name: 'Schrecken des Tals', xp: 14000 },
  { name: 'Drachenkönig', xp: 28000 },
];

/**
 * type 'event': ein Ereignis genügt; type 'count': so oft (goal).
 * target: Ort für den Wegweiser ('hoard', 'battle', 'siege', 'enemyDragon', 'canyon', 'bridge',
 * 'arch', 'pasture', 'village', 'towers').
 */
export const MISSIONS = [
  { id: 'hoard', text: 'Finde deinen Hort im Vulkan (Nordosten) und lande dort', type: 'event', xp: 400, target: 'hoard' },
  { id: 'horn', text: 'Fliege zur Schlacht (Südosten) und blase das Drachenhorn', type: 'event', xp: 300, target: 'battle' },
  { id: 'soldiers40', text: 'Besiege 40 Soldaten der Eisenkrone (rot) mit Feuer oder Wucht', type: 'count', goal: 40, xp: 500, target: 'battle' },
  { id: 'dodge', text: 'Mache eine Ausweichrolle (2× schnell nach links oder rechts)', type: 'event', xp: 200 },
  { id: 'siege', text: 'Zerstöre 3 Belagerungs-Armbrüste hinter dem feindlichen Heer', type: 'count', goal: 3, xp: 600, target: 'siege' },
  { id: 'battle', text: 'Gewinne eine Schlacht (Anführer besiegen oder Heer vertreiben)', type: 'event', xp: 1200, target: 'battle' },
  { id: 'bite', text: 'Beisse zu: Soldaten oder den Drachenreiter', type: 'event', xp: 300, target: 'battle' },
  { id: 'huts5', text: 'Setze 5 Dächer in Brand', type: 'count', goal: 5, xp: 300, target: 'village' },
  { id: 'collapse5', text: 'Bringe 5 Gebäude zum Einsturz (Feuer oder Wucht)', type: 'count', goal: 5, xp: 500, target: 'village' },
  { id: 'canyon', text: 'Fliege durch die ganze Drachenschlucht (Westen)', type: 'event', xp: 600, target: 'canyon' },
  { id: 'sweep', text: 'Wirf 15 Soldaten um (harte Landung oder Tiefflug über die Reihen)', type: 'count', goal: 15, xp: 400, target: 'battle' },
  { id: 'enemyDragon', text: 'Besiege den feindlichen Drachenreiter', type: 'event', xp: 1500, target: 'enemyDragon' },
  { id: 'bridge', text: 'Fliege unter der Hängebrücke in der Schlucht durch', type: 'event', xp: 400, target: 'bridge' },
  { id: 'lowfly', text: 'Tiefflug: 10 Sekunden ganz nah über Boden oder Wasser', type: 'count', goal: 10, xp: 300 },
  { id: 'arch', text: 'Fliege durch den Felsbogen im Meer (Süden)', type: 'event', xp: 400, target: 'arch' },
  { id: 'towers', text: 'Zerstöre alle Armbrüste (Wachtürme und Burg) mit Feuer', type: 'event', xp: 1000, target: 'towers' },
  { id: 'sonic', text: 'Durchbrich die Schallmauer (Sturzflug + Boost)', type: 'event', xp: 500 },
  { id: 'burn40', text: 'Setze 40 Dinge in Brand (Bäume zählen auch)', type: 'count', goal: 40, xp: 600 },
  { id: 'goats6', text: 'Finde 6 versteckte Ziegen', type: 'count', goal: 6, xp: 700 },
  { id: 'combo5', text: 'Schaffe eine ×5-Kombo', type: 'event', xp: 700 },
  { id: 'race', text: 'Hole eine Goldmedaille in einem Rennen', type: 'event', xp: 900 },
  { id: 'score', text: 'Mache 5000 Punkte in einem Flug', type: 'event', xp: 1000 },
];

export class Missions {
  constructor() {
    const s = storage.get(KEY, {});
    this.xp = s.xp || 0;
    this.done = new Set(s.done || []);
    this.progress = s.progress || {};
    this.onComplete = null; // (Auftrag)
    this.onRank = null; // (Rang-Index, Rang)
    this.onChange = null; // Anzeige neu zeichnen
    this._dirty = false;
  }

  get rankIndex() {
    let r = 0;
    RANKS.forEach((k, i) => {
      if (this.xp >= k.xp) r = i;
    });
    return r;
  }

  get rank() {
    return RANKS[this.rankIndex];
  }

  /** Fortschritt zum nächsten Rang (0..1) und XP-Grenzen */
  rankProgress() {
    const i = this.rankIndex;
    const cur = RANKS[i];
    const next = RANKS[i + 1];
    if (!next) return { k: 1, cur, next: null };
    return { k: (this.xp - cur.xp) / (next.xp - cur.xp), cur, next };
  }

  /** Die offenen Aufträge (die ersten 3 nicht erledigten) */
  get active() {
    return MISSIONS.filter((m) => !this.done.has(m.id)).slice(0, ACTIVE);
  }

  get doneCount() {
    return this.done.size;
  }

  addXp(n) {
    const before = this.rankIndex;
    this.xp += n;
    const after = this.rankIndex;
    if (after > before) this.onRank?.(after, RANKS[after]);
    this._dirty = true;
  }

  /** Ereignis melden: id eines Auftrags (event) oder Zähler (count) mit Menge */
  report(id, amount = 1) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m || this.done.has(id)) return;
    // nur offene Aufträge zählen (sonst wären spätere schon fertig, bevor man sie sieht)
    if (!this.active.includes(m)) return;
    if (m.type === 'count') {
      this.progress[id] = Math.min(m.goal, (this.progress[id] || 0) + amount);
      if (this.progress[id] >= m.goal) this._complete(m);
      else this.onChange?.();
    } else this._complete(m);
    this._dirty = true;
  }

  /** Zähler auf einen festen Wert setzen (z. B. gefundene Ziegen) */
  set(id, value) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m || this.done.has(id) || !this.active.includes(m)) return;
    if ((this.progress[id] || 0) === value) return;
    this.progress[id] = Math.min(m.goal, value);
    if (this.progress[id] >= m.goal) this._complete(m);
    else this.onChange?.();
    this._dirty = true;
  }

  _complete(m) {
    this.done.add(m.id);
    this.onComplete?.(m);
    this.addXp(m.xp);
    this.onChange?.();
  }

  resetAll() {
    this.xp = 0;
    this.done.clear();
    this.progress = {};
    this._dirty = true;
    this.save();
    this.onChange?.();
  }

  save() {
    if (!this._dirty) return;
    this._dirty = false;
    storage.set(KEY, { xp: Math.round(this.xp), done: [...this.done], progress: this.progress });
  }
}
