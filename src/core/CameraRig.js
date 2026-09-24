// Kamera: folgt dem Drachen weich (Verfolgerkamera), Reiter-Sicht (1. Person),
// Menü-Kamerafahrt und Schaufenster (Anpassen-Menü).
import * as THREE from 'three';
import { clamp, damp, smoothDampVec3 } from './utils.js';
import { settings } from './Settings.js';

const WUP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';
    this.pos = new THREE.Vector3(0, 200, 300);
    this.vel = new THREE.Vector3();
    this.camVelocity = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.lookPos = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.fov = 62;
    this.dist = 30;
    this.zoom = 1;
    this.yawOff = 0;
    this.pitchOff = 0;
    this.shake = 0;
    this.fovKick = 0; // kurzer "Stoss" im Blickwinkel (Boost, Knall)
    this.time = 0;
    this.orbitAngle = 0;
    this.fpQuat = new THREE.Quaternion();
    this.lastLook = -10;
  }

  addShake(a) {
    if (settings.get('cameraShake')) this.shake = Math.min(1.5, this.shake + a);
  }

  /** Blickwinkel kurz aufreissen (in Grad), klingt von selbst ab */
  kick(deg) {
    this.fovKick = Math.min(20, this.fovKick + deg);
  }

  /** Blick mit Maus/Stick (dx, dy in Pixeln bzw. Stick-Werten) */
  look(dx, dy, dt, stick) {
    if (dx || dy) {
      this.yawOff = clamp(this.yawOff - dx * 0.005, -Math.PI, Math.PI);
      this.pitchOff = clamp(this.pitchOff - dy * 0.004, -0.9, 0.9);
      this.lastLook = this.time;
    }
    if (stick && (stick.x || stick.y)) {
      this.yawOff = clamp(this.yawOff - stick.x * 2.2 * dt, -Math.PI, Math.PI);
      this.pitchOff = clamp(this.pitchOff - stick.y * 1.5 * dt, -0.9, 0.9);
      this.lastLook = this.time;
    }
    // nach 1.5 s ohne Eingabe zurück hinter den Drachen
    if (this.time - this.lastLook > 1.5) {
      this.yawOff = damp(this.yawOff, 0, 2.5, dt);
      this.pitchOff = damp(this.pitchOff, 0, 2.5, dt);
    }
  }

  setZoom(wheel) {
    if (wheel) this.zoom = clamp(this.zoom + wheel * 0.1, 0.55, 2.2);
  }

  snap() {
    // Kamera sofort an die Zielposition setzen (nach Teleport)
    this._snap = true;
  }

  /**
   * t = { pos, quat, vel, speed, hover, grounded, boost }
   */
  update(dt, t, terrain, dragon) {
    this.time += dt;
    const cam = this.camera;
    this.prev.copy(cam.position);

    if (this.mode === 'chase') this._chase(dt, t, terrain);
    else if (this.mode === 'first') this._first(dt, t, dragon);
    else if (this.mode === 'orbit') this._orbit(dt, t, terrain);
    else if (this.mode === 'showcase') this._showcase(dt, t);

    // Wackeln (Aufprall, Boost, Donner)
    if (this.shake > 0.001) {
      const s = this.shake * 0.6;
      const tt = this.time * 23;
      cam.position.x += (Math.sin(tt * 1.3) + Math.sin(tt * 2.9)) * s * 0.5;
      cam.position.y += (Math.sin(tt * 1.7 + 1) + Math.sin(tt * 3.3)) * s * 0.5;
      cam.position.z += Math.sin(tt * 2.1 + 2) * s * 0.5;
      this.shake = damp(this.shake, 0, 3, dt);
    }
    this.fovKick *= Math.exp(-2.5 * dt);
    cam.fov = this.fov + this.fovKick;
    cam.updateProjectionMatrix();
    if (dt > 0) this.camVelocity.copy(cam.position).sub(this.prev).divideScalar(dt);
    if (this.camVelocity.lengthSq() > 250 * 250) this.camVelocity.setLength(250);
  }

  _chase(dt, t, terrain) {
    const cam = this.camera;
    _f.set(0, 0, -1).applyQuaternion(t.quat);
    _u.set(0, 1, 0).applyQuaternion(t.quat);
    // Richtung: Mischung aus Blickrichtung und Flugrichtung
    if (t.speed > 6 && !t.grounded) _d.copy(t.vel).normalize().lerp(_f, 0.45).normalize();
    else _d.copy(_f);
    if (t.hover || t.grounded) _d.y *= 0.3;
    _d.y = clamp(_d.y, -0.75, 0.75);
    _d.normalize();
    // Maus/Stick-Versatz
    _q.setFromAxisAngle(WUP, this.yawOff);
    _d.applyQuaternion(_q);
    _r.crossVectors(_d, WUP).normalize();
    _q.setFromAxisAngle(_r, this.pitchOff);
    _d.applyQuaternion(_q);

    const speedK = clamp((t.speed - 20) / 100, 0, 1);
    const dist = (26 + speedK * 10 + (t.hover ? 4 : 0)) * this.zoom;
    const height = (6.5 + (t.grounded ? 2 : 0)) * this.zoom;
    _t.copy(t.pos).addScaledVector(_d, -dist).addScaledVector(WUP, height).addScaledVector(_u, 1.5);

    if (this._snap) {
      this.pos.copy(_t);
      this.vel.set(0, 0, 0);
      this._snap = false;
    } else {
      smoothDampVec3(this.pos, _t, this.vel, t.hover ? 0.32 : 0.2, dt);
    }
    // nicht in den Boden
    const minY = terrain.surfaceAt(this.pos.x, this.pos.z) + 3;
    if (this.pos.y < minY) {
      this.pos.y = minY;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    cam.position.copy(this.pos);
    // Leichte Schräglage mit dem Drachen (filmisch)
    _t.copy(WUP).lerp(_u, 0.22).normalize();
    this.up.lerp(_t, 1 - Math.exp(-4 * dt)).normalize();
    cam.up.copy(this.up);
    _look.copy(t.pos).addScaledVector(_f, 9).addScaledVector(WUP, 2.5);
    this.lookPos.lerp(_look, 1 - Math.exp(-12 * dt));
    cam.lookAt(this.lookPos);
    const targetFov = 62 + speedK * 22 + (t.boost ? 6 : 0) + (t.dive || 0) * 8;
    this.fov = damp(this.fov, targetFov, 3, dt);
  }

  _first(dt, t, dragon) {
    const cam = this.camera;
    dragon.getRiderEye(_t);
    cam.position.copy(_t);
    // Blick = Drachen-Richtung, leicht nach unten (Hals sichtbar) + Umsehen
    _e.set(-0.16 + this.pitchOff, this.yawOff, 0, 'YXZ');
    _q2.setFromEuler(_e);
    _q.copy(t.quat).multiply(_q2);
    this.fpQuat.slerp(_q, this._snap ? 1 : 1 - Math.exp(-10 * dt));
    this._snap = false;
    cam.quaternion.copy(this.fpQuat);
    cam.up.set(0, 1, 0);
    const speedK = clamp((t.speed - 20) / 100, 0, 1);
    this.fov = damp(this.fov, 74 + speedK * 16 + (t.boost ? 5 : 0), 3, dt);
    this.pos.copy(cam.position);
    this.vel.set(0, 0, 0);
    this.lookPos.copy(t.pos);
  }

  _orbit(dt, t, terrain) {
    // Langsame Kamerafahrt um den Drachen (Hauptmenü)
    const cam = this.camera;
    this.orbitAngle += dt * 0.07;
    const r = 55 + Math.sin(this.time * 0.13) * 15;
    _t.set(t.pos.x + Math.cos(this.orbitAngle) * r, t.pos.y + 12 + Math.sin(this.time * 0.21) * 8, t.pos.z + Math.sin(this.orbitAngle) * r);
    const minY = terrain.surfaceAt(_t.x, _t.z) + 5;
    _t.y = Math.max(_t.y, minY);
    this.pos.lerp(_t, 1 - Math.exp(-2 * dt));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    this.lookPos.lerp(t.pos, 1 - Math.exp(-4 * dt));
    cam.lookAt(this.lookPos);
    this.fov = damp(this.fov, 50, 2, dt);
  }

  _showcase(dt, t) {
    // Schaufenster: Drache links im Bild, Menü rechts
    const cam = this.camera;
    // Kamera bleibt auf der Sonnenseite (sonst steht der Drache im Gegenlicht)
    this.orbitAngle += dt * 0.25;
    const sunAz = this.sunDir ? Math.atan2(this.sunDir.z, this.sunDir.x) : 0;
    const a = sunAz + Math.sin(this.orbitAngle) * 0.9;
    const r = 24;
    _t.set(t.pos.x + Math.cos(a) * r, t.pos.y + 3 + Math.sin(a * 0.7) * 2, t.pos.z + Math.sin(a) * r);
    this.pos.lerp(_t, 1 - Math.exp(-3 * dt));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    // Blickpunkt rechts vom Drachen → Drache erscheint links
    _d.copy(t.pos).sub(this.pos).normalize();
    _r.crossVectors(_d, WUP).normalize();
    _look.copy(t.pos).addScaledVector(_r, 7).add(_u.set(0, 1, 0));
    this.lookPos.lerp(_look, 1 - Math.exp(-6 * dt));
    cam.lookAt(this.lookPos);
    this.fov = damp(this.fov, 45, 3, dt);
  }
}

