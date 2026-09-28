// Soldaten für die Schlachten (wie in DragonTwin: zwei Heere kämpfen am Boden, der Drache
// greift vom Himmel aus ein). Hunderte Soldaten → InstancedMesh (wenige Draw-Calls).
// Beine und Arme schwingen im Vertex-Shader (Laufen, Zustossen). Jeder Soldat hat einen
// Zustand: stehen, marschieren, kämpfen, fliehen, brennen, durch die Luft fliegen (vom Drachen
// umgeworfen – eine einfache "Ragdoll"), am Boden liegen, tot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeParts } from '../dragon/geo.js';
import { clamp } from '../core/utils.js';

export const ALLY = 0;
export const ENEMY = 1;
export const INFANTRY = 0;
export const ARCHER = 1;
export const COMMANDER = 2;

const SCALE = 1.35; // etwas grösser als echte Menschen (sonst sieht man sie aus der Luft kaum)
const CELL = 10; // Raster für die Nachbarsuche (m)
const WALK = 2.2; // m/s
const RUN = 4.6;
const REACH = 1.9; // Nahkampf-Abstand
const SEEK = 45; // so weit suchen Soldaten nach Gegnern
const ARROW_SPEED = 48;
const MAX_ARROWS = 160;

const TEAM_COLORS = [new THREE.Color(0x2d5aa8), new THREE.Color(0xa22020)];
const CHAR = new THREE.Color(0x201814);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(SCALE, SCALE, SCALE);
const _zero = new THREE.Vector3(0, 0, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Teile zusammenfügen und jedem Punkt eine "Glied-Nummer" geben (für die Animation). */
function withLimb(parts, limb) {
  const g = mergeParts(parts);
  const n = g.getAttribute('position').count;
  g.setAttribute('aLimb', new THREE.Float32BufferAttribute(new Float32Array(n).fill(limb), 1));
  return g;
}

/**
 * Geometrie eines Soldaten (Blick nach +z), getrennt nach Material:
 * Stoff (Teamfarbe), Metall (Helm, Waffe), Haut. aLimb: ±1 Beine, ±2 Arme (+ = links).
 */
function soldierGeometry(type) {
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cloth = [];
  const metal = [];
  const skin = [];
  // Stoff: Beine, Rumpf, Rock, Ärmel
  cloth.push(withLimb([{ geo: B(0.17, 0.82, 0.19), p: [-0.12, 0.41, 0] }], 1));
  cloth.push(withLimb([{ geo: B(0.17, 0.82, 0.19), p: [0.12, 0.41, 0] }], -1));
  cloth.push(withLimb([{ geo: B(0.46, 0.6, 0.28), p: [0, 1.12, 0] }, { geo: B(0.52, 0.32, 0.32), p: [0, 0.8, 0] }], 0));
  cloth.push(withLimb([{ geo: B(0.13, 0.56, 0.14), p: [-0.31, 1.12, 0] }], 2));
  cloth.push(withLimb([{ geo: B(0.13, 0.56, 0.14), p: [0.31, 1.12, 0] }], -2));
  // Haut: Kopf und Hände
  skin.push(withLimb([{ geo: B(0.24, 0.26, 0.24), p: [0, 1.58, 0] }], 0));
  skin.push(withLimb([{ geo: B(0.11, 0.11, 0.11), p: [-0.31, 0.8, 0.02] }], 2));
  skin.push(withLimb([{ geo: B(0.11, 0.11, 0.11), p: [0.31, 0.8, 0.02] }], -2));
  // Metall: Helm, Gürtel
  metal.push(withLimb([
    { geo: new THREE.CylinderGeometry(0.16, 0.17, 0.14, 8), p: [0, 1.73, 0] },
    { geo: new THREE.ConeGeometry(0.17, 0.16, 8), p: [0, 1.87, 0] },
    { geo: B(0.49, 0.06, 0.31), p: [0, 0.86, 0] },
  ], 0));
  if (type === ARCHER) {
    // Bogen in der linken Hand, Köcher auf dem Rücken
    metal.push(withLimb([{ geo: B(0.04, 1.35, 0.06), p: [-0.34, 1.0, 0.18], r: [0.15, 0, 0] }], 2));
    cloth.push(withLimb([{ geo: B(0.13, 0.52, 0.13), p: [0.12, 1.22, -0.19], r: [0.25, 0, 0.2] }], 0));
  } else {
    // Schild links (Teamfarbe), Speer rechts
    cloth.push(withLimb([{ geo: B(0.08, 0.72, 0.56), p: [-0.43, 1.02, 0.12] }], 2));
    metal.push(withLimb([
      { geo: B(0.05, 2.4, 0.05), p: [0.36, 1.25, 0.12] },
      { geo: new THREE.ConeGeometry(0.06, 0.28, 4), p: [0.36, 2.58, 0.12] },
    ], -2));
    if (type === COMMANDER) {
      // Umhang
      cloth.push(withLimb([{ geo: B(0.52, 0.95, 0.05), p: [0, 1.0, -0.2], r: [0.12, 0, 0] }], 0));
    }
  }
  return { cloth: mergeGeometries(cloth), metal: mergeGeometries(metal), skin: mergeGeometries(skin) };
}

/** Material mit Glieder-Animation im Vertex-Shader */
function animatedMaterial(params) {
  const mat = new THREE.MeshStandardMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aLimb;
attribute vec3 aAnim; // Phase, Bein-Ausschlag, Arm-Ausschlag`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
if (abs(aLimb) > 0.5) {
  float arm = step(1.5, abs(aLimb));
  float side = sign(aLimb);
  float sw = sin(aAnim.x);
  // Beine gegengleich, Arme gegen die Beine; der rechte Arm (Waffe) stösst beim Kämpfen zu
  float ang = arm > 0.5 ? (-sw * side * aAnim.z) : (sw * side * aAnim.y);
  float pivot = arm > 0.5 ? 1.38 : 0.82;
  vec3 pp = transformed;
  pp.y -= pivot;
  float c = cos(ang);
  float s = sin(ang);
  transformed.y = pp.y * c - pp.z * s + pivot;
  transformed.z = pp.y * s + pp.z * c;
}`
      );
  };
  return mat;
}

/** Eine Gruppe gleicher Soldaten (gleicher Typ): 3 InstancedMeshes teilen sich die Animation */
class Squad {
  constructor(scene, type, count, mats) {
    const geo = soldierGeometry(type);
    this.count = count;
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    this.meshes = [];
    for (const [key, mat] of [['cloth', mats.cloth], ['metal', mats.metal], ['skin', mats.skin]]) {
      const g = geo[key];
      g.setAttribute('aAnim', this.anim);
      const m = new THREE.InstancedMesh(g, mat, count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      this.meshes.push(m);
    }
    this.cloth = this.meshes[0];
    this.used = 0;
  }

  setCount(n) {
    this.used = n;
    for (const m of this.meshes) m.count = n;
  }
}

export class Soldiers {
  constructor(scene, terrain, particles) {
    this.terrain = terrain;
    this.particles = particles;
    this.list = [];
    this.grid = new Map();
    const mats = {
      cloth: animatedMaterial({ color: 0xffffff, roughness: 0.9 }),
      metal: animatedMaterial({ color: 0x8e9096, roughness: 0.42, metalness: 0.65 }),
      skin: animatedMaterial({ color: 0xc99a78, roughness: 0.85 }),
    };
    this.squads = [new Squad(scene, INFANTRY, 640, mats), new Squad(scene, ARCHER, 200, mats), new Squad(scene, COMMANDER, 4, mats)];
    // Pfeile
    const ag = new THREE.BoxGeometry(0.05, 0.05, 1.4);
    this.arrowMesh = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.8 }), MAX_ARROWS);
    this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrowMesh.frustumCulled = false;
    this.arrowMesh.count = 0;
    scene.add(this.arrowMesh);
    this.arrows = [];
    for (let i = 0; i < MAX_ARROWS; i++) this.arrows.push({ on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, stuck: 0, atDragon: false, team: 0 });
    this.time = 0;
    this.fxBudget = 0;
    // Ereignisse (setzt Battle.js)
    this.onDeath = null; // (Soldat, Ursache)
    this.onArrowHitDragon = null; // ()
    this.onClash = null; // (Position) Waffen klirren
    this.onShoot = null; // (Position) Bogen
  }

  // ------------------------------------------------------------ Aufbau
  clear() {
    this.list.length = 0;
    for (const s of this.squads) s.setCount(0);
    for (const a of this.arrows) a.on = false;
    this.arrowMesh.count = 0;
  }

  /** Soldat hinzufügen. slot = Platz in der Formation (x, z). Gibt den Soldaten zurück. */
  add(team, type, x, z, yaw) {
    const sq = this.squads[type];
    if (sq.used >= sq.count) return null;
    const s = {
      team,
      type,
      sq,
      idx: sq.used,
      x,
      z,
      y: this.terrain.heightAt(x, z),
      yaw,
      slotX: x,
      slotZ: z,
      vx: 0,
      vz: 0,
      speed: 0,
      hp: type === COMMANDER ? 12 : type === ARCHER ? 2 : 4,
      state: 'idle',
      t: 0,
      target: null,
      seekT: Math.random() * 0.5,
      cd: 0.5 + Math.random(),
      phase: Math.random() * 6,
      walkAmp: 0,
      armAmp: 0,
      heat: 0,
      burnT: 0,
      air: null,
      fall: 0, // 0 = steht, 1 = liegt
      fallDir: 1,
      rot: new THREE.Quaternion(),
      alive: true,
      rally: 0,
      lastHit: null,
      shootT: 2 + Math.random() * 3,
      dead: 0,
    };
    sq.setCount(sq.used + 1);
    sq.cloth.setColorAt(s.idx, TEAM_COLORS[team]);
    sq.cloth.instanceColor.needsUpdate = true;
    this.list.push(s);
    return s;
  }

  _kill(s, cause, charred = false) {
    if (!s.alive) {
      s.state = 'dead'; // schon tot (z. B. ein weggeschleuderter Körper ist gelandet)
      return;
    }
    s.alive = false;
    s.state = 'dead';
    s.dead = 0;
    if (charred) {
      s.sq.cloth.setColorAt(s.idx, CHAR);
      s.sq.cloth.instanceColor.needsUpdate = true;
    }
    this.onDeath?.(s, cause);
  }

  // ------------------------------------------------------------ Einwirkungen von aussen
  /**
   * Hitze (Feuerstrahl): Soldaten fangen Feuer, rennen brennend herum und sterben.
   * src = wer das Feuer gemacht hat ('player' = du, 'enemy' = feindlicher Drache)
   */
  heat(p, radius, amount, src = 'player') {
    this._each(p.x, p.z, radius + 1, (s) => {
      if (!s.alive || s.state === 'burn') return;
      const dy = Math.abs(p.y - (s.y + 1));
      if (dy > radius + 2) return;
      s.heat += amount * 1.6;
      if (s.heat > 0.3) this.ignite(s, src);
    });
  }

  ignite(s, src = 'player') {
    if (!s.alive || s.state === 'burn') return;
    s.lastHit = src;
    s.state = 'burn';
    s.burnT = 2.2 + Math.random() * 2.2;
    s.t = 0;
    s.yaw = Math.random() * Math.PI * 2;
    s.sq.cloth.setColorAt(s.idx, CHAR);
    s.sq.cloth.instanceColor.needsUpdate = true;
  }

  /**
   * Wucht (Landung, Flügelschlag, Brüllen, Biss): Soldaten im Umkreis fliegen weg.
   * power = Geschwindigkeit am Rand der Mitte (m/s), lift = nach oben, dir = zusätzliche Schubrichtung
   */
  blast(p, radius, power, lift = 6, dir = null, kill = false, src = 'player') {
    let n = 0;
    this._each(p.x, p.z, radius, (s) => {
      if (s.state === 'dead' && !kill) return;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > radius || Math.abs(p.y - s.y) > radius + 4) return;
      const k = 1 - d / radius;
      const sp = power * (0.35 + 0.65 * k);
      _d.set(dx / (d || 1), 0, dz / (d || 1)).multiplyScalar(sp);
      if (dir) _d.addScaledVector(dir, 0.6 * k);
      _d.y = lift * (0.5 + k) * (0.7 + Math.random() * 0.6);
      s.lastHit = src;
      this._launch(s, _d, kill);
      n++;
    });
    return n;
  }

  /** Der Drachenkörper fegt im Tiefflug durch die Reihen */
  sweep(p, vel, radius) {
    let n = 0;
    const sp = vel.length();
    this._each(p.x, p.z, radius, (s) => {
      if (!s.alive && s.state !== 'dead') return;
      if (s.state === 'air') return;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d > radius || p.y - (s.y + 1) > 5) return;
      _d.copy(vel).multiplyScalar(0.55 + Math.random() * 0.3);
      _d.x += (s.x - p.x) * 1.5;
      _d.z += (s.z - p.z) * 1.5;
      _d.y = 7 + Math.random() * 7 + sp * 0.08;
      s.lastHit = 'player';
      this._launch(s, _d, sp > 35);
      n++;
    });
    return n;
  }

  /** Brüllen: Feinde bekommen Angst und fliehen */
  scare(p, radius, team) {
    this._each(p.x, p.z, radius, (s) => {
      if (!s.alive || s.team !== team || s.state === 'burn' || s.state === 'air') return;
      if (s.type === COMMANDER) return;
      s.state = 'flee';
      s.t = 2.5 + Math.random() * 2;
      s.fleeX = p.x;
      s.fleeZ = p.z;
    });
  }

  _launch(s, v, kill) {
    s.state = 'air';
    s.air = { vx: v.x, vy: v.y, vz: v.z, ax: (Math.random() - 0.5) * 14, az: (Math.random() - 0.5) * 14, kill };
    s.y += 0.3;
    s.target = null;
  }

  /** Alle Soldaten im Umkreis (über das Raster) */
  _each(x, z, r, fn) {
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const cell = this.grid.get(i * 73856 + j);
        if (!cell) continue;
        for (const s of cell) fn(s);
      }
    }
  }

  _rebuildGrid() {
    this.grid.clear();
    for (const s of this.list) {
      if (s.state === 'dead' && s.dead > 30) continue;
      const k = Math.floor(s.x / CELL) * 73856 + Math.floor(s.z / CELL);
      let cell = this.grid.get(k);
      if (!cell) {
        cell = [];
        this.grid.set(k, cell);
      }
      cell.push(s);
    }
  }

  _nearestEnemy(s, radius) {
    let best = null;
    let bd = radius * radius;
    this._each(s.x, s.z, radius, (o) => {
      if (!o.alive || o.team === s.team || o.state === 'air') return;
      const d = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    });
    return best;
  }

  // ------------------------------------------------------------ Pfeile
  shootArrow(from, to, toVel, team, atDragon) {
    const a = this.arrows.find((x) => !x.on);
    if (!a) return;
    a.on = true;
    a.age = 0;
    a.stuck = 0;
    a.team = team;
    a.atDragon = atDragon;
    a.pos.copy(from);
    // Vorhalt und Bogen (Schwerkraft) einrechnen, etwas Streuung
    let tt = from.distanceTo(to) / ARROW_SPEED;
    _a.copy(to);
    if (toVel) _a.addScaledVector(toVel, tt);
    tt = from.distanceTo(_a) / ARROW_SPEED;
    _a.y += 0.5 * 9.81 * tt * tt;
    a.vel.subVectors(_a, from).normalize();
    const sp = atDragon ? 0.035 : 0.06;
    a.vel.x += (Math.random() - 0.5) * sp;
    a.vel.y += (Math.random() - 0.5) * sp;
    a.vel.z += (Math.random() - 0.5) * sp;
    a.vel.normalize().multiplyScalar(ARROW_SPEED);
    this.onShoot?.(from);
  }

  _updateArrows(dt, dragonPos, dragonActive) {
    let n = 0;
    for (const a of this.arrows) {
      if (!a.on) continue;
      a.age += dt;
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0) a.on = false;
      } else {
        _b.copy(a.pos);
        a.vel.y -= 9.81 * dt;
        a.pos.addScaledVector(a.vel, dt);
        // Treffer am Drachen?
        if (a.atDragon && dragonActive) {
          _d.subVectors(a.pos, _b);
          const l2 = _d.lengthSq();
          const t = l2 > 0 ? clamp(_a.subVectors(dragonPos, _b).dot(_d) / l2, 0, 1) : 0;
          if (_a.copy(_b).addScaledVector(_d, t).distanceTo(dragonPos) < 5) {
            a.on = false;
            this.onArrowHitDragon?.(a.pos);
            continue;
          }
        }
        const gh = this.terrain.heightAt(a.pos.x, a.pos.z);
        if (a.pos.y < gh + 0.3) {
          a.pos.y = gh + 0.4;
          a.stuck = 4;
          // Pfeil auf Soldaten: trifft vielleicht den nächsten Gegner (höchstens einen)
          if (!a.atDragon && Math.random() < 0.4) {
            let hit = null;
            let hd = 1.3 * 1.3;
            this._each(a.pos.x, a.pos.z, 1.3, (s) => {
              if (!s.alive || s.team === a.team || s.state === 'air') return;
              const d = (s.x - a.pos.x) ** 2 + (s.z - a.pos.z) ** 2;
              if (d < hd) {
                hd = d;
                hit = s;
              }
            });
            if (hit) {
              hit.hp -= 1;
              if (hit.hp <= 0) this._fall(hit, a.vel, 'arrow');
            }
          }
        } else if (a.age > 8) a.on = false;
      }
      if (!a.on) continue;
      _q.setFromUnitVectors(_z, _d.copy(a.vel).normalize());
      this.arrowMesh.setMatrixAt(n++, _m.compose(a.pos, a.stuck > 0 ? _q : _q, _s1));
    }
    this.arrowMesh.count = n;
    this.arrowMesh.instanceMatrix.needsUpdate = true;
  }

  /** Umfallen (tot) in eine Richtung */
  _fall(s, dir, cause) {
    s.fallDir = dir ? Math.sign((dir.x || 0.01) * Math.sin(s.yaw) + (dir.z || 0.01) * Math.cos(s.yaw)) || 1 : 1;
    this._kill(s, cause);
  }

  // ------------------------------------------------------------ jedes Bild
  /**
   * ctx = { dragonPos, dragonVel, dragonActive, orders: [Befehl Verbündete, Befehl Feinde] ('hold'|'advance'|'charge'|'flee'),
   *         front: [x Front Verbündete, x Front Feinde], rally: [0..1, 0..1], camPos }
   */
  update(dt, ctx) {
    this.time += dt;
    this._rebuildGrid();
    const t = this.terrain;
    const fire = this.particles.fire;
    const smoke = this.particles.smoke;
    let fx = 0;
    for (const s of this.list) {
      if (s.state === 'dead') {
        s.dead += dt;
        s.fall = Math.min(1, s.fall + dt * 3);
        s.walkAmp = s.armAmp = 0;
        // leichter Rauch von verbrannten Körpern
        if (s.dead < 6 && Math.random() < dt * 0.6 && fx < 40) {
          smoke.spawn(s.x, s.y + 0.4, s.z, 0, 1.5, 0, 3, 1, 4);
          fx++;
        }
        continue;
      }
      if (s.state === 'air') {
        const A = s.air;
        A.vy -= 9.81 * dt;
        s.x += A.vx * dt;
        s.y += A.vy * dt;
        s.z += A.vz * dt;
        _e.set(A.ax * dt, 0, A.az * dt);
        s.rot.multiply(_q2.setFromEuler(_e));
        const gh = t.heightAt(s.x, s.z);
        if (s.y <= gh) {
          s.y = gh;
          const impact = Math.hypot(A.vx, A.vy, A.vz);
          s.air = null;
          s.rot.identity();
          s.fallDir = Math.random() < 0.5 ? -1 : 1;
          if (A.kill || impact > 12 || s.state === 'burn') {
            this._kill(s, s.lastHit === 'player' ? 'wucht' : 'wucht-fremd');
            s.fall = 1;
          } else {
            s.state = 'down';
            s.t = 1.2 + Math.random() * 1.5;
            s.fall = 1;
          }
        }
        continue;
      }
      const rally = ctx.rally[s.team] || 0;
      s.heat = Math.max(0, s.heat - dt * 0.35);
      let wantX = 0;
      let wantZ = 0;
      let want = 0;
      if (s.state === 'burn') {
        // brennend herumrennen (Panik), dann umfallen
        s.burnT -= dt;
        s.t -= dt;
        if (s.t <= 0) {
          s.t = 0.4 + Math.random() * 0.6;
          s.yaw += (Math.random() - 0.5) * 2.5;
        }
        wantX = Math.sin(s.yaw);
        wantZ = Math.cos(s.yaw);
        want = RUN * 1.1;
        if (fx < 60 && Math.random() < dt * 18) {
          fire.spawn(s.x + (Math.random() - 0.5), s.y + 1 + Math.random(), s.z + (Math.random() - 0.5), 0, 2 + Math.random() * 2, 0, 0.5 + Math.random() * 0.4, 0.8, 1.8);
          fx++;
        }
        // Feuer springt auf Nachbarn über
        if (Math.random() < dt * 0.6) {
          this._each(s.x, s.z, 2, (o) => {
            if (o !== s && o.alive && o.state !== 'burn' && Math.random() < 0.2) this.ignite(o, s.lastHit);
          });
        }
        if (s.burnT <= 0) {
          this._kill(s, s.lastHit === 'player' ? 'feuer' : 'feuer-fremd', true);
          continue;
        }
      } else if (s.state === 'down') {
        s.t -= dt;
        s.fall = s.t > 0.5 ? 1 : Math.max(0, s.t * 2);
        if (s.t <= 0) {
          s.state = 'idle';
          s.fall = 0;
        }
      } else if (s.state === 'flee') {
        s.t -= dt;
        const dx = s.x - s.fleeX;
        const dz = s.z - s.fleeZ;
        const d = Math.hypot(dx, dz) || 1;
        wantX = dx / d;
        wantZ = dz / d;
        want = RUN;
        if (s.t <= 0 && ctx.orders[s.team] !== 'flee') s.state = 'idle';
      } else {
        const order = ctx.orders[s.team];
        if (order === 'flee') {
          // ganzes Heer flieht (verloren): weg von der Front, Richtung Heimat
          wantX = s.team === ENEMY ? 1 : -1;
          want = RUN;
          s.state = 'march';
        } else {
          // Ziel suchen (nicht jedes Bild – spart Zeit)
          s.seekT -= dt;
          if (s.seekT <= 0) {
            s.seekT = 0.4 + Math.random() * 0.3;
            const range = s.type === ARCHER ? 110 : order === 'hold' ? 16 : SEEK;
            if (!s.target || !s.target.alive || s.target.state === 'air') s.target = this._nearestEnemy(s, range);
          }
          const tg = s.target && s.target.alive ? s.target : null;
          if (s.type === ARCHER) {
            // Bogenschützen bleiben hinten und schiessen
            this._toSlot(s, ctx, order, (x, z, sp) => {
              wantX = x;
              wantZ = z;
              want = sp;
            });
            s.shootT -= dt * (1 + rally);
            const dd = ctx.dragonActive ? Math.hypot(ctx.dragonPos.x - s.x, ctx.dragonPos.z - s.z) : 1e9;
            if (s.shootT <= 0) {
              s.shootT = 2.6 + Math.random() * 2.6;
              _p.set(s.x, s.y + 1.7 * SCALE, s.z);
              if (s.team === ENEMY && dd < 200 && ctx.dragonPos.y - s.y < 170) {
                this.shootArrow(_p, ctx.dragonPos, ctx.dragonVel, s.team, true);
                s.yaw = Math.atan2(ctx.dragonPos.x - s.x, ctx.dragonPos.z - s.z);
                s.armAmp = 1.2;
              } else if (tg) {
                _a.set(tg.x, tg.y + 1, tg.z);
                this.shootArrow(_p, _a, null, s.team, false);
                s.yaw = Math.atan2(tg.x - s.x, tg.z - s.z);
                s.armAmp = 1.2;
              }
            }
            s.state = want > 0.1 ? 'march' : 'idle';
          } else if (tg && order !== 'hold' ? true : tg && Math.hypot(tg.x - s.x, tg.z - s.z) < 16) {
            const dx = tg.x - s.x;
            const dz = tg.z - s.z;
            const d = Math.hypot(dx, dz);
            if (d > REACH) {
              wantX = dx / d;
              wantZ = dz / d;
              want = RUN * (1 + rally * 0.4);
              s.state = 'march';
            } else {
              // Nahkampf
              s.state = 'fight';
              s.yaw = Math.atan2(dx, dz);
              s.cd -= dt * (1 + rally * 0.8);
              if (s.cd <= 0) {
                s.cd = 1.3 + Math.random() * 1.0;
                if (Math.random() < 0.3) this.onClash?.(_p.set(s.x, s.y + 1, s.z));
                if (Math.random() < 0.35 + rally * 0.25) {
                  tg.hp -= 1 + (rally > 0 ? 1 : 0);
                  if (tg.hp <= 0) this._fall(tg, _d.set(dx, 0, dz), 'kampf');
                }
              }
            }
          } else {
            this._toSlot(s, ctx, order, (x, z, sp) => {
              wantX = x;
              wantZ = z;
              want = sp;
            });
            s.state = want > 0.1 ? 'march' : 'idle';
          }
        }
      }
      // Bewegung (weich beschleunigen, drehen, nicht durcheinander laufen)
      s.speed += (want - s.speed) * Math.min(1, dt * 4);
      if (want > 0.1) {
        const ty = Math.atan2(wantX, wantZ);
        let dA = ty - s.yaw;
        dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        s.yaw += clamp(dA, -dt * 5, dt * 5);
      }
      let mx = Math.sin(s.yaw) * s.speed;
      let mz = Math.cos(s.yaw) * s.speed;
      // Abstand halten
      this._each(s.x, s.z, 1.2, (o) => {
        if (o === s || !o.alive || o.state === 'air') return;
        const dx = s.x - o.x;
        const dz = s.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.9 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          mx += (dx / d) * (0.95 - d) * 4;
          mz += (dz / d) * (0.95 - d) * 4;
        }
      });
      const nx = s.x + mx * dt;
      const nz = s.z + mz * dt;
      const nh = t.heightAt(nx, nz);
      if (nh > 0.5) {
        s.x = nx;
        s.z = nz;
        s.y = nh;
      }
      // Animation: Phase läuft mit dem Tempo
      const moving = clamp(s.speed / RUN, 0, 1.2);
      s.phase += dt * (s.state === 'fight' ? 9 : 3 + s.speed * 2.2);
      s.walkAmp += ((s.state === 'fight' ? 0.12 : 0.55 * moving) - s.walkAmp) * Math.min(1, dt * 6);
      const armTarget = s.state === 'fight' ? 0.9 : s.state === 'burn' ? 1.3 : 0.35 * moving;
      s.armAmp += (armTarget - s.armAmp) * Math.min(1, dt * 5);
    }
    this._updateArrows(dt, ctx.dragonPos, ctx.dragonActive);
    this._write();
  }

  /** Richtung zum eigenen Platz in der Formation (die Formation rückt mit der Front vor) */
  _toSlot(s, ctx, order, out) {
    const front = ctx.front[s.team];
    const tx = s.slotX + front;
    const tz = s.slotZ;
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.2) return out(0, 0, 0);
    out(dx / d, dz / d, d > 8 ? RUN * 0.8 : WALK);
  }

  _write() {
    for (const s of this.list) {
      const sq = s.sq;
      _q.setFromAxisAngle(_up, s.yaw);
      if (s.state === 'air') _q.multiply(s.rot);
      else if (s.fall > 0) {
        // umfallen: um die Querachse kippen (nach hinten oder vorne)
        _q.multiply(_q2.setFromAxisAngle(_x, -s.fallDir * s.fall * Math.PI * 0.5));
      }
      // brennende Soldaten ducken sich etwas, Tote sinken nach langer Zeit ein
      const sink = s.state === 'dead' && s.dead > 40 ? Math.min(1.5, (s.dead - 40) * 0.1) : 0;
      _p.set(s.x, s.y + (s.fall > 0 ? 0.25 : 0) - sink, s.z);
      _m.compose(_p, _q, _s);
      for (const m of sq.meshes) m.setMatrixAt(s.idx, _m);
      const k = s.idx * 3;
      sq.anim.array[k] = s.phase;
      sq.anim.array[k + 1] = s.walkAmp;
      sq.anim.array[k + 2] = s.armAmp;
    }
    for (const sq of this.squads) {
      if (!sq.used) continue;
      for (const m of sq.meshes) m.instanceMatrix.needsUpdate = true;
      sq.anim.needsUpdate = true;
    }
  }

  /** Zähler: lebende Soldaten je Team */
  counts() {
    const c = [0, 0];
    for (const s of this.list) if (s.alive) c[s.team]++;
    return c;
  }
}

const _z = new THREE.Vector3(0, 0, 1);
const _s1 = new THREE.Vector3(1, 1, 1);
