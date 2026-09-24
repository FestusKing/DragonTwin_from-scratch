// Feuer speien: Partikel-Kegel aus dem Maul, Glut und Funken, eine Flammenwalze am Boden,
// ein flackerndes Licht und eine "Hitze"-Anzeige. Zu lange Feuer → Überhitzung → Flamme wird klein,
// bis der Drache abgekühlt ist.
import * as THREE from 'three';
import { damp } from '../core/utils.js';
import { WATER_LEVEL } from '../world/Terrain.js';

const OVERHEAT_TIME = 4.2; // Sekunden Dauerfeuer bis zur Überhitzung
const COOL_TIME = 2.8; // Sekunden zum kompletten Abkühlen
const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up2 = new THREE.Vector3();

export class FireBreath {
  constructor(scene, particles, quality = 1) {
    this.particles = particles;
    this.q = quality;
    this.heat = 0;
    this.overheated = false;
    this.intensity = 0;
    this.acc = 0;
    this.smokeAcc = 0;
    this.emberAcc = 0;
    this.splashAcc = 0;
    this.time = 0;
    this.color = new THREE.Color(0xff8a30);
    // Licht, das die Umgebung beleuchtet
    this.light = new THREE.PointLight(0xff8a30, 0, 120, 2);
    this.light.castShadow = false;
    scene.add(this.light);
    this.onOverheat = null;
    this.onIgnite = null;
  }

  setPalette(colors) {
    const c = colors.map((h) => new THREE.Color(h));
    this.particles.fire.setColors(c[0], c[1], c[2]);
    this.color.copy(c[1]);
    this.light.color.copy(c[1]);
  }

  /**
   * @param wants   Taste gedrückt?
   * @param dragon  Dragon (für die Maul-Position)
   * @param vel     Geschwindigkeit des Drachen
   * @param burn    BurnSystem (zum Anzünden)
   */
  update(dt, wants, dragon, vel, burn, terrain) {
    this.time += dt;
    if (this.overheated && this.heat < 0.35) this.overheated = false;
    const active = wants && !this.overheated;
    let target = 0;
    if (active) target = 1;
    else if (wants && this.overheated) target = 0.12 + Math.max(0, Math.sin(this.time * 23)) * 0.12; // stottern
    this.intensity = damp(this.intensity, target, active ? 12 : 9, dt);

    if (active) {
      this.heat += dt / OVERHEAT_TIME;
      if (this.heat >= 1) {
        this.heat = 1;
        this.overheated = true;
        this.onOverheat?.();
      }
    } else {
      this.heat = Math.max(0, this.heat - dt / (wants ? COOL_TIME * 1.8 : COOL_TIME));
    }

    const I = this.intensity;
    if (I < 0.02) {
      this.light.intensity = 0;
      return 0;
    }
    dragon.getMouth(_pos, _dir);
    // Seitenvektoren für die Streuung
    _side.set(0, 1, 0).cross(_dir).normalize();
    _up2.copy(_dir).cross(_side).normalize();

    // Partikel ausstossen
    this.acc += 420 * I * this.q * dt;
    const n = Math.floor(this.acc);
    this.acc -= n;
    const fire = this.particles.fire;
    for (let i = 0; i < n; i++) {
      const spread = 0.07 + (1 - I) * 0.1;
      const a = (Math.random() - 0.5) * 2 * spread;
      const b = (Math.random() - 0.5) * 2 * spread;
      const sp = (50 + Math.random() * 18) * (0.55 + 0.45 * I);
      _v.copy(_dir).addScaledVector(_side, a).addScaledVector(_up2, b).normalize().multiplyScalar(sp).addScaledVector(vel, 0.95);
      const f = Math.random() * dt; // gleichmässig im Zeitschritt verteilen
      fire.spawn(
        _pos.x + _v.x * f, _pos.y + _v.y * f, _pos.z + _v.z * f,
        _v.x, _v.y, _v.z,
        0.5 + Math.random() * 0.4,
        0.7 + Math.random() * 0.5,
        (1.5 + Math.random() * 4.2) * (0.4 + 0.6 * I)
      );
    }

    // Glut und Funken, die aus der Flamme stieben
    this.emberAcc += 70 * I * this.q * dt;
    const sparks = this.particles.sparks;
    while (this.emberAcc >= 1) {
      this.emberAcc -= 1;
      const d = 3 + Math.random() * 18;
      const sp = 25 + Math.random() * 25;
      _p.copy(_pos).addScaledVector(_dir, d);
      sparks.spawn(
        _p.x, _p.y, _p.z,
        _dir.x * sp + vel.x + (Math.random() - 0.5) * 14, _dir.y * sp + vel.y + Math.random() * 8, _dir.z * sp + vel.z + (Math.random() - 0.5) * 14,
        0.6 + Math.random() * 0.8, 0.35, 0.1, 1, 0.55 + Math.random() * 0.35, 0.2
      );
    }

    // Licht in der Flamme, flackernd
    const flick = 0.75 + Math.sin(this.time * 31) * 0.12 + Math.sin(this.time * 17.3) * 0.13;
    this.light.position.copy(_pos).addScaledVector(_dir, 10 * I).addScaledVector(vel, 0.1);
    this.light.intensity = 450 * I * flick;

    // Hitze entlang der Flamme verteilen → Dinge fangen Feuer
    const len = 42 * I;
    for (let s = 3; s <= len; s += 3) {
      const t = s / 52;
      _p.copy(_pos).addScaledVector(_dir, s).addScaledVector(vel, t * 0.95);
      const gh = terrain.heightAt(_p.x, _p.z);
      if (_p.y < WATER_LEVEL + 0.8 && gh < WATER_LEVEL) {
        // Wasser: Dampf
        if (Math.random() < 0.5) this.particles.spray.spawn(_p.x, 0.5, _p.z, (Math.random() - 0.5) * 4, 5 + Math.random() * 6, (Math.random() - 0.5) * 4, 1.5, 3, 12);
        break;
      }
      if (_p.y < gh + 1.5) {
        // Boden getroffen: Brandfleck + Feuer breitet sich am Boden aus
        terrain.paintScorch(_p.x, _p.z, 3 + s * 0.12, dt * 1.2 * I);
        burn?.applyHeat(_p, 4 + s * 0.15, dt * 2.5 * I, this.onIgnite);
        this._groundSplash(_p, gh, dt, I);
        if (Math.random() < 0.3 * I) {
          this.particles.smoke.spawn(_p.x, gh + 1, _p.z, (Math.random() - 0.5) * 3, 3, (Math.random() - 0.5) * 3, 2.5, 3, 11);
        }
        break;
      }
      burn?.applyHeat(_p, 2.5 + s * 0.22, dt * 2.2 * I, this.onIgnite);
    }

    // etwas Rauch am Ende der Flamme
    this.smokeAcc += 25 * I * this.q * dt;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      _p.copy(_pos).addScaledVector(_dir, len * (0.7 + Math.random() * 0.3)).addScaledVector(vel, 0.6);
      this.particles.smoke.spawn(_p.x, _p.y, _p.z, vel.x * 0.4, 2, vel.z * 0.4, 2 + Math.random(), 3, 10);
    }
    return I;
  }

  /** Flammenwalze: Wo das Feuer auf den Boden trifft, spritzen Flammen und Funken zur Seite. */
  _groundSplash(p, gh, dt, I) {
    this.splashAcc += 140 * I * this.q * dt;
    const fire = this.particles.fire;
    const sparks = this.particles.sparks;
    while (this.splashAcc >= 1) {
      this.splashAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 16;
      fire.spawn(
        p.x, gh + 0.8, p.z,
        Math.cos(a) * sp + _dir.x * 12, 2 + Math.random() * 7, Math.sin(a) * sp + _dir.z * 12,
        0.5 + Math.random() * 0.5, 1.2 + Math.random() * 0.8, 3 + Math.random() * 4
      );
      if (Math.random() < 0.4) {
        sparks.spawn(p.x, gh + 1, p.z, Math.cos(a) * sp * 0.8, 8 + Math.random() * 14, Math.sin(a) * sp * 0.8, 0.8 + Math.random() * 0.8, 0.35, 0.1, 1, 0.6, 0.2);
      }
    }
  }
}
