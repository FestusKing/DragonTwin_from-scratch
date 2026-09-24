// Geist-Wiederholung: Wir speichern 20× pro Sekunde Position, Drehung und
// Flügelschlag. Beim nächsten Rennen fliegt ein durchsichtiger Drache genau
// diese Bahn nach – so kannst du gegen deine Bestzeit antreten.
import * as THREE from 'three';
import { storage } from '../core/utils.js';

const RATE = 20; // Aufnahmen pro Sekunde
const STRIDE = 10; // Zahlen pro Aufnahme: x y z qx qy qz qw phase amp fold
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export class GhostRecorder {
  constructor() {
    this.data = [];
    this.acc = 0;
    this.time = 0;
  }

  reset() {
    this.data = [];
    this.acc = 0;
    this.time = 0;
  }

  record(dt, physics) {
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / RATE && this.data.length) return;
    this.acc = 0;
    const p = physics.position;
    const q = physics.quaternion;
    const r2 = (v) => Math.round(v * 100) / 100;
    const r4 = (v) => Math.round(v * 10000) / 10000;
    this.data.push(r2(p.x), r2(p.y), r2(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w), r2(physics.flapPhase), r2(physics.flapAmp), r2(physics.fold));
  }
}

export class GhostPlayer {
  constructor(data) {
    this.data = data;
    this.frames = Math.floor(data.length / STRIDE);
    this.duration = (this.frames - 1) / RATE;
  }

  /** Zustand zur Zeit t (Sekunden seit Start), zwischen zwei Aufnahmen interpoliert */
  sample(t, outPos, outQuat, anim) {
    const d = this.data;
    const f = Math.max(0, Math.min(this.frames - 1.001, t * RATE));
    const i = Math.floor(f);
    const k = f - i;
    const a = i * STRIDE;
    const b = (i + 1) * STRIDE;
    outPos.set(d[a] + (d[b] - d[a]) * k, d[a + 1] + (d[b + 1] - d[a + 1]) * k, d[a + 2] + (d[b + 2] - d[a + 2]) * k);
    _qa.set(d[a + 3], d[a + 4], d[a + 5], d[a + 6]);
    _qb.set(d[b + 3], d[b + 4], d[b + 5], d[b + 6]);
    outQuat.slerpQuaternions(_qa, _qb, k);
    // Flügelphase kann von 0.99 auf 0.01 springen → sauber interpolieren
    let pa = d[a + 7];
    let pb = d[b + 7];
    if (pb < pa - 0.5) pb += 1;
    anim.flapPhase = (pa + (pb - pa) * k) % 1;
    anim.flapAmp = d[a + 8] + (d[b + 8] - d[a + 8]) * k;
    anim.fold = d[a + 9] + (d[b + 9] - d[a + 9]) * k;
    return t <= this.duration;
  }
}

const key = (course) => `dragontwin.race.${course}.v1`;

export function loadRecord(course) {
  return storage.get(key(course), null);
}

export function saveRecord(course, rec) {
  if (!storage.set(key(course), rec)) {
    // Speicher voll? Dann wenigstens die Zeit ohne Geist speichern
    storage.set(key(course), { ...rec, ghost: null });
  }
}

export function clearRecords(courses) {
  for (const c of courses) storage.remove(key(c));
}
