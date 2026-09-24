// Brand-System: Bäume, Hütten, Heuballen, Wachtürme … können Feuer fangen.
// Jedes brennbare Objekt sammelt "Hitze". Ist genug Hitze da → es brennt.
// Brennende Objekte geben Hitze an Nachbarn weiter (Feuer breitet sich aus),
// Regen löscht schneller. Die 3 nächsten Feuer bekommen ein echtes Licht.
import * as THREE from 'three';
import { clamp } from '../core/utils.js';

const CELL = 30;
const MAX_BURNING = 70;
const _p = new THREE.Vector3();

export class BurnSystem {
  constructor(scene, particles, terrain, vegetation, settlement, quality = 1) {
    this.particles = particles;
    this.terrain = terrain;
    this.vegetation = vegetation;
    this.q = quality;
    this.entities = [];
    this.grid = new Map();
    this.burning = [];
    this.smoldering = [];
    this.warm = new Set();
    this.burntCount = 0;
    this.spreadTimer = 0;
    this.onIgnite = null;

    for (const tree of vegetation.trees) {
      this._add({
        kind: 'tree',
        x: tree.x,
        y: tree.y + tree.height * 0.55,
        z: tree.z,
        r: 3.2 * tree.s,
        h: tree.height,
        w: 5 * tree.s,
        d: 5 * tree.s,
        fuel: 9 + Math.random() * 5,
        onProgress: (t) => vegetation.setBurning(tree, t),
        onBurnt: () => vegetation.setBurnt(tree),
        onReset: null,
      });
    }
    for (const f of settlement.flammables) this._add({ ...f });

    // Licht-Pool für die nächsten Feuer
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff8a30, 0, 160, 2);
      scene.add(l);
      this.lights.push(l);
    }
    this.stats = { nearby: 0, nearest: 9999, count: 0 };
  }

  _add(e) {
    e.heat = 0;
    e.state = 0; // 0 = intakt, 1 = brennt, 2 = abgebrannt
    e.t = 0;
    e.acc = 0;
    e.smokeAcc = 0;
    e.smolder = 0;
    e.id = this.entities.length;
    this.entities.push(e);
    const x0 = Math.floor((e.x - e.r) / CELL);
    const x1 = Math.floor((e.x + e.r) / CELL);
    const z0 = Math.floor((e.z - e.r) / CELL);
    const z1 = Math.floor((e.z + e.r) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i * 100003 + j;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(e);
      }
    }
  }

  _query(x, z, r, fn) {
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const list = this.grid.get(i * 100003 + j);
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          fn(e);
        }
      }
    }
  }

  /** Hitze an einem Punkt verteilen (Feuerstrahl, Blitz, Ausbreitung) */
  applyHeat(p, radius, amount, cb) {
    this._query(p.x, p.z, radius + 8, (e) => {
      if (e.state !== 0) return;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const dh = Math.hypot(dx, dz);
      const dy = Math.max(0, Math.abs(p.y - e.y) - e.h * 0.5);
      const reach = radius + e.r;
      if (dh > reach || dy > radius + 2) return;
      e.heat += amount * (1 - (dh / reach) * 0.5);
      this.warm.add(e);
      if (e.heat >= 1) this.ignite(e, cb);
    });
  }

  ignite(e, cb) {
    if (e.state !== 0 || this.burning.length >= MAX_BURNING) return false;
    e.state = 1;
    e.t = 0;
    this.burning.push(e);
    this.warm.delete(e);
    (cb || this.onIgnite)?.(e);
    return true;
  }

  /** Blitz: den nächsten Baum in der Nähe anzünden */
  igniteNear(p, radius) {
    let best = null;
    let bd = radius;
    this._query(p.x, p.z, radius, (e) => {
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (e.state === 0 && d < bd) {
        bd = d;
        best = e;
      }
    });
    if (best) this.ignite(best);
    return best;
  }

  update(dt, camPos, rain, wind, fireColor) {
    // Hitze kühlt wieder ab, wenn man aufhört
    for (const e of this.warm) {
      e.heat -= dt * 0.25;
      if (e.heat <= 0) {
        e.heat = 0;
        this.warm.delete(e);
      }
    }

    const fire = this.particles.fire;
    const smoke = this.particles.smoke;
    const sparks = this.particles.sparks;
    let nearby = 0;
    let nearest = 9999;
    this.spreadTimer -= dt;
    const doSpread = this.spreadTimer <= 0;
    if (doSpread) this.spreadTimer = 1;

    for (let i = this.burning.length - 1; i >= 0; i--) {
      const e = this.burning[i];
      e.t += dt * (1 + rain * 2.5);
      const prog = e.t / e.fuel;
      e.onProgress?.(Math.min(1, prog));
      // Feuer-Stärke: schnell an, lange voll, dann abnehmend
      const I = clamp(prog / 0.12, 0, 1) * (1 - clamp((prog - 0.7) / 0.3, 0, 1));
      e.intensity = I;
      const d = Math.hypot(camPos.x - e.x, camPos.z - e.z);
      if (d < nearest) nearest = d;
      if (d < 350) nearby += (1 - d / 350) * I * (e.kind === 'tree' ? 0.4 : 1);
      const lod = d < 700 ? 1 : d < 1500 ? 0.35 : 0.1;
      const size = e.kind === 'hut' || e.kind === 'windmill' ? 1.6 : e.kind === 'tower' ? 1.3 : e.kind === 'tree' ? 1 : 0.8;
      // Flammen
      e.acc += 58 * size * I * lod * this.q * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        this._randomPoint(e, _p);
        fire.spawn(
          _p.x, _p.y, _p.z,
          (Math.random() - 0.5) * 2.5, 4 + Math.random() * 8, (Math.random() - 0.5) * 2.5,
          0.7 + Math.random() * 0.8, 1.3 * size, (3 + Math.random() * 4) * size
        );
      }
      // Rauch
      e.smokeAcc += 7 * size * (0.3 + I) * lod * this.q * dt;
      while (e.smokeAcc >= 1) {
        e.smokeAcc -= 1;
        this._randomPoint(e, _p);
        smoke.spawn(_p.x, _p.y + e.h * 0.4, _p.z, 0, 4 + Math.random() * 3, 0, 4.5 + Math.random() * 3, 3 * size, (12 + Math.random() * 10) * size);
      }
      // Funken
      if (Math.random() < 6 * dt * I * lod) {
        this._randomPoint(e, _p);
        for (let k = 0; k < 4; k++) sparks.spawn(_p.x, _p.y, _p.z, (Math.random() - 0.5) * 6, 6 + Math.random() * 8, (Math.random() - 0.5) * 6, 1 + Math.random(), 0.35, 0.1);
      }
      // Ausbreitung auf Nachbarn
      if (doSpread && prog > 0.15 && prog < 0.85 && rain < 0.5) {
        const r = e.kind === 'tree' ? 12 : 20;
        _p.set(e.x, e.y, e.z);
        this.applyHeat(_p, r, (0.3 + Math.random() * 0.25) * (1 - rain * 2) * (1 + (wind || 0) * 0.5));
      }
      if (prog >= 1) {
        e.state = 2;
        e.onBurnt?.();
        e.smolder = 25;
        this.burning.splice(i, 1);
        this.smoldering.push(e);
        this.burntCount++;
      }
    }
    // Glut und Rauch nach dem Brand
    for (let i = this.smoldering.length - 1; i >= 0; i--) {
      const e = this.smoldering[i];
      e.smolder -= dt * (1 + rain * 3);
      const d = Math.hypot(camPos.x - e.x, camPos.z - e.z);
      if (d < 1000 && Math.random() < dt * 2 * this.q) {
        smoke.spawn(e.x + (Math.random() - 0.5) * e.w, e.y - e.h * 0.3, e.z + (Math.random() - 0.5) * e.d, 0, 2.5, 0, 5, 3, 12);
      }
      if (e.smolder <= 0) this.smoldering.splice(i, 1);
    }

    // Lichter den 3 nächsten Feuern geben
    const sorted = this.burning
      .map((e) => ({ e, d: (camPos.x - e.x) ** 2 + (camPos.z - e.z) ** 2 }))
      .sort((a, b) => a.d - b.d);
    const t = performance.now() / 1000;
    for (let k = 0; k < this.lights.length; k++) {
      const l = this.lights[k];
      const s = sorted[k];
      // Wichtig: Lichter NIE unsichtbar schalten – sonst müssen alle Shader
      // neu kompiliert werden (Ruckler). Stattdessen Helligkeit 0.
      if (!s || s.d > 900 * 900) {
        l.intensity = 0;
        continue;
      }
      const e = s.e;
      l.position.set(e.x, e.y + e.h * 0.2, e.z);
      const flick = 0.8 + Math.sin(t * 13 + k) * 0.1 + Math.sin(t * 29 + k * 2) * 0.1;
      const size = e.kind === 'tree' ? 0.6 : 1;
      l.intensity = 1100 * e.intensity * flick * size;
      if (fireColor) l.color.copy(fireColor);
    }
    this.stats.nearby = clamp(nearby, 0, 1.5);
    this.stats.nearest = nearest;
    this.stats.count = this.burning.length;
  }

  _randomPoint(e, out) {
    if (e.kind === 'tree') {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * e.r;
      return out.set(e.x + Math.cos(a) * r, e.y + (Math.random() - 0.4) * e.h * 0.6, e.z + Math.sin(a) * r);
    }
    const u = (Math.random() - 0.5) * (e.w || 4);
    const v = (Math.random() - 0.5) * (e.d || 4);
    const c = Math.cos(e.rot || 0);
    const s = Math.sin(e.rot || 0);
    return out.set(e.x + u * c + v * s, e.y + (Math.random() - 0.2) * e.h * 0.7, e.z - u * s + v * c);
  }

  /** Alles löschen und wieder aufbauen */
  reset() {
    for (const e of this.entities) {
      e.state = 0;
      e.heat = 0;
      e.t = 0;
      e.onReset?.();
    }
    this.burning.length = 0;
    this.smoldering.length = 0;
    this.warm.clear();
    this.burntCount = 0;
    this.vegetation.reset();
    this.terrain.clearScorch();
    for (const l of this.lights) l.intensity = 0;
  }
}
