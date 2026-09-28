// Tod des Drachen (Leben = 0) als kleine Szene statt sofortigem Neustart:
//  1) Absturz: Der Drache ist bewusstlos, trudelt mit Rauch zu Boden (keine Steuerung mehr).
//  2) Aufprall: Staub, Beben, Krach – er rutscht noch ein Stück und bleibt auf der Seite liegen.
//  3) Liegen: "DU BIST GEFALLEN", die Kamera zieht langsam zurück.
//  4) Das Bild wird schwarz.
//  5) Im Hort: Das Bild wird wieder hell, der Drache rappelt sich auf, schüttelt sich, brüllt.
// Die Flugphysik wird dafür nicht benutzt: Diese Klasse bewegt Position und Drehung selbst.
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/utils.js';
import { STAND_HEIGHT } from '../dragon/Dragon.js';

const LIE_HEIGHT = 1.5; // Körpermitte über dem Boden, wenn der Drache auf der Seite liegt
const SLIDE_TIME = 1.2;
const DOWN_TIME = 2.4;
const FADE_TIME = 1.0;
const WAKE_TIME = 3.2;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class DeathSequence {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.phase = '';
    this.t = 0;
    this.fade = 0; // 0 = normal, 1 = schwarz
    this.vel = new THREE.Vector3();
    this.spin = 1;
    this.side = 1; // auf welche Seite er fällt
    this.lieQ = new THREE.Quaternion();
    this.standQ = new THREE.Quaternion();
    this.smokeT = 0;
    this.zoom0 = 1;
    this.anim = { dead: 0, crouch: 0 };
  }

  /** Leben ist aufgebraucht → Absturz beginnt */
  start() {
    const g = this.game;
    const p = g.physics;
    this.active = true;
    this.t = 0;
    this.fade = 0;
    this.vel.copy(p.velocity);
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (1.3 + Math.random() * 0.7);
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.zoom0 = g.rig.zoom;
    g.landing = false;
    g.lockOn = false;
    p.hovering = false;
    g.hud.center('ABGESTÜRZT', '', 1.8);
    g.hud.doFlash(0.5);
    g.rig.addShake(1.2);
    g.audio.playImpact(1.2);
    g.audio.playRoar(0.7, 0.8); // Schmerzensschrei (tiefer)
    if (p.grounded) this._impact(0.6);
    else this.phase = 'fall';
  }

  /** Animations-Werte für Dragon.update() anpassen */
  decorate(a) {
    if (!this.active) return;
    const A = this.anim;
    a.dead = A.dead;
    a.crouch = A.crouch;
    a.flapAmp = (a.flapAmp || 0) * (1 - A.dead);
    a.fire = 0;
    a.roar = this.phase === 'wake' && this.t > 2.2 && this.t < 3.0 ? 1 : 0;
    a.land = false;
    if (this.phase !== 'fall') a.grounded = 1;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const p = g.physics;
    const T = g.world.terrain;
    const pos = p.position;
    this.t += dt;
    const A = this.anim;

    switch (this.phase) {
      case 'fall': {
        // bewusstlos: Schwerkraft, etwas Luftwiderstand, trudeln (rollen + Nase runter)
        A.dead = 1;
        A.crouch = 0;
        this.vel.y -= 9.81 * 1.15 * dt;
        this.vel.multiplyScalar(Math.exp(-0.18 * dt));
        if (this.vel.y < -60) this.vel.y = -60;
        pos.addScaledVector(this.vel, dt);
        _q.setFromAxisAngle(_z.set(0, 0, 1), this.spin * dt);
        p.quaternion.multiply(_q);
        p.forward(_f);
        if (_f.y > -0.7) {
          _q.setFromAxisAngle(_x.set(1, 0, 0), -0.9 * dt);
          p.quaternion.multiply(_q);
        }
        p.quaternion.normalize();
        // Rauch und Glut hinter dem Drachen
        this.smokeT -= dt;
        if (this.smokeT <= 0) {
          this.smokeT = 0.04;
          const P = g.world.particles;
          P.smoke.spawn(pos.x, pos.y, pos.z, 0, 2, 0, 3, 4, 12);
          if (Math.random() < 0.5) P.sparks.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 6, 4, (Math.random() - 0.5) * 6, 1.2, 1.2, 0.5, 1, 0.5, 0.2);
        }
        const surface = Math.max(T.heightAt(pos.x, pos.z), 0);
        if (pos.y - 2 <= surface || this.t > 9) this._impact(clamp(-this.vel.y / 30, 0.6, 1.5));
        break;
      }
      case 'slide': {
        // nach dem Aufprall noch ein Stück rutschen, dann liegen bleiben
        const k = Math.exp(-2.6 * dt);
        this.vel.x *= k;
        this.vel.z *= k;
        pos.x += this.vel.x * dt;
        pos.z += this.vel.z * dt;
        this._lie(dt, 6);
        A.crouch = 0.8; // Beine angezogen
        if (Math.hypot(this.vel.x, this.vel.z) > 3 && Math.random() < dt * 20) {
          _v.copy(pos).setY(pos.y - 1.2);
          g.world.particles.dust(_v, 0.35);
        }
        if (this.t > SLIDE_TIME) this._next('down');
        break;
      }
      case 'down': {
        this._lie(dt, 3);
        A.dead = 1;
        A.crouch = 0.8;
        // Kamera zieht langsam zurück
        g.rig.zoom += (Math.max(this.zoom0, 1.45) - g.rig.zoom) * (1 - Math.exp(-0.8 * dt));
        if (this.t > 0.4 && !this.shownText) {
          this.shownText = true;
          g.hud.center('DU BIST GEFALLEN', 'Du erwachst in deinem Hort im Vulkan …', DOWN_TIME + FADE_TIME);
        }
        if (Math.random() < dt * 2) g.world.particles.smoke.spawn(pos.x, pos.y, pos.z, 0, 1.5, 0, 3, 4, 10);
        if (this.t > DOWN_TIME) this._next('fade');
        break;
      }
      case 'fade': {
        this._lie(dt, 3);
        this.fade = smoothstep(0, FADE_TIME, this.t);
        if (this.t > FADE_TIME) this._toHoard();
        break;
      }
      case 'wake': {
        // Bild wird hell, der Drache rappelt sich auf
        const t = this.t;
        this.fade = 1 - smoothstep(0.2, 1.2, t);
        const up = smoothstep(0.9, 2.2, t); // 0 = liegt, 1 = steht
        A.dead = 1 - smoothstep(0.7, 1.6, t);
        A.crouch = (1 - smoothstep(1.6, 2.6, t)) * 1.1;
        p.quaternion.slerpQuaternions(this.lieQ, this.standQ, up);
        const surface = Math.max(T.heightAt(pos.x, pos.z), 0);
        pos.y = surface + LIE_HEIGHT + (STAND_HEIGHT - LIE_HEIGHT) * up;
        g.rig.zoom += (this.zoom0 - g.rig.zoom) * (1 - Math.exp(-1.5 * dt));
        if (t > 2.2 && !this.roared) {
          this.roared = true;
          g.audio.playRoar(1, 1);
          g.rig.addShake(0.5);
        }
        if (t > WAKE_TIME) this._finish();
        break;
      }
    }
    p.velocity.copy(this.phase === 'fall' || this.phase === 'slide' ? this.vel : _v.set(0, 0, 0));
    p.speed = p.velocity.length();
    p.agl = pos.y - Math.max(T.heightAt(pos.x, pos.z), 0);
  }

  _next(phase) {
    this.phase = phase;
    this.t = 0;
  }

  /** Auf der Seite liegen, dem Hang angepasst. k = wie schnell er in die Lage kippt */
  _lie(dt, k) {
    const p = this.game.physics;
    const T = this.game.world.terrain;
    const pos = p.position;
    const gh = T.heightAt(pos.x, pos.z);
    const water = gh < 0;
    const surface = Math.max(gh, 0);
    pos.y += (surface + (water ? 0.6 : LIE_HEIGHT) - pos.y) * (1 - Math.exp(-8 * dt));
    this._orient(this.lieQ, pos, water, this.side * 1.25);
    p.quaternion.slerp(this.lieQ, 1 - Math.exp(-k * dt));
  }

  /** Drehung: Blickrichtung des Drachen, dem Boden angepasst, um "roll" auf die Seite gekippt */
  _orient(out, pos, water, roll) {
    const g = this.game;
    const p = g.physics;
    p.forward(_f).setY(0);
    if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1);
    _f.normalize();
    if (water) _n.copy(UP);
    else g.world.terrain.normalAt(pos.x, pos.z, _n);
    _x.crossVectors(_f, _n).normalize(); // rechts
    _z.crossVectors(_n, _x).normalize(); // vorne am Hang
    _m.makeBasis(_x, _n, _z.negate());
    out.setFromRotationMatrix(_m);
    if (roll) out.multiply(_q2.setFromAxisAngle(_v.set(0, 0, 1), roll));
    return out;
  }

  _impact(strength) {
    const g = this.game;
    const p = g.physics;
    const w = g.world;
    const pos = p.position;
    const gh = w.terrain.heightAt(pos.x, pos.z);
    const water = gh < 0;
    pos.y = Math.max(gh, 0) + (water ? 0.6 : LIE_HEIGHT);
    this.vel.y = 0;
    this.vel.multiplyScalar(0.45);
    p.grounded = true;
    p.hovering = false;
    p.walkSpeed = 0;
    _v.copy(pos).setY(pos.y - 1);
    if (water) {
      g._splash(1.3);
    } else {
      w.particles.dust(_v, 1.6 + strength);
      g.speedFx.shock(_v, UP, { r0: 3, r1: 22 + 12 * strength, dur: 0.9, opacity: 0.4, color: 0x8a7a62 });
      g.audio.playImpact(1.4);
      g.audio.playCollapse(0.8, true);
      w.destruction.blast(_v, 12, 1.2 * strength, 'player');
      g.battle.onImpact(_v, 1.2);
    }
    g.rig.addShake(1.4);
    g.hud.doFlash(0.3);
    this.shownText = false;
    this._next('slide');
  }

  /** Bild ist schwarz → in den Hort versetzen, liegend */
  _toHoard() {
    const g = this.game;
    const p = g.physics;
    const T = g.world.terrain;
    const h = g.world.volcano.hoard;
    const x = h.x;
    const z = h.z + 14;
    const V3 = p.position.constructor;
    p.reset(new V3(x, Math.max(T.heightAt(x, z), 0) + LIE_HEIGHT, z), Math.PI, 0); // Blick nach Norden auf den Lava-See
    p.grounded = true;
    p.walkSpeed = 0;
    p.stamina = 1;
    this.side = -this.side;
    this._orient(this.standQ, p.position, false, 0);
    this._orient(this.lieQ, p.position, false, this.side * 1.25);
    p.quaternion.copy(this.lieQ);
    g.rig.snap();
    g.adv.onRespawned();
    this.roared = false;
    this._next('wake');
  }

  _finish() {
    const g = this.game;
    const p = g.physics;
    p.quaternion.copy(this.standQ);
    const T = g.world.terrain;
    p.position.y = Math.max(T.heightAt(p.position.x, p.position.z), 0) + STAND_HEIGHT;
    p.grounded = true;
    this.active = false;
    this.fade = 0;
    this.anim.dead = 0;
    this.anim.crouch = 0;
    this.phase = '';
    g.rig.zoom = this.zoom0;
    g.hud.toast('🔥 Im Hort erwacht', `Leben und Ausdauer sind wieder voll. Abheben mit ${g._key('flap')}.`, 4);
  }

  /** Sofort beenden (z. B. Neustart, Menü) */
  cancel() {
    if (!this.active) return;
    this.active = false;
    this.fade = 0;
    this.anim.dead = 0;
    this.anim.crouch = 0;
    this.phase = '';
    this.game.rig.zoom = this.zoom0;
  }
}
