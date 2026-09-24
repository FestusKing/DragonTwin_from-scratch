// Ein Drachenflügel wie bei einer Fledermaus:
//   Schulter → Oberarm → Ellbogen → Unterarm → Handgelenk → 4 lange Finger.
// Die Flughaut spannt sich zwischen Fingern, Arm und Körper.
// Jedes Bild berechnen wir die Gelenk-Positionen neu ("Vorwärts-Kinematik")
// und verschieben dann die Eckpunkte der Flughaut.
import * as THREE from 'three';
import { lerp, smoothstep } from '../core/utils.js';

const L_HUM = 4.2;
const L_FORE = 5.2;
const FINGER_LEN = [7.6, 7.0, 5.9, 4.6];
// Winkel (von +x Richtung +z = nach hinten) für gespreizt / angelegt
const SPREAD = { a1: -0.22, bend: 0.38, fingers: [-0.22, 0.38, 0.98, 1.58] };
// Angelegt: Oberarm zeigt nach hinten, Unterarm klappt nach VORNE (wie ein Scharnier),
// die Finger liegen nach hinten am Körper an. So kreuzt nichts den Körper.
const FOLDED = { a1: 1.2, bend: -2.8, fingers: [3.05, 3.1, 3.15, 3.2] };
const SCALLOP = 3; // Zwischenpunkte der gewellten Hinterkante pro Fingerpaar
const INNER_SCALLOP = 5;

export class Wing {
  constructor(membraneMat, boneMat, clawMat) {
    this.group = new THREE.Group();
    // Punkte-Indizes
    this.P = {};
    let n = 0;
    const P = this.P;
    P.S = n++;
    P.E = n++;
    P.W = n++;
    P.F = [n++, n++, n++, n++];
    P.K = [n++, n++, n++, n++]; // Knöchel (auf den Fingern)
    P.B = n++;
    P.sc = [];
    for (let k = 0; k < 3; k++) {
      const arr = [];
      for (let j = 0; j < SCALLOP; j++) arr.push(n++);
      P.sc.push(arr);
    }
    P.inner = [];
    for (let j = 0; j < INNER_SCALLOP; j++) P.inner.push(n++);
    P.M = n++;
    this.count = n;
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());

    // Dreiecke der Flughaut
    const idx = [];
    const tri = (a, b, c) => idx.push(a, b, c);
    for (let k = 0; k < 3; k++) {
      const Ka = P.K[k];
      const Kb = P.K[k + 1];
      const edge = [P.F[k], ...P.sc[k], P.F[k + 1]];
      tri(P.W, Ka, Kb);
      const mid = Math.floor(edge.length / 2);
      for (let j = 0; j < mid; j++) tri(Ka, edge[j], edge[j + 1]);
      tri(Ka, edge[mid], Kb);
      for (let j = mid; j < edge.length - 1; j++) tri(Kb, edge[j], edge[j + 1]);
    }
    // innere Fläche als Fächer um den Mittelpunkt M
    const loop = [P.S, P.E, P.W, P.K[3], P.F[3], ...P.inner, P.B];
    for (let j = 0; j < loop.length; j++) tri(P.M, loop[j], loop[(j + 1) % loop.length]);
    this.index = idx;

    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setIndex(idx);
    this.geometry = g;
    this.membrane = new THREE.Mesh(g, membraneMat);
    this.membrane.frustumCulled = false;
    this.membrane.castShadow = true;
    this.membrane.receiveShadow = true;
    this.group.add(this.membrane);

    // Knochen als Zylinder
    const seg = (rTop, rBottom) => {
      const cg = new THREE.CylinderGeometry(rTop, rBottom, 1, 7, 1);
      cg.translate(0, 0.5, 0);
      const m = new THREE.Mesh(cg, boneMat);
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.bones = [
      { m: seg(0.24, 0.34), a: P.S, b: P.E },
      { m: seg(0.15, 0.24), a: P.E, b: P.W },
    ];
    for (let k = 0; k < 4; k++) this.bones.push({ m: seg(0.04, 0.13), a: P.W, b: P.F[k] });
    // Daumenkralle am Handgelenk
    const cg = new THREE.ConeGeometry(0.2, 1.3, 5);
    cg.translate(0, 0.65, 0);
    this.thumb = new THREE.Mesh(cg, clawMat);
    this.thumb.castShadow = true;
    this.group.add(this.thumb);
    const jointGeo = new THREE.SphereGeometry(0.3, 8, 6);
    this.elbow = new THREE.Mesh(jointGeo, boneMat);
    this.wrist = new THREE.Mesh(jointGeo, boneMat);
    this.wrist.scale.setScalar(0.75);
    this.group.add(this.elbow, this.wrist);

    this._up = new THREE.Vector3(0, 1, 0);
    this._d = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this.pose({ fold: 0, t1: 0, t2: 0, t3: 0, sweep: 0 });
    // Texturkoordinaten einmal aus der gespreizten Form (Draufsicht) berechnen
    const uvArr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uvArr[i * 2] = this.pts[i].x / 7;
      uvArr[i * 2 + 1] = this.pts[i].z / 7;
    }
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    // Einmalig prüfen, ob die Dreiecke nach oben zeigen, sonst umdrehen
    this.geometry.computeVertexNormals();
    const nrm = this.geometry.getAttribute('normal');
    let sy = 0;
    for (let i = 0; i < nrm.count; i++) sy += nrm.getY(i);
    if (sy < 0) {
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
      }
      this.geometry.setIndex(idx);
      this.geometry.computeVertexNormals();
    }
  }

  /**
   * Flügel-Pose berechnen.
   * fold: 0 gespreizt … 1 angelegt
   * t1/t2/t3: Hochklapp-Winkel an Schulter / Ellbogen / Handgelenk (Radiant)
   * sweep: Arm nach hinten schwenken
   */
  pose({ fold, t1, t2, t3, sweep }) {
    const f = smoothstep(0, 1, fold);
    const P = this.P;
    const p = this.pts;
    // 1) Grundriss (von oben gesehen, y = 0)
    const a1 = lerp(SPREAD.a1, FOLDED.a1, f) + sweep;
    const a2 = a1 + lerp(SPREAD.bend, FOLDED.bend, f);
    p[P.S].set(0, 0, 0);
    p[P.E].set(Math.cos(a1) * L_HUM, 0, Math.sin(a1) * L_HUM);
    p[P.W].set(p[P.E].x + Math.cos(a2) * L_FORE, 0, p[P.E].z + Math.sin(a2) * L_FORE);
    const lenF = lerp(1, 0.92, f);
    for (let k = 0; k < 4; k++) {
      const a = a2 + lerp(SPREAD.fingers[k], FOLDED.fingers[k], f);
      const L = FINGER_LEN[k] * lenF;
      p[P.F[k]].set(p[P.W].x + Math.cos(a) * L, 0, p[P.W].z + Math.sin(a) * L);
    }
    p[P.B].set(lerp(-0.25, -0.3, f), lerp(-0.25, -0.1, f), lerp(5.6, 4.6, f));

    // 2) Hochklappen: Drehung um Achsen parallel zur Körperlängsachse (z)
    const rot = (v, pivot, ang) => {
      const x = v.x - pivot.x;
      const y = v.y - pivot.y;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      v.x = pivot.x + x * c - y * s;
      v.y = pivot.y + x * s + y * c;
    };
    const S = p[P.S];
    rot(p[P.E], S, t1);
    rot(p[P.W], S, t1);
    for (let k = 0; k < 4; k++) rot(p[P.F[k]], S, t1);
    const E = p[P.E];
    rot(p[P.W], E, t2);
    for (let k = 0; k < 4; k++) rot(p[P.F[k]], E, t2);
    const W = p[P.W];
    for (let k = 0; k < 4; k++) rot(p[P.F[k]], W, t3);

    // 3) abgeleitete Punkte: Knöchel, gewellte Hinterkante, Mittelpunkt
    for (let k = 0; k < 4; k++) p[P.K[k]].lerpVectors(W, p[P.F[k]], 0.55);
    const scallop = (A, C, arr, depth) => {
      const n = arr.length;
      for (let j = 0; j < n; j++) {
        const t = (j + 1) / (n + 1);
        const v = p[arr[j]].lerpVectors(A, C, t);
        const d = A.distanceTo(C) * depth * Math.sin(Math.PI * t);
        this._d.subVectors(W, v).normalize();
        v.addScaledVector(this._d, d);
      }
    };
    for (let k = 0; k < 3; k++) scallop(p[P.F[k]], p[P.F[k + 1]], P.sc[k], 0.16);
    scallop(p[P.F[3]], p[P.B], P.inner, 0.1);
    p[P.M].copy(E).add(W).add(p[P.K[3]]).add(p[P.B]).multiplyScalar(0.25);

    // 4) in den Buffer schreiben
    const arr = this.posAttr.array;
    for (let i = 0; i < this.count; i++) {
      arr[i * 3] = p[i].x;
      arr[i * 3 + 1] = p[i].y;
      arr[i * 3 + 2] = p[i].z;
    }
    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();

    // 5) Knochen ausrichten
    for (const b of this.bones) {
      const A = p[b.a];
      const Bp = p[b.b];
      this._d.subVectors(Bp, A);
      const len = this._d.length();
      b.m.position.copy(A);
      b.m.quaternion.setFromUnitVectors(this._up, this._d.divideScalar(len || 1));
      b.m.scale.set(1, len, 1);
    }
    this.elbow.position.copy(E);
    this.wrist.position.copy(W);
    // Daumen zeigt nach vorne
    this.thumb.position.copy(W);
    this._t.subVectors(W, E).normalize();
    this._d.set(this._t.x * 0.5, 0.2, -1).normalize();
    this.thumb.quaternion.setFromUnitVectors(this._up, this._d);
  }
}
