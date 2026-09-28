// Zerstörbare Gebäude: Hier steht, WIE Gebäude einstürzen.
// Settlement.js meldet jedes Gebäude als "Bauwerk" (structure) mit seinen Teilen.
//  - hut:      Dach sackt ein, Wände brechen zusammen, Trümmer fliegen, ein Schutthaufen
//              mit verkohlten Balken bleibt (der Kamin aus Stein bleibt oft stehen)
//  - tower:    Wachturm kippt um (dreht sich um die Kante am Boden) und schlägt auf
//  - windmill: Flügel brechen ab und fallen, die Kappe stürzt ein, der Turm bleibt als Ruine
//  - stall:    Marktstand knickt zusammen
//  - tent:     Zelt im Heerlager fällt flach zusammen
//  - cart:     Belagerungs-Armbrust auf dem Karren zerbricht
// Auslöser:
//  - Feuer: brennt ein Gebäude lange genug, stürzt es ein
//  - Wucht: der Drache kracht hinein, landet daneben, beisst zu oder trampelt,
//    Feuerbälle explodieren. Wucht zieht "Stabilität" (hp) ab – bei 0 stürzt es ein.
// Die Trümmer selbst fliegen im Trümmer-System (fx/Debris.js).
// "Neustart" baut alles wieder auf.
import * as THREE from 'three';
import { surfaceMaterial } from '../fx/Textures.js';
import { box } from './BuildingGeo.js';
import { clamp, smoothstep, mulberry32 } from '../core/utils.js';

const G = 9.81;
const HP = { hut: 1, tower: 1.3, windmill: 1.8, stall: 0.3, tent: 0.3, cart: 0.6 };
// ab diesem Brand-Fortschritt (0..1) stürzt es ein
const FIRE_AT = { hut: 0.72, tower: 0.55, windmill: 0.6, stall: 0.45, tent: 0.55, cart: 2 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Destruction {
  constructor(terrain, particles, debris, structures) {
    this.terrain = terrain;
    this.particles = particles;
    this.debris = debris;
    this.list = structures;
    this.anims = []; // Bauwerke, die gerade einstürzen
    this.rnd = mulberry32(77);
    this.mats = {
      rubble: surfaceMaterial('stein', { color: 0x8a7f72, roughness: 1 }, { avgColor: 0x7e7466, roughness: 1 }),
      rubbleChar: surfaceMaterial('stein', { color: 0x2e2824, roughness: 1 }, { avgColor: 0x2b2622, roughness: 1 }),
      beam: surfaceMaterial('holz', { color: 0x6b5a4a, roughness: 0.9 }, { avgColor: 0x5a4a3e, roughness: 1 }),
      beamChar: surfaceMaterial('holz', { color: 0x221a15, roughness: 0.95 }, { avgColor: 0x1e1814, roughness: 1 }),
    };
    for (const st of structures) this._register(st);
    // Ereignisse (setzt Game.js)
    this.onCollapse = null; // (Bauwerk, Ursache 'fire'|'force', von wem 'player'|'enemy')
    this.onDamage = null; // (Bauwerk, Schaden, von wem) – beschädigt, steht aber noch
    this.onThud = null; // (Position, Stärke) – schwerer Aufschlag (Turm, Mühlenflügel)
  }

  _register(st) {
    st.hp = HP[st.kind] ?? 1;
    st.state = 'intact'; // intact → falling → down
    st.onFire = (t) => this._onFire(st, t);
    st.onReset = () => this._restore(st);
  }

  /** Später gebaute Bauwerke anmelden (Zelte im Heerlager, Belagerungs-Armbrüste) */
  add(st) {
    if (!this.list.includes(st)) this.list.push(st);
    this._register(st);
    if (st.burn && !st.burn0) st.burn0 = { x: st.burn.x, y: st.burn.y, z: st.burn.z, h: st.burn.h, w: st.burn.w, d: st.burn.d, rot: st.burn.rot };
    return st;
  }

  /** Brand-Fortschritt eines Gebäudes (von Settlement → BurnSystem) */
  _onFire(st, t) {
    if (st.state === 'intact' && t >= (FIRE_AT[st.kind] ?? 0.7)) this.collapse(st, 'fire', 'player');
    // brennt der Schutthaufen eines umgestossenen Hauses, wird er schwarz
    if (st.ruin && t > 0.3) st.ruin.userData.char?.();
  }

  // ------------------------------------------------------------ Wucht
  /**
   * Wucht an einem Punkt: alle Gebäude im Umkreis verlieren Stabilität.
   * dir = Stossrichtung (dann fallen Trümmer und Türme in diese Richtung)
   */
  blast(p, radius, power, src = 'player', dir = null) {
    let hits = 0;
    for (const st of this.list) {
      if (st.state !== 'intact') continue;
      const d = Math.max(0, Math.hypot(p.x - st.x, p.z - st.z) - st.r);
      if (d > radius) continue;
      if (p.y > st.top + radius || p.y < st.base - 4) continue;
      const dmg = power * (1 - d / radius);
      if (dmg < 0.02) continue;
      st.hp -= dmg;
      hits++;
      const push = dir ? _w.copy(dir) : _w.set(st.x - p.x, 0, st.z - p.z);
      push.y = 0;
      if (push.lengthSq() < 1e-4) push.set(1, 0, 0);
      push.normalize();
      if (st.hp <= 0) this.collapse(st, 'force', src, push);
      else {
        this._chips(st, p, push, dmg);
        this.onDamage?.(st, dmg, src);
      }
    }
    return hits;
  }

  /** Der Drache kracht irgendwo hinein (Aufprall). s = Stärke 0.3 … 1.5 */
  impact(p, s, dir = null) {
    return this.blast(p, 9, s * 1.8, 'player', dir);
  }

  /** Beschädigt: ein paar Stücke platzen ab, etwas Staub */
  _chips(st, p, push, dmg) {
    const n = 2 + Math.round(dmg * 5);
    const kind = st.kind === 'hut' ? 'wall' : 'plank';
    for (let i = 0; i < n; i++) {
      _p.set(st.x - push.x * st.r * 0.8 + (Math.random() - 0.5) * 3, clamp(p.y, st.base + 1, st.top - 1) + (Math.random() - 0.5) * 2, st.z - push.z * st.r * 0.8 + (Math.random() - 0.5) * 3);
      _v.copy(push).multiplyScalar(-2 - Math.random() * 3);
      _v.y = 2 + Math.random() * 3;
      this.debris.spawn(kind, _p, _v, { tint: this._tint(st), size: 0.7 });
    }
    _p.set(st.x - push.x * st.r, st.base + 1, st.z - push.z * st.r);
    this.particles.dust(_p, 0.5 + dmg);
  }

  _tint(st) {
    return st.burn && st.burn.state !== 0 ? 0.2 + Math.random() * 0.1 : 1;
  }

  // ------------------------------------------------------------ Einsturz
  collapse(st, cause, src = 'player', dir = null) {
    if (st.state !== 'intact') return;
    st.state = 'falling';
    st.cause = cause;
    st.charred = cause === 'fire' || (st.burn && st.burn.state !== 0);
    st.t = 0;
    st.dir = (dir ? dir.clone() : new THREE.Vector3(Math.cos(this.rnd() * 6.28), 0, Math.sin(this.rnd() * 6.28))).setY(0).normalize();
    if (st.kind === 'hut') this._startHut(st);
    else if (st.kind === 'tower') this._startTower(st);
    else if (st.kind === 'windmill') this._startMill(st);
    else if (st.kind === 'stall') this._startStall(st);
    else if (st.kind === 'tent') this._startTent(st);
    else if (st.kind === 'cart') this._startCart(st);
    this.anims.push(st);
    this.onCollapse?.(st, cause, src);
  }

  // ---------------- Hütte ----------------
  _local(st, lx, ly, lz, out) {
    const c = Math.cos(st.rot);
    const s = Math.sin(st.rot);
    return out.set(st.x + lx * c + lz * s, ly, st.z - lx * s + lz * c);
  }

  _startHut(st) {
    const P = st.parts;
    const rnd = this.rnd;
    const tint = st.charred ? 0.22 : 1;
    const { w, d, y1, wallH, roofH } = st;
    const c = Math.cos(st.rot);
    const s = Math.sin(st.rot);
    const push = st.cause === 'force' ? st.dir : null;
    // Wandstücke fliegen von den 4 Seiten weg
    const nWall = Math.round((w + d) * 0.9);
    for (let i = 0; i < nWall; i++) {
      const u = rnd() * (2 * w + 2 * d);
      let lx;
      let lz;
      let nx = 0;
      let nz = 0;
      if (u < w) [lx, lz, nz] = [u - w / 2, d / 2, 1];
      else if (u < 2 * w) [lx, lz, nz] = [u - w * 1.5, -d / 2, -1];
      else if (u < 2 * w + d) [lx, lz, nx] = [w / 2, u - 2 * w - d / 2, 1];
      else [lx, lz, nx] = [-w / 2, u - 2 * w - d * 1.5, -1];
      this._local(st, lx, y1 + rnd() * wallH, lz, _p);
      _n.set(nx * c + nz * s, 0, -nx * s + nz * c);
      _v.copy(_n).multiplyScalar(1.2 + rnd() * 3.5);
      _v.y = 0.5 + rnd() * 3;
      if (push) _v.addScaledVector(push, 3 + rnd() * 4);
      this.debris.spawn('wall', _p, _v, { tint });
    }
    // Balken
    for (let i = 0; i < 10; i++) {
      this._local(st, (rnd() - 0.5) * w, y1 + wallH * (0.5 + rnd() * 0.7), (rnd() - 0.5) * d, _p);
      _v.set((rnd() - 0.5) * 6, 2 + rnd() * 4, (rnd() - 0.5) * 6);
      if (push) _v.addScaledVector(push, 2 + rnd() * 3);
      this.debris.spawn('plank', _p, _v, { tint: st.charred ? 0.15 : 0.9 });
    }
    // Dachstücke rutschen vom Dach
    const nRoof = Math.round((w * d) / 6);
    for (let i = 0; i < nRoof; i++) {
      const lx = (rnd() - 0.5) * (w + 1);
      const ly = y1 + wallH + roofH * (1 - Math.abs(lx) / (w / 2 + 0.5)) * 0.9;
      this._local(st, lx, ly, (rnd() - 0.5) * d, _p);
      _n.set(Math.sign(lx) * c, 0, -Math.sign(lx) * s);
      _v.copy(_n).multiplyScalar(0.5 + rnd() * 2.5);
      _v.y = rnd() * 1.5;
      if (push) _v.addScaledVector(push, 1 + rnd() * 3);
      this.debris.spawn(st.tile ? 'tiles' : 'thatch', _p, _v, { tint: st.charred ? 0.2 : 1 });
    }
    // Kamin: aus Stein – bei Feuer bleibt er stehen, bei Wucht bricht er
    if (P.chimney && st.cause === 'force') {
      P.chimney.visible = false;
      const cp = P.chimney.position;
      for (let i = 0; i < 7; i++) {
        this._local(st, cp.x + (rnd() - 0.5), cp.y + (rnd() - 0.5) * 2, cp.z + (rnd() - 0.5), _p);
        _v.set((rnd() - 0.5) * 4, 1 + rnd() * 3, (rnd() - 0.5) * 4);
        if (push) _v.addScaledVector(push, 3);
        this.debris.spawn('stone', _p, _v, { tint: 1 });
      }
    }
    if (st.chimneyRef) st.chimneyRef.alive = false;
    P.door.visible = false;
    P.win.visible = false;
    // Startwerte fürs Einsacken
    st.roofY0 = P.roof.position.y;
    st.roofSY0 = P.roof.scale.y;
    const b = rnd() * 6.28;
    st.tiltAxis = new THREE.Vector3(Math.cos(b), 0, Math.sin(b));
    st.tiltRoof = new THREE.Euler((rnd() < 0.5 ? -1 : 1) * (0.15 + rnd() * 0.2), 0, (rnd() < 0.5 ? -1 : 1) * (0.12 + rnd() * 0.25));
    if (!st.ruin) st.ruin = this._buildRuin(st);
    st.ruin.userData.setChar(st.charred);
    st.ruin.visible = false;
    // Kollision: nur noch ein niedriger Schutthaufen
    const col = st.collider;
    if (col) {
      col.y = st.ground + 0.9;
      col.hy = 0.9;
    }
    // Feuer brennt nun unten im Schutt weiter
    if (st.burn) {
      st.burn.y = st.ground + 1.2;
      st.burn.h = 2.5;
    }
    this._dustRing(st, 1.4);
  }

  _updateHut(st, dt) {
    const P = st.parts;
    const t = st.t;
    // Dach fällt in das Haus und bleibt schief auf dem Schutt liegen
    const drop = Math.min(st.roofY0 - (st.ground + 1.1), 0.5 * G * Math.max(0, t - 0.05) ** 2);
    P.roof.position.y = st.roofY0 - drop;
    const kr = smoothstep(0, 0.9, t);
    P.roof.rotation.set(st.tiltRoof.x * kr, 0, st.tiltRoof.z * kr);
    P.roof.scale.y = st.roofSY0 * (1 - 0.55 * kr);
    // Wände brechen zusammen (um den Fuss gekippt und gestaucht) – Mauerreste bleiben stehen
    const kw = smoothstep(0.15, 1.05, t) ** 1.5;
    const sy = 1 - 0.8 * kw;
    _q.setFromAxisAngle(st.tiltAxis, 0.2 * kw * (1 - 0.75 * smoothstep(0.8, 1.2, t)));
    P.wall.scale.set(1, sy, 1);
    P.wall.quaternion.copy(_q);
    _p.set(0, st.y1 - 0.3, 0);
    _v.set(0, _p.y * sy, 0).applyQuaternion(_q);
    P.wall.position.copy(_p).sub(_v);
    if (t > 0.5) st.ruin.visible = true;
    if (t > 0.3 && !st.dust2) {
      st.dust2 = true;
      this._dustRing(st, 1.0);
    }
    if (t > 1.2) {
      if (st.charred) P.roof.visible = false; // Stroh und Balken sind verbrannt
      return true;
    }
    return false;
  }

  /** Schutthaufen (Hügel aus Trümmern) + stehengebliebene verkohlte Eckbalken */
  _buildRuin(st) {
    const rnd = this.rnd;
    const g = new THREE.Group();
    const W = st.w + 0.6;
    const D = st.d + 0.6;
    const geo = new THREE.PlaneGeometry(W, D, 12, 14);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    const col = new Float32Array(pos.count * 3);
    const hMax = 0.8 + Math.min(st.wallH, 5) * 0.22;
    // ein paar "Buckel" (grosse Trümmer unter dem Schutt)
    const lumps = [];
    for (let i = 0; i < 5; i++) lumps.push([(rnd() - 0.5) * st.w * 0.7, (rnd() - 0.5) * st.d * 0.7, 1 + rnd() * 1.5, 0.3 + rnd() * 0.5]);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const u = lx / (W / 2);
      const v = lz / (D / 2);
      const bump = Math.max(0, 1 - u * u) ** 0.6 * Math.max(0, 1 - v * v) ** 0.6;
      let h = bump * hMax + (rnd() - 0.5) * 0.7 * bump;
      for (const [cx, cz, r, a] of lumps) h += a * bump * Math.max(0, 1 - Math.hypot(lx - cx, lz - cz) / r);
      this._local(st, lx, 0, lz, _p);
      const gy = this.terrain.heightAt(_p.x, _p.z);
      pos.setY(i, gy + h - 0.2);
      uv.setXY(i, (uv.getX(i) * W) / 3, (uv.getY(i) * D) / 3);
      // Farbflecken: heller Putz, braunes Holz, dunkle Stellen
      const r = rnd();
      const c = r < 0.25 ? [1.25, 1.2, 1.1] : r < 0.5 ? [0.85, 0.66, 0.48] : r < 0.65 ? [0.55, 0.52, 0.5] : [1, 0.96, 0.9];
      col.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mound = new THREE.Mesh(geo, this.mats.rubble);
    this.mats.rubble.vertexColors = true;
    this.mats.rubbleChar.vertexColors = true;
    mound.receiveShadow = true;
    mound.castShadow = true;
    g.add(mound);
    // verkohlte Eckpfosten und ein paar schräg liegende Balken
    const beams = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (rnd() < 0.25) continue;
      const h = 1.2 + rnd() * 2.6;
      const lx = sx * (st.w / 2 - 0.3);
      const lz = sz * (st.d / 2 - 0.3);
      this._local(st, lx, 0, lz, _p);
      const b = new THREE.Mesh(box(0.35, h, 0.35, 2), this.mats.beam);
      b.position.set(lx, this.terrain.heightAt(_p.x, _p.z) + h / 2 - 0.2, lz);
      b.rotation.set((rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35);
      beams.push(b);
    }
    for (let i = 0; i < 3; i++) {
      const len = st.d * (0.5 + rnd() * 0.4);
      const b = new THREE.Mesh(box(0.32, 0.32, len, 2), this.mats.beam);
      const lx = (rnd() - 0.5) * st.w * 0.5;
      const lz = (rnd() - 0.5) * st.d * 0.3;
      this._local(st, lx, 0, lz, _p);
      b.position.set(lx, this.terrain.heightAt(_p.x, _p.z) + hMax * (0.6 + rnd() * 0.3), lz);
      b.rotation.set((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 1.2, (rnd() - 0.5) * 0.3);
      beams.push(b);
    }
    for (const b of beams) {
      b.castShadow = true;
      g.add(b);
    }
    g.userData.setChar = (c) => {
      mound.material = c ? this.mats.rubbleChar : this.mats.rubble;
      for (const b of beams) b.material = c ? this.mats.beamChar : this.mats.beam;
    };
    g.userData.char = () => g.userData.setChar(true);
    st.group.add(g);
    return g;
  }

  /** Staubwolke rund um das Gebäude */
  _dustRing(st, k) {
    const sm = this.particles.dustPuffs;
    const n = Math.round(14 * k * (this.particles.q || 1));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = st.r * (0.4 + Math.random() * 0.6);
      sm.spawn(st.x + Math.cos(a) * r, st.ground + 1 + Math.random() * 2, st.z + Math.sin(a) * r, Math.cos(a) * (2 + Math.random() * 4), 1 + Math.random() * 2, Math.sin(a) * (2 + Math.random() * 4), 3.5 + Math.random() * 2.5, 4, 15 + Math.random() * 7);
    }
    _p.set(st.x, st.ground + 0.5, st.z);
    this.particles.dust(_p, k);
    if (st.charred) {
      for (let i = 0; i < 40 * k; i++) {
        this.particles.sparks.spawn(st.x + (Math.random() - 0.5) * st.r, st.ground + 2 + Math.random() * 3, st.z + (Math.random() - 0.5) * st.r, (Math.random() - 0.5) * 8, 5 + Math.random() * 10, (Math.random() - 0.5) * 8, 1 + Math.random() * 1.5, 0.35, 0.1);
      }
    }
  }

  // ---------------- Wachturm ----------------
  _startTower(st) {
    const f = st.dir;
    st.axis = new THREE.Vector3().crossVectors(_up, f).normalize();
    st.pivot = new THREE.Vector3(st.x, st.base, st.z).addScaledVector(f, 2.7);
    st.theta = 0.03;
    st.omega = 0.3;
    st.landed = 0;
    if (st.collider) st.collider.off = true;
    // ein paar Bretter brechen schon beim Kippen ab
    for (let i = 0; i < 5; i++) {
      _p.set(st.x + (Math.random() - 0.5) * 5, st.base + 4 + Math.random() * 8, st.z + (Math.random() - 0.5) * 5);
      _v.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3);
      this.debris.spawn('plank', _p, _v, { tint: st.charred ? 0.15 : 0.9 });
    }
  }

  _updateTower(st, dt) {
    // umkippen wie ein Baum: je schräger, desto schneller
    st.omega += (G / 6.5) * Math.sin(st.theta + 0.05) * dt;
    st.theta += st.omega * dt;
    const maxT = Math.PI / 2 - 0.1;
    if (st.theta >= maxT) {
      st.theta = maxT;
      if (st.landed === 0) {
        st.landed = 1;
        st.omega = -st.omega * 0.15; // kleiner Rückprall
        this._towerHit(st);
      } else st.omega = 0;
    }
    _q.setFromAxisAngle(st.axis, st.theta);
    const g = st.group;
    g.quaternion.copy(_q);
    _v.set(st.x, st.base, st.z).sub(st.pivot).applyQuaternion(_q);
    g.position.copy(st.pivot).add(_v);
    return st.landed === 1 && st.omega === 0;
  }

  _towerHit(st) {
    const f = st.dir;
    const tint = st.charred ? 0.15 : 0.9;
    // Trümmer entlang des Turms, vor allem oben (Plattform und Dach)
    for (let i = 0; i < 18; i++) {
      const k = 4 + Math.random() * 13;
      const gx = st.pivot.x + f.x * k;
      const gz = st.pivot.z + f.z * k;
      _p.set(gx + (Math.random() - 0.5) * 4, this.terrain.heightAt(gx, gz) + 1.5 + Math.random() * 2, gz + (Math.random() - 0.5) * 4);
      _v.set((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7).addScaledVector(f, 3);
      this.debris.spawn(i < 12 ? 'plank' : 'thatch', _p, _v, { tint });
    }
    for (const k of [5, 10, 15]) {
      const gx = st.pivot.x + f.x * k;
      const gz = st.pivot.z + f.z * k;
      _p.set(gx, this.terrain.heightAt(gx, gz) + 0.5, gz);
      this.particles.dust(_p, 1.2);
    }
    _p.set(st.pivot.x + f.x * 12, st.base, st.pivot.z + f.z * 12);
    // Brand zieht mit: Flammen liegen jetzt am Boden entlang des Turms
    if (st.burn) {
      const e = st.burn;
      e.x = st.pivot.x + f.x * 8;
      e.z = st.pivot.z + f.z * 8;
      e.y = this.terrain.heightAt(e.x, e.z) + 2.5;
      e.h = 5;
      e.rot = Math.atan2(f.x, f.z);
      e.w = 7;
      e.d = 16;
    }
    this.onThud?.(_p, 1.3);
  }

  // ---------------- Windmühle ----------------
  _startMill(st) {
    st.mill.alive = false;
    st.sailVy = 0;
    st.sailSpin = (Math.random() - 0.5) * 1.5;
    st.capY0 = st.cap.position.y;
    for (let i = 0; i < 6; i++) {
      _p.set(st.x + (Math.random() - 0.5) * 6, st.base + 14 + Math.random() * 3, st.z + (Math.random() - 0.5) * 6);
      _v.set((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 5);
      this.debris.spawn('plank', _p, _v, { tint: st.charred ? 0.15 : 0.9 });
    }
  }

  _updateMill(st, dt) {
    const S = st.sails;
    let done = true;
    if (!st.sailsDown) {
      done = false;
      st.sailVy -= G * dt;
      S.position.y += st.sailVy * dt;
      S.position.z += 1.8 * dt;
      S.rotation.x = Math.max(-Math.PI / 2, S.rotation.x - 1.1 * dt);
      S.rotation.z += st.sailSpin * dt;
      if (S.position.y < 0.8) {
        S.position.y = 0.8;
        S.rotation.x = -Math.PI / 2;
        st.sailsDown = true;
        // Aufschlag: Flügel zerbrechen teilweise
        _p.set(0, 1, S.position.z).applyEuler(st.group.rotation).add(st.group.position);
        for (let i = 0; i < 10; i++) {
          _w.set(_p.x + (Math.random() - 0.5) * 10, _p.y + 0.5, _p.z + (Math.random() - 0.5) * 10);
          _v.set((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
          this.debris.spawn('plank', _w, _v, { tint: st.charred ? 0.15 : 0.9 });
        }
        this.particles.dust(_p, 1.3);
        this.onThud?.(_p, 1);
      }
    }
    // Kappe sackt in den Turm und fällt auseinander
    const kc = smoothstep(0.2, 1.0, st.t);
    st.cap.position.y = st.capY0 - 2.8 * kc;
    st.cap.rotation.z = 0.4 * kc;
    if (st.t > 1.0 && st.cap.visible) {
      st.cap.visible = false;
      for (let i = 0; i < 8; i++) {
        _p.set(st.x + (Math.random() - 0.5) * 4, st.base + 13 + Math.random() * 2, st.z + (Math.random() - 0.5) * 4);
        _v.set((Math.random() - 0.5) * 7, 1 + Math.random() * 4, (Math.random() - 0.5) * 7);
        this.debris.spawn('plank', _p, _v, { tint: st.charred ? 0.15 : 0.9 });
      }
    }
    return done && st.t > 1.1;
  }

  // ---------------- Marktstand ----------------
  _startStall(st) {
    st.roofMesh.visible = false;
    for (let i = 0; i < 5; i++) {
      _p.set(st.x + (Math.random() - 0.5) * 3, st.base + 1 + Math.random() * 1.5, st.z + (Math.random() - 0.5) * 3);
      _v.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 4);
      if (st.cause === 'force') _v.addScaledVector(st.dir, 3);
      this.debris.spawn('plank', _p, _v, { tint: st.charred ? 0.15 : 0.9, size: 0.6 });
    }
    st.tilt = (Math.random() - 0.5) * 0.5;
    _p.set(st.x, st.base + 0.5, st.z);
    this.particles.dust(_p, 0.6);
  }

  _updateStall(st) {
    const k = smoothstep(0, 0.5, st.t);
    st.group.scale.y = 1 - 0.78 * k;
    st.group.rotation.z = st.tilt * k;
    return st.t > 0.6;
  }

  // ---------------- Zelt ----------------
  _startTent(st) {
    for (let i = 0; i < 3; i++) {
      _p.set(st.x + (Math.random() - 0.5) * 3, st.base + 2 + Math.random() * 2, st.z + (Math.random() - 0.5) * 3);
      _v.set((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4);
      this.debris.spawn('plank', _p, _v, { tint: st.charred ? 0.15 : 0.9, size: 0.7 });
    }
    st.tilt = (Math.random() - 0.5) * 0.4;
    _p.set(st.x, st.base + 0.5, st.z);
    this.particles.dust(_p, 0.7);
  }

  _updateTent(st) {
    // flach zusammenfallen: Kegel stauchen und etwas breiter (liegt auf dem Boden)
    const k = smoothstep(0, 0.45, st.t);
    const m = st.mesh;
    const sy = 1 - 0.85 * k;
    m.scale.set(1 + 0.3 * k, sy, 1 + 0.3 * k);
    m.position.y = st.base + st.h * 0.5 * sy - 0.1;
    m.rotation.z = st.tilt * k;
    if (st.flag) st.flag.visible = false;
    return st.t > 0.5;
  }

  // ---------------- Belagerungs-Armbrust ----------------
  _startCart(st) {
    st.group.visible = false;
    for (let i = 0; i < 9; i++) {
      _p.set(st.x + (Math.random() - 0.5) * 3, st.base + 1 + Math.random() * 1.5, st.z + (Math.random() - 0.5) * 3);
      _v.set((Math.random() - 0.5) * 7, 2 + Math.random() * 4, (Math.random() - 0.5) * 7);
      if (st.cause === 'force') _v.addScaledVector(st.dir, 4);
      this.debris.spawn(i < 7 ? 'plank' : 'stone', _p, _v, { tint: st.charred ? 0.15 : 0.9, size: 0.8 });
    }
    _p.set(st.x, st.base + 0.5, st.z);
    this.particles.dust(_p, 0.9);
  }

  // ------------------------------------------------------------ jedes Bild
  update(dt) {
    if (dt <= 0) return;
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const st = this.anims[i];
      st.t += dt;
      let done = true;
      if (st.kind === 'hut') done = this._updateHut(st, dt);
      else if (st.kind === 'tower') done = this._updateTower(st, dt);
      else if (st.kind === 'windmill') done = this._updateMill(st, dt);
      else if (st.kind === 'stall') done = this._updateStall(st, dt);
      else if (st.kind === 'tent') done = this._updateTent(st, dt);
      if (done) {
        st.state = 'down';
        this.anims.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------ Wiederaufbau
  _restore(st) {
    st.hp = HP[st.kind] ?? 1;
    const i = this.anims.indexOf(st);
    if (i >= 0) this.anims.splice(i, 1);
    if (st.state === 'intact') return;
    st.state = 'intact';
    st.dust2 = false;
    if (st.collider) {
      st.collider.off = false;
      st.collider.y = st.colY;
      st.collider.hy = st.colHy;
    }
    if (st.kind === 'hut') {
      const P = st.parts;
      P.wall.visible = P.roof.visible = P.door.visible = P.win.visible = true;
      P.wall.position.set(0, 0, 0);
      P.wall.quaternion.identity();
      P.wall.scale.set(1, 1, 1);
      P.roof.rotation.set(0, 0, 0);
      P.roof.scale.set(1, 1, 1);
      P.roof.position.y = st.y1 + st.wallH;
      if (P.chimney) P.chimney.visible = true;
      if (st.chimneyRef) st.chimneyRef.alive = true;
      if (st.ruin) st.ruin.visible = false;
    } else if (st.kind === 'tower') {
      st.group.quaternion.identity();
      st.group.position.set(st.x, st.base, st.z);
    } else if (st.kind === 'windmill') {
      const S = st.sails;
      S.position.copy(st.sailPos0);
      S.rotation.set(0, 0, 0);
      st.sailsDown = false;
      st.cap.visible = true;
      st.cap.position.y = st.capY0 ?? st.cap.position.y;
      st.cap.rotation.set(0, 0, 0);
      st.mill.alive = true;
    } else if (st.kind === 'stall') {
      st.group.scale.y = 1;
      st.group.rotation.z = 0;
      st.roofMesh.visible = true;
    } else if (st.kind === 'tent') {
      st.mesh.scale.set(1, 1, 1);
      st.mesh.position.y = st.base + st.h * 0.5 - 0.1;
      st.mesh.rotation.z = 0;
      st.mesh.visible = true;
      if (st.flag) st.flag.visible = true;
    } else if (st.kind === 'cart') st.group.visible = true;
    // Brand-Werte zurück (die Ruine hat Flammen und Rauch verschoben)
    if (st.burn && st.burn0) Object.assign(st.burn, st.burn0);
  }

  /** Neustart: Trümmer weg (Gebäude baut BurnSystem.reset → onReset wieder auf) */
  reset() {
    for (const st of this.list) this._restore(st);
    this.debris.clear();
  }
}
