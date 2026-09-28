// Trümmer: Wandstücke, Bretter, Dachstücke und Steine fliegen beim Einsturz weg,
// prallen am Boden ab, kippen flach hin und bleiben eine Weile als Schutt liegen.
// Einfache Physik ohne Bibliothek: Schwerkraft, Abprallen, Reibung, Drehung.
// Alle Stücke einer Sorte sind EIN InstancedMesh (wenige Draw-Calls).
// Jedes Stück hat einen festen Platz (Slot) im InstancedMesh → liegende Stücke
// müssen nicht jedes Bild neu geschrieben werden.
import * as THREE from 'three';
import { surfaceMaterial } from './Textures.js';
import { box } from '../world/BuildingGeo.js';

const LIFE = 75; // so lange bleibt Schutt liegen (s), danach versinkt er langsam
const SINK = 8; // Sekunden fürs Versinken
const G = 9.81;

// Sorten: Grösse (x, y, z in Metern), Material, wie viele höchstens gleichzeitig
const KINDS = {
  wall: { size: [1.5, 1.2, 0.32], mat: ['fachwerk', { roughness: 0.92 }, { roughness: 1 }], max: 320 },
  plank: { size: [0.26, 0.26, 2.6], mat: ['holz', { roughness: 0.9 }, { roughness: 1 }], max: 360 },
  thatch: { size: [1.7, 0.16, 1.3], mat: ['stroh', { roughness: 0.95 }, { avgColor: 0x8c7856 }], max: 240 },
  tiles: { size: [1.6, 0.14, 1.2], mat: ['schiefer', { roughness: 0.95 }, { avgColor: 0x7c5446 }], max: 200 },
  stone: { size: [0.8, 0.55, 0.7], mat: ['stein', { roughness: 0.92 }, { roughness: 1 }], max: 180 },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _c = new THREE.Color();
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

class Pool {
  constructor(scene, name, def) {
    this.def = def;
    this.max = def.max;
    const [sx, sy, sz] = def.size;
    const mat = surfaceMaterial(...def.mat);
    this.mesh = new THREE.InstancedMesh(box(sx, sy, sz, 2), mat, this.max);
    this.mesh.name = 'Truemmer_' + name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // Stücke liegen verstreut → Begrenzung wäre falsch
    this.mesh.count = 0;
    for (let i = 0; i < this.max; i++) {
      this.mesh.setMatrixAt(i, _zero);
      this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    scene.add(this.mesh);
    this.pieces = [];
    for (let i = 0; i < this.max; i++) {
      this.pieces.push({
        on: false,
        i,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        spin: new THREE.Vector3(),
        scale: new THREE.Vector3(1, 1, 1),
        age: 0,
        rest: 0, // 0 = fliegt/rutscht, 1 = legt sich hin, 2 = liegt still
        half: 0.2,
      });
    }
    this.free = [];
    for (let i = this.max - 1; i >= 0; i--) this.free.push(i);
    this.active = [];
    this.high = 0; // höchster benutzter Slot + 1
    this.dirty = false;
  }

  take() {
    let p;
    if (this.free.length) p = this.pieces[this.free.pop()];
    else {
      // voll: das älteste Stück wiederverwenden
      let oldest = null;
      for (const q of this.active) if (!oldest || q.age > oldest.age) oldest = q;
      p = oldest;
      this.active.splice(this.active.indexOf(p), 1);
    }
    p.on = true;
    p.age = 0;
    p.rest = 0;
    this.active.push(p);
    this.high = Math.max(this.high, p.i + 1);
    this.mesh.count = this.high;
    return p;
  }

  release(p) {
    p.on = false;
    this.mesh.setMatrixAt(p.i, _zero);
    this.free.push(p.i);
    this.dirty = true;
  }
}

export class Debris {
  constructor(scene, terrain) {
    this.terrain = terrain;
    this.pools = {};
    for (const [name, def] of Object.entries(KINDS)) this.pools[name] = new Pool(scene, name, def);
  }

  /**
   * Ein Stück losschicken.
   * kind: 'wall' | 'plank' | 'thatch' | 'tiles' | 'stone'
   * tint: Helligkeit (1 = normal, 0.2 = verkohlt), size: Grössenfaktor
   */
  spawn(kind, pos, vel, { tint = 1, size = 1, spin = 6 } = {}) {
    const pool = this.pools[kind];
    if (!pool) return;
    const p = pool.take();
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.quat.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(spin * (0.4 + Math.random() * 0.8));
    // jedes Stück etwas anders gross (sieht zufälliger aus)
    const k = size * (0.65 + Math.random() * 0.6);
    p.scale.set(k * (0.7 + Math.random() * 0.6), k * (0.8 + Math.random() * 0.4), k * (0.7 + Math.random() * 0.6));
    const [sx, sy, sz] = pool.def.size;
    p.ext = [sx * p.scale.x * 0.5, sy * p.scale.y * 0.5, sz * p.scale.z * 0.5];
    p.half = Math.min(...p.ext);
    // Farbe: verkohlt oder normal, mit etwas Zufall
    const t = tint * (0.85 + Math.random() * 0.3);
    pool.mesh.setColorAt(p.i, _c.setRGB(t, t * 0.96, t * 0.92));
    pool.mesh.instanceColor.needsUpdate = true;
    this._write(pool, p);
  }

  _write(pool, p) {
    _s.copy(p.scale);
    if (p.age > LIFE) _s.multiplyScalar(Math.max(0.01, 1 - (p.age - LIFE) / SINK));
    _m.compose(p.pos, p.quat, _s);
    pool.mesh.setMatrixAt(p.i, _m);
    pool.dirty = true;
  }

  /** Alle Trümmer weg (Neustart) */
  clear() {
    for (const pool of Object.values(this.pools)) {
      for (const p of pool.active) pool.release(p);
      pool.active.length = 0;
      pool.high = 0;
      pool.mesh.count = 0;
      pool.free.length = 0;
      for (let i = pool.max - 1; i >= 0; i--) pool.free.push(i);
    }
  }

  get count() {
    let n = 0;
    for (const pool of Object.values(this.pools)) n += pool.active.length;
    return n;
  }

  update(dt) {
    if (dt <= 0) return;
    const t = this.terrain;
    for (const pool of Object.values(this.pools)) {
      const act = pool.active;
      for (let k = act.length - 1; k >= 0; k--) {
        const p = act[k];
        p.age += dt;
        if (p.age > LIFE + SINK) {
          act.splice(k, 1);
          pool.release(p);
          continue;
        }
        if (p.rest === 2) {
          if (p.age > LIFE) {
            p.pos.y -= dt * 0.15;
            this._write(pool, p);
          }
          continue;
        }
        const ground = Math.max(t.heightAt(p.pos.x, p.pos.z), -1.5);
        if (p.rest === 0) {
          // fliegen: Schwerkraft, etwas Luftwiderstand, drehen
          p.vel.y -= G * dt;
          p.vel.multiplyScalar(1 - Math.min(1, dt * 0.08));
          p.pos.addScaledVector(p.vel, dt);
          const w = p.spin.length();
          if (w > 1e-3) {
            _q.setFromAxisAngle(_ax.copy(p.spin).divideScalar(w), w * dt);
            p.quat.premultiply(_q);
          }
          const r = p.half + 0.05;
          if (p.pos.y < ground + r) {
            p.pos.y = ground + r;
            if (p.vel.y < -2.2) {
              // abprallen: verliert viel Tempo, dreht wild weiter
              p.vel.y *= -0.3;
              p.vel.x *= 0.55;
              p.vel.z *= 0.55;
              p.spin.multiplyScalar(0.6);
              p.spin.x += (Math.random() - 0.5) * 3;
              p.spin.z += (Math.random() - 0.5) * 3;
            } else {
              // rutschen, bis es liegen bleibt
              p.vel.y = 0;
              const f = Math.max(0, 1 - dt * 7);
              p.vel.x *= f;
              p.vel.z *= f;
              p.spin.multiplyScalar(f);
              if (p.vel.x * p.vel.x + p.vel.z * p.vel.z < 0.15) this._settle(p);
            }
          }
        } else {
          // hinlegen: auf die flachste Seite kippen (sieht natürlicher aus als auf einer Kante)
          p.settleT += dt;
          p.quat.slerp(p.target, Math.min(1, dt * 7));
          p.pos.y += (ground + p.restH - p.pos.y) * Math.min(1, dt * 8);
          if (p.settleT > 0.8) {
            p.quat.copy(p.target);
            p.pos.y = ground + p.restH;
            p.rest = 2;
          }
        }
        this._write(pool, p);
      }
      if (pool.dirty) {
        pool.mesh.instanceMatrix.needsUpdate = true;
        pool.dirty = false;
      }
    }
  }

  /**
   * Zielrichtung zum Hinlegen: die dünnste Achse zeigt nach oben (flach liegen).
   * Sind zwei Achsen fast gleich dünn (Balken), die, die schon eher nach oben zeigt.
   */
  _settle(p) {
    const thin = Math.min(...p.ext);
    let best = 0;
    let bestDot = -1;
    for (let a = 0; a < 3; a++) {
      if (p.ext[a] > thin * 1.5) continue;
      const d = Math.abs(_v.copy(AXES[a]).applyQuaternion(p.quat).y);
      if (d > bestDot) {
        bestDot = d;
        best = a;
      }
    }
    _v.copy(AXES[best]).applyQuaternion(p.quat);
    if (_v.y < 0) _v.negate();
    _q2.setFromUnitVectors(_v, _up);
    p.target = (p.target || new THREE.Quaternion()).copy(_q2).multiply(p.quat);
    p.restH = p.ext[best];
    p.settleT = 0;
    p.rest = 1;
    p.vel.set(0, 0, 0);
  }
}
