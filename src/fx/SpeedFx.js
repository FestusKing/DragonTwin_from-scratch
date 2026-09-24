// Tempo-Effekte (damit sich Geschwindigkeit "krass" anfühlt):
//  1) Kondensstreifen an den Flügelspitzen – bei hohem Tempo und in engen Kurven (wie bei Kampfjets)
//  2) Dampfkegel um den Drachen, wenn er extrem schnell ist (Sturzflug)
//  3) "Schallmauer": beim ersten Mal über SONIC m/s eine Druckwelle + Knall (Ton macht Game.js)
//  4) Druckwellen-Ringe für andere Ereignisse (Landung, Brüllen, Flügelschlag am Boden): shock()
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/utils.js';

const TRAIL_N = 56; // Punkte pro Streifen
const TRAIL_LIFE = 0.9; // so lange bleibt ein Streifen sichtbar (Sekunden)
const SONIC = 110; // m/s: ab hier "Schallmauer" (Knall) – mit langem Sturzflug erreichbar
const SONIC_RESET = 92; // erst wieder darunter kann es erneut knallen

const _d = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

function vaporMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Ein weisser Streifen hinter einer Flügelspitze (Band aus Dreiecken, zeigt immer zur Kamera). */
class Trail {
  constructor(scene, mat) {
    this.pts = []; // { p, age, k }
    this.pos = new Float32Array(TRAIL_N * 2 * 3);
    this.col = new Float32Array(TRAIL_N * 2 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < TRAIL_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(dt, tip, k, camPos) {
    const pts = this.pts;
    for (const q of pts) q.age += dt;
    while (pts.length && pts[0].age > TRAIL_LIFE) pts.shift();
    // grosser Sprung (Neustart, Teleport): alten Streifen verwerfen
    if (pts.length && pts[pts.length - 1].p.distanceToSquared(tip) > 900) pts.length = 0;
    const last = pts[pts.length - 1];
    if (k > 0.02 && (!last || last.p.distanceToSquared(tip) > 0.09)) {
      pts.push({ p: tip.clone(), age: 0, k });
      if (pts.length > TRAIL_N) pts.shift();
    } else if (last && k > 0.02) {
      last.p.copy(tip); // Spitze mitführen, damit der Streifen am Flügel "klebt"
    }
    const n = pts.length;
    if (n < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < n; i++) {
      const q = pts[i];
      const a = pts[Math.max(0, i - 1)].p;
      const b = pts[Math.min(n - 1, i + 1)].p;
      _d.subVectors(b, a);
      _toCam.subVectors(camPos, q.p);
      _side.crossVectors(_d, _toCam);
      if (_side.lengthSq() < 1e-8) _side.crossVectors(_d, _up);
      const w = 0.05 + q.age * 0.28; // wird nach hinten breiter (verwirbelt)
      _side.normalize().multiplyScalar(w);
      const life = 1 - q.age / TRAIL_LIFE;
      const young = smoothstep(0, 0.06, q.age); // weicher Anfang direkt an der Spitze
      const near = smoothstep(5, 22, _toCam.length()); // nahe an der Kamera ausblenden (sonst breite Bänder)
      const alpha = q.k * life * life * young * near * 0.6;
      const o = i * 6;
      this.pos[o] = q.p.x + _side.x;
      this.pos[o + 1] = q.p.y + _side.y;
      this.pos[o + 2] = q.p.z + _side.z;
      this.pos[o + 3] = q.p.x - _side.x;
      this.pos[o + 4] = q.p.y - _side.y;
      this.pos[o + 5] = q.p.z - _side.z;
      const c = i * 8;
      this.col.fill(1, c, c + 8);
      this.col[c + 3] = alpha;
      this.col[c + 7] = alpha;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (n - 1) * 6);
  }

  clear() {
    this.pts.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}

export class SpeedFx {
  constructor(scene) {
    this.mat = vaporMaterial();
    this.trails = [new Trail(scene, this.mat), new Trail(scene, this.mat)];

    // Dampfkegel: Spitze nach vorne, in der Mitte am dichtesten
    const cone = new THREE.ConeGeometry(1, 1, 40, 8, true);
    const cp = cone.attributes.position;
    const cc = new Float32Array(cp.count * 4);
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i) + 0.5; // 0 = hinten (Rand), 1 = Spitze
      const a = Math.pow(Math.sin(Math.PI * clamp(1 - y, 0, 1)), 2) * (0.6 + 0.4 * Math.random());
      cc.set([1, 1, 1, a], i * 4);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(cc, 4));
    this.coneMat = vaporMaterial();
    this.cone = new THREE.Mesh(cone, this.coneMat);
    this.cone.frustumCulled = false;
    this.cone.visible = false;
    this.cone.renderOrder = 6;
    scene.add(this.cone);

    // Druckwellen (Ringe): Knall, Landung, Brüllen, Flügelschlag am Boden
    const ringGeo = new THREE.RingGeometry(0.82, 1, 64);
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.rings.push({ mesh, mat, age: 99, dur: 1, r0: 1, r1: 10, op: 0.5 });
    }
    this.nextRing = 0;

    this.supersonic = false;
    this.time = 0;
    this.onBoom = null; // (Position) → Ton, Kamera usw.
  }

  /**
   * Druckwelle: Ring bei pos, senkrecht zu normal, wächst von r0 auf r1 Meter in dur Sekunden.
   * color: Hex-Farbe (Staub braun, Luft weiss)
   */
  shock(pos, normal, { r0 = 2, r1 = 30, dur = 0.7, opacity = 0.45, color = 0xffffff } = {}) {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    r.mesh.position.copy(pos);
    r.mesh.quaternion.setFromUnitVectors(_z, _d.copy(normal).normalize());
    r.mat.color.set(color);
    Object.assign(r, { age: 0, dur, r0, r1, op: opacity });
  }

  /**
   * s = { tipR, tipL, speed, turnG, boost, pos, vel, camPos, active }
   *   turnG = Kurvenkraft in g, active = fliegt (nicht am Boden, nicht im Menü)
   */
  update(dt, s) {
    this.time += dt;
    const fast = clamp((s.speed - 60) / 40, 0, 1) * 0.7;
    const turn = clamp((s.turnG - 2.2) / 2.5, 0, 1);
    const k = s.active ? clamp(Math.max(fast, turn) + (s.boost ? 0.25 : 0), 0, 1) : 0;
    this.trails[0].update(dt, s.tipR, k, s.camPos);
    this.trails[1].update(dt, s.tipL, k, s.camPos);

    // Dampfkegel ab ca. 100 m/s
    const ck = s.active ? clamp((s.speed - 98) / 16, 0, 1) : 0;
    this.cone.visible = ck > 0.01;
    if (this.cone.visible) {
      _d.copy(s.vel).normalize();
      this.cone.quaternion.setFromUnitVectors(_up, _d);
      this.cone.position.copy(s.pos).addScaledVector(_d, 1.5);
      this.cone.scale.set(10, 16, 10);
      this.coneMat.opacity = ck * (0.35 + 0.12 * Math.sin(this.time * 47) + 0.08 * Math.sin(this.time * 23));
    }

    // Schallmauer
    if (s.active && !this.supersonic && s.speed > SONIC) {
      this.supersonic = true;
      this.shock(s.pos, s.vel, { r0: 3, r1: 73, dur: 0.8, opacity: 0.55 });
      this.onBoom?.(s.pos);
    } else if (this.supersonic && (s.speed < SONIC_RESET || !s.active)) {
      this.supersonic = false;
    }
    for (const r of this.rings) {
      r.age += dt;
      const t = r.age / r.dur;
      r.mesh.visible = t < 1;
      if (!r.mesh.visible) continue;
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - t, 3)));
      r.mat.opacity = r.op * (1 - t) * (1 - t);
    }
  }

  clear() {
    for (const t of this.trails) t.clear();
    this.cone.visible = false;
    for (const r of this.rings) {
      r.age = 99;
      r.mesh.visible = false;
    }
    this.supersonic = false;
  }
}
