// Feindlicher Drachenreiter (wie der "hostile Dragontwin" in DragonTwin): ein zweiter Drache
// mit Reiter, der dich in der Luft verfolgt. Er kündigt seine Angriffe an (das Maul glüht,
// er knurrt) – so hast du Zeit auszuweichen:
//  - Feuerstrahl: kommt er von vorne oder hinten nah genug, speit er Feuer
//  - Feuerbälle: aus der Entfernung 3 (später 5) Feuerbälle, die leicht nachsteuern
//  - Tiefangriff: er fliegt tief über deine Truppen und verbrennt sie
// Ab der Hälfte seiner Lebenskraft wird er wütend (schneller, mehr Feuerbälle).
// Bei 0 stürzt er brennend ab.
import * as THREE from 'three';
import { Dragon } from '../dragon/Dragon.js';
import { FireBreath } from '../dragon/FireBreath.js';
import { clamp, damp } from '../core/utils.js';

export const ENEMY_NAME = 'Skarn der Sturmreiter';
const HP = 100;
const SKIN = { body: 0x2e3440, belly: 0x707480, membrane: 0x1c2e48, horn: 0xdcd6c8, spike: 0x3c5c8c, eye: 0x50d0ff, rough: 0.4, metal: 0.15 };
const MIN_AGL = 28;
const MAX_BALLS = 12;

const _f = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

function angleDiff(a, b) {
  let d = b - a;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

export class EnemyDragon {
  constructor(scene, world, quality = 1) {
    this.world = world;
    this.terrain = world.terrain;
    this.particles = world.particles;
    this.dragon = new Dragon();
    this.dragon.setSkin(SKIN);
    this.dragon.root.scale.setScalar(0.9);
    this.dragon.root.visible = false;
    if (this.dragon.cape) this.dragon.cape.material = this.dragon.cape.material.clone();
    this.dragon.cape?.material.color.set(0x1a2a4a);
    scene.add(this.dragon.root);
    this.fire = new FireBreath(scene, world.particles, quality);
    this.fire.onIgnite = () => {}; // Brände des Feindes geben dem Spieler keine Punkte
    // Feuerbälle: leuchtende Kugeln mit Feuerschweif
    const ballGeo = new THREE.SphereGeometry(1.3, 14, 10);
    const ballMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.5) });
    this.balls = [];
    for (let i = 0; i < MAX_BALLS; i++) {
      const m = new THREE.Mesh(ballGeo, ballMat);
      m.visible = false;
      scene.add(m);
      this.balls.push({ mesh: m, on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0 });
    }
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 50;
    this.bank = 0;
    this.hp = HP;
    this.state = 'off';
    this.stateT = 0;
    this.flapPhase = 0;
    this.flapAmp = 0;
    this.fold = 0;
    this.phase2 = false;
    this.attackCd = 4;
    this.volleyCd = 7;
    this.strafeCd = 14;
    this.fireWant = 0;
    this.roar = 0;
    this.bumpCd = 0;
    this.hurtFlash = 0;
    this.anim = {};
    this.on = {}; // roar(pos), hitPlayer(Schaden), explode(pos, stark), defeated(), phase2(), strafe(), fireball(pos)
  }

  get active() {
    return this.state !== 'off' && this.state !== 'dying' && this.state !== 'wreck' && this.state !== 'leave';
  }

  get visible() {
    return this.state !== 'off';
  }

  get position() {
    return this.pos;
  }

  /** Erscheinen: kommt von weit her angeflogen */
  spawn(from, look) {
    this.pos.copy(from);
    _d.subVectors(look, from);
    this.yaw = Math.atan2(-_d.x, -_d.z);
    this.pitch = 0;
    this.speed = 60;
    this.hp = HP;
    this.phase2 = false;
    this.state = 'arrive';
    this.stateT = 0;
    this.attackCd = 3;
    this.volleyCd = 5;
    this.strafeCd = 20;
    this.dragon.root.visible = true;
    this.dragon.setRider(true);
    this.dragon.root.rotation.set(0, 0, 0);
  }

  despawn() {
    this.state = 'off';
    this.dragon.root.visible = false;
    for (const b of this.balls) {
      b.on = false;
      b.mesh.visible = false;
    }
  }

  /** Wegfliegen (Schlacht vorbei) */
  leave() {
    if (this.active) {
      this.state = 'leave';
      this.stateT = 0;
    }
  }

  // ------------------------------------------------------------ Treffer vom Spieler
  /** Feuer des Spielers (für jeden Punkt der Flamme) */
  takeFlame(p, radius, amount) {
    if (!this.active) return;
    if (p.distanceTo(this.pos) < radius + 8) this._hurt(amount * 1.3);
  }

  /** Biss: vor dem Maul, nah genug */
  takeBite(mouth, dir) {
    if (!this.active) return false;
    _d.subVectors(this.pos, mouth);
    const dist = _d.length();
    // sehr nah zählt immer, sonst muss er ungefähr vor dem Maul sein
    if (dist > 22 || (dist > 9 && _d.normalize().dot(dir) < 0.25)) return false;
    this._hurt(9);
    // Stoss: der Gegner wird weggeschleudert und kurz aus dem Tritt gebracht
    this.pos.addScaledVector(dir, 4);
    this.pitch = -0.3;
    this.attackCd = Math.max(this.attackCd, 1.5);
    return true;
  }

  _hurt(n) {
    this.hp -= n;
    this.hurtFlash = 0.2;
    if (!this.phase2 && this.hp <= HP * 0.5) {
      this.phase2 = true;
      this.roar = 1.6;
      this.on.roar?.(this.pos, true);
      this.on.phase2?.();
      // kurz hochsteigen, dann wütend zurück
      this.state = 'climb';
      this.stateT = 0;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dying';
      this.stateT = 0;
      this.dragon.setRider(false);
      this.on.defeated?.();
    }
  }

  // ------------------------------------------------------------ Feuerbälle
  _shoot(target, targetVel) {
    const b = this.balls.find((x) => !x.on);
    if (!b) return;
    this.dragon.getMouth(_v);
    b.pos.copy(_v);
    const t = b.pos.distanceTo(target) / 75;
    _d.copy(target).addScaledVector(targetVel, t * 0.8).sub(b.pos).normalize();
    _d.x += (Math.random() - 0.5) * 0.05;
    _d.y += (Math.random() - 0.5) * 0.05;
    b.vel.copy(_d).normalize().multiplyScalar(75);
    b.age = 0;
    b.on = true;
    b.mesh.visible = true;
    this.on.fireball?.(b.pos);
  }

  _updateBalls(dt, ctx) {
    const P = this.particles;
    for (const b of this.balls) {
      if (!b.on) continue;
      b.age += dt;
      // leicht nachsteuern (Richtung Spieler)
      _d.subVectors(ctx.playerPos, b.pos).normalize();
      _v.copy(b.vel).normalize();
      _v.lerp(_d, Math.min(1, dt * 0.55)).normalize();
      b.vel.copy(_v).multiplyScalar(75);
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.scale.setScalar(0.9 + Math.sin(b.age * 30) * 0.12);
      // Schweif
      for (let i = 0; i < 3; i++) {
        P.fire.spawn(b.pos.x + (Math.random() - 0.5), b.pos.y + (Math.random() - 0.5), b.pos.z + (Math.random() - 0.5), -b.vel.x * 0.1, 1, -b.vel.z * 0.1, 0.35 + Math.random() * 0.2, 2.2, 0.6);
      }
      if (Math.random() < 0.4) P.smoke.spawn(b.pos.x, b.pos.y, b.pos.z, 0, 1, 0, 1.5, 1.5, 5);
      const hitPlayer = ctx.playerActive && b.pos.distanceTo(ctx.playerPos) < 8;
      const gh = this.terrain.heightAt(b.pos.x, b.pos.z);
      if (hitPlayer || b.pos.y < Math.max(gh, 0) + 0.5 || b.age > 6) {
        this._explode(b.pos, ctx);
        b.on = false;
        b.mesh.visible = false;
      }
    }
  }

  _explode(p, ctx) {
    const P = this.particles;
    const q = this.world.q.particles;
    for (let i = 0; i < 60 * q; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const sp = 8 + Math.random() * 16;
      const r = Math.sqrt(1 - u * u);
      P.fire.spawn(p.x, p.y, p.z, Math.cos(a) * r * sp, u * sp + 4, Math.sin(a) * r * sp, 0.5 + Math.random() * 0.5, 3, 7);
    }
    for (let i = 0; i < 30 * q; i++) P.sparks.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 30, Math.random() * 20, (Math.random() - 0.5) * 30, 1 + Math.random(), 0.5, 0.1, 1, 0.6, 0.2);
    for (let i = 0; i < 8; i++) P.smoke.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6, 4, 6, 18);
    const d = p.distanceTo(ctx.playerPos);
    if (ctx.playerActive && d < 14) this.on.hitPlayer?.(0.17 * (1 - d / 14) + 0.05, p);
    this.world.burn.applyHeat(p, 10, 1.2);
    this.terrain.paintScorch(p.x, p.z, 7, 0.5);
    this.on.explode?.(p);
    ctx.battle?.soldiers.blast(p, 12, 11, 7, null, true, 'enemy');
  }

  // ------------------------------------------------------------ jedes Bild
  /**
   * ctx = { playerPos, playerVel, playerActive, battle (Battle oder null), dt }
   */
  update(dt, ctx) {
    if (this.state === 'off') return;
    this.stateT += dt;
    this.attackCd -= dt;
    this.volleyCd -= dt;
    this.strafeCd -= dt;
    this.bumpCd -= dt;
    this.roar = Math.max(0, this.roar - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    const P = ctx.playerPos;
    const toP = _d.subVectors(P, this.pos);
    const dist = toP.length();
    this._forward(_f);
    const facing = dist > 1 ? _f.dot(toP) / dist : 0;
    let target = null; // Punkt, zu dem er fliegt
    let wantSpeed = 55 * (this.phase2 ? 1.15 : 1);
    let fire = 0;
    let minAgl = MIN_AGL;
    const battle = ctx.battle;

    switch (this.state) {
      case 'arrive':
        target = _v.copy(P).addScaledVector(ctx.playerVel, 1);
        target.y += 30;
        if (dist < 600) {
          this.state = 'hunt';
          this.stateT = 0;
          this.roar = 1.6;
          this.on.roar?.(this.pos, false);
        }
        break;
      case 'climb':
        // wütend hochsteigen, dann wieder angreifen
        target = _v.copy(this.pos).addScaledVector(_f, 100);
        target.y += 70;
        if (this.stateT > 3) this.state = 'hunt';
        break;
      case 'hunt': {
        // Verfolgen: Ziel etwas vor dem Spieler (Vorhalt)
        target = _v.copy(P).addScaledVector(ctx.playerVel, clamp(dist / 80, 0.3, 1.5));
        if (dist < 35) {
          // zu nah: abdrehen, neu anfliegen
          this.state = 'breakoff';
          this.stateT = 0;
          this.breakDir = Math.random() < 0.5 ? -1 : 1;
        } else if (this.attackCd <= 0 && dist < 120 && facing > 0.85) {
          this.state = 'breath';
          this.stateT = 0;
          this.on.growl?.(this.pos);
        } else if (this.volleyCd <= 0 && dist > 140 && dist < 420 && facing > 0.8) {
          this.state = 'volley';
          this.stateT = 0;
          this.shots = 0;
          this.on.growl?.(this.pos);
        } else if (this.strafeCd <= 0 && battle && battle.active) {
          const c = battle.allyCentroid();
          if (c) {
            this.state = 'strafe';
            this.stateT = 0;
            this.strafeFire = 0;
            this.scattered = false;
            this.strafeTarget = c;
            this.on.strafe?.();
          }
        }
        break;
      }
      case 'breakoff':
        // seitlich weg und etwas höher, dann wieder angreifen
        target = _v.set(-_f.z * this.breakDir, 0.25, _f.x * this.breakDir).multiplyScalar(120).add(this.pos).addScaledVector(_f, 80);
        if (this.stateT > 2.8) this.state = 'hunt';
        break;
      case 'breath':
        // 0.6 s Ansage (Maul glüht), dann 1.8 s Feuer
        target = _v.copy(P).addScaledVector(ctx.playerVel, 0.4);
        wantSpeed = 44;
        fire = this.stateT < 0.6 ? 0.15 : 1;
        this.fireWant = this.stateT >= 0.6;
        if (this.stateT > 2.4 + (this.phase2 ? 0.8 : 0)) {
          this.state = 'hunt';
          this.attackCd = this.phase2 ? 3 : 4.5;
          this.fireWant = false;
        }
        break;
      case 'volley': {
        target = _v.copy(P);
        wantSpeed = 40;
        fire = 0.2;
        const n = this.phase2 ? 5 : 3;
        if (this.stateT > 0.9 + this.shots * 0.28 && this.shots < n) {
          this._shoot(P, ctx.playerVel);
          this.shots++;
        }
        if (this.shots >= n && this.stateT > 1.2 + n * 0.28) {
          this.state = 'hunt';
          this.volleyCd = this.phase2 ? 6 : 9;
        }
        break;
      }
      case 'strafe': {
        // tief über die eigenen Truppen des Spielers fliegen und sie verbrennen
        const c = this.strafeTarget;
        target = _v.set(c.x, c.y + 26, c.z);
        minAgl = 16;
        const hd = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
        // die Truppen sehen ihn kommen und laufen auseinander
        if (hd < 170 && !this.scattered) {
          this.scattered = true;
          battle?.soldiers.scare(c, 45, 0);
        }
        if (hd < 90) {
          this.strafeFire = (this.strafeFire || 0) + dt;
          // nur ein kurzer Feuerstoss (sonst verbrennt er ein ganzes Heer auf einmal)
          this.fireWant = this.strafeFire < 1.3;
          fire = this.fireWant ? 1 : 0.2;
          // geradeaus weiter über die Reihen
          target = _v.copy(this.pos).addScaledVector(_f, 80);
          target.y = c.y + 22;
        }
        if (this.stateT > 12 || this.strafeFire > 2.2) {
          this.fireWant = false;
          this.state = 'hunt';
          this.strafeCd = this.phase2 ? 20 : 28;
        }
        break;
      }
      case 'leave':
        target = _v.copy(this.pos).add(_d.set(1000, 300, 0));
        if (this.stateT > 14) this.despawn();
        break;
      case 'dying': {
        // abstürzen: Nase runter, trudeln, Rauch und Feuer
        this.pitch = Math.max(-0.9, this.pitch - dt * 0.5);
        this.yaw += dt * 1.4;
        this.speed = Math.min(70, this.speed + dt * 12);
        this._forward(_f);
        this.pos.addScaledVector(_f, this.speed * dt);
        this.pos.y -= dt * this.stateT * 6;
        for (let i = 0; i < 3; i++) this.particles.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, 0, 2, 0, 3, 4, 14);
        this.particles.fire.spawn(this.pos.x, this.pos.y, this.pos.z, 0, 3, 0, 0.6, 3, 5);
        const gh = Math.max(this.terrain.heightAt(this.pos.x, this.pos.z), 0);
        if (this.pos.y < gh + 3) {
          this.pos.y = gh + 2.2;
          this.state = 'wreck';
          this.stateT = 0;
          this._explode(this.pos, ctx);
          this.on.crash?.(this.pos);
        }
        this._pose(dt, 0, 1, 0);
        this._updateBalls(dt, ctx);
        return;
      }
      case 'wreck':
        // liegt am Boden, raucht, verschwindet nach einer Weile
        if (Math.random() < dt * 4) this.particles.smoke.spawn(this.pos.x, this.pos.y, this.pos.z, 0, 2, 0, 5, 5, 16);
        this.dragon.root.position.copy(this.pos);
        this.dragon.root.rotation.set(0, this.yaw, 0.9);
        this.anim.grounded = 1;
        this.anim.fold = 1;
        this.anim.flapAmp = 0;
        this.anim.fire = 0;
        this.anim.roar = 0;
        this.anim.look = null;
        this.dragon.update(dt, this.anim);
        if (this.stateT > 50) this.despawn();
        this._updateBalls(dt, ctx);
        return;
      default:
    }

    // ---- Fliegen: zum Ziel drehen, Tempo halten, nicht in den Boden
    if (target) {
      _d.subVectors(target, this.pos);
      const wantYaw = Math.atan2(-_d.x, -_d.z);
      let wantPitch = clamp(Math.atan2(_d.y, Math.hypot(_d.x, _d.z)), -0.6, 0.55);
      _v.copy(this.pos).addScaledVector(_f, 60);
      const ground = Math.max(this.terrain.heightAt(_v.x, _v.z), this.terrain.heightAt(this.pos.x, this.pos.z), 0);
      if (this.pos.y < ground + minAgl) wantPitch = Math.max(wantPitch, 0.45);
      const turn = (this.phase2 ? 1.15 : 0.95) * (this.state === 'breath' ? 0.7 : 1);
      const dy = clamp(angleDiff(this.yaw, wantYaw), -turn * dt, turn * dt);
      this.yaw += dy;
      this.pitch += clamp(wantPitch - this.pitch, -0.8 * dt, 0.8 * dt);
      this.bank = damp(this.bank, clamp((-dy / dt) * 0.9, -1.1, 1.1), 3, dt);
    }
    // Steigen kostet Tempo, Sinken bringt Tempo
    wantSpeed -= this.pitch * 18;
    this.speed += clamp(wantSpeed - this.speed, -12 * dt, 12 * dt);
    this._forward(_f);
    this.vel.copy(_f).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    const gh = Math.max(this.terrain.heightAt(this.pos.x, this.pos.z), 0);
    if (this.pos.y < gh + 8) this.pos.y = gh + 8;

    // Zusammenstoss mit dem Spieler: beide werden weggestossen
    if (ctx.playerActive && this.bumpCd <= 0 && dist < 11) {
      this.bumpCd = 1.2;
      _d.subVectors(this.pos, P).normalize();
      this.pos.addScaledVector(_d, 4);
      this._hurt(3);
      this.on.bump?.(_d);
    }

    // Feuer
    const flame = this.fire.update(dt, this.fireWant, this.dragon, this.vel, this.world.burn, this.terrain, (p, r, k) => {
      battle?.onFlame(p, r, k * 0.5, 'enemy');
      if (ctx.playerActive && p.distanceTo(P) < r + 6) this.on.hitPlayer?.(k * 0.03, p);
    });
    this._pose(dt, Math.max(fire, flame), 0, this.roar > 0 ? 1 : 0, P);
    this._updateBalls(dt, ctx);
  }

  _forward(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Modell stellen und animieren */
  _pose(dt, fire, dying, roar = 0, lookAt = null) {
    const root = this.dragon.root;
    root.position.copy(this.pos);
    _e.set(this.pitch, this.yaw, -this.bank - (dying ? this.stateT * 2 : 0), 'YXZ');
    root.quaternion.setFromEuler(_e);
    // Flügelschlag beim Steigen oder wenn zu langsam
    const flap = !dying && (this.pitch > 0.12 || this.speed < 46);
    this.flapAmp = damp(this.flapAmp, flap ? 1 : 0, 3, dt);
    this.flapPhase = (this.flapPhase + dt * 1.6) % 1;
    this.fold = damp(this.fold, dying ? 0.6 : this.pitch < -0.35 ? 0.5 : 0, 3, dt);
    const a = this.anim;
    a.flapPhase = this.flapPhase;
    a.flapAmp = this.flapAmp;
    a.fold = this.fold;
    a.bank = this.bank;
    a.roll = 0;
    a.speed = this.speed;
    a.agl = 99;
    a.hover = 0;
    a.grounded = 0;
    a.fire = fire;
    a.roar = roar;
    a.look = lookAt ? _v.subVectors(lookAt, this.pos).normalize() : null;
    this.dragon.update(dt, a);
  }
}
