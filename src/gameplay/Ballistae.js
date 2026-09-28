// Armbrust-Türme (Gegner): Auf den Holz-Wachtürmen stehen grosse Armbrüste (Ballisten).
// Kommt der Drache näher als RANGE und ist nichts dazwischen, zielen sie (mit Vorhalt)
// und schiessen Brandbolzen. Die Bolzen streuen etwas → mit Kurven kann man ausweichen.
// Brennt ein Turm, ist seine Armbrust zerstört. "Neustart" baut alles wieder auf.
// Auch die Burg wehrt sich: Armbrüste auf dem Bergfried und auf den Mauern (Holz, brennbar).
// Fliegt ein Bolzen knapp vorbei, gibt es Punkte ("Knapp vorbei!").
import * as THREE from 'three';
import { clamp } from '../core/utils.js';

const RANGE = 320; // Reichweite (m)
const BOLT_SPEED = 140; // m/s
const GRAVITY = 6; // Bolzen fallen leicht (m/s²)
const AIM_TIME = 1.6; // so lange zielt ein Turm, bevor der erste Schuss kommt (Warnung)
const RELOAD_MIN = 2.6;
const RELOAD_MAX = 3.8;
const SPREAD = 0.02; // Streuung in Radiant
const HIT_RADIUS = 4.4; // etwas grösser als die Kollisions-Kugel des Drachen
const TURN_RATE = 2.2; // wie schnell sich die Armbrust dreht (rad/s)
const NEAR_MISS = 15; // so knapp muss ein Bolzen vorbeifliegen (Meter)

const _to = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _los = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, -1);

/** Armbrust aus einfachen Kästen: Sockel, drehbarer Kopf, Schaft, Bogen, Sehne, Bolzen */
function makeBallista() {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3e3e42, roughness: 0.5, metalness: 0.6 });
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const root = new THREE.Group();
  const post = box(0.5, 1.1, 0.5, wood);
  post.position.y = 0.55;
  root.add(post);
  const yaw = new THREE.Group();
  yaw.position.y = 1.2;
  root.add(yaw);
  const pitch = new THREE.Group();
  yaw.add(pitch);
  const stock = box(0.35, 0.3, 3.4, wood);
  stock.position.z = -0.6;
  pitch.add(stock);
  for (const s of [-1, 1]) {
    const arm = box(1.9, 0.18, 0.28, wood);
    arm.position.set(s * 0.95, 0.05, -2.1);
    arm.rotation.y = s * 0.28; // Bogenarme leicht nach hinten gebogen
    pitch.add(arm);
    const tip = box(0.2, 0.25, 0.25, iron);
    tip.position.set(s * 1.85, 0.05, -1.8);
    pitch.add(tip);
  }
  const string = box(3.6, 0.04, 0.04, iron);
  string.position.set(0, 0.12, -1.0);
  pitch.add(string);
  const bolt = box(0.08, 0.08, 2.4, iron);
  bolt.position.set(0, 0.2, -1.6);
  pitch.add(bolt);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  return { root, yaw, pitch, bolt };
}

export class Ballistae {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.towers = [];
    this.bolts = [];
    const tops = world.settlement.poi.watchtowers || [];
    for (const top of tops) {
      const burn = world.burn.entities.find((e) => e.kind === 'tower' && Math.hypot(e.x - top.x, e.z - top.z) < 1.5);
      // der Wachturm als Bauwerk: kippt er um (Destruction.js), fällt die Armbrust mit
      const structure = world.settlement.structures.find((s) => s.kind === 'tower' && Math.hypot(s.x - top.x, s.z - top.z) < 1.5);
      const b = makeBallista();
      b.root.position.set(top.x, top.y - 0.05, top.z);
      scene.add(b.root);
      this.towers.push({ top, burn, structure, ...b, timer: AIM_TIME, destroyed: false, yawA: 0, pitchA: 0, seen: false, range: RANGE, spread: SPREAD });
    }
    // Burg: auf dem Bergfried und in der Mitte der Nord-, West- und Ostmauer
    const P = world.settlement.poi;
    if (P.castle && P.keepTop) {
      const C = P.castle;
      const spots = [
        [P.keepTop.x + 6, P.keepTop.y, P.keepTop.z - 6],
        [C.x, C.y + 13, C.z - 40],
        [C.x - 40, C.y + 13, C.z],
        [C.x + 40, C.y + 13, C.z],
      ];
      for (const [x, y, z] of spots) {
        const top = new THREE.Vector3(x, y, z);
        const burn = world.burn.addEntity({ kind: 'ballista', x, y: y + 1.5, z, r: 3.5, h: 3, w: 3.6, d: 3.6, fuel: 10 });
        const b = makeBallista();
        b.root.position.set(x, y - 0.05, z);
        scene.add(b.root);
        this.towers.push({ top, burn, ...b, timer: AIM_TIME, destroyed: false, yawA: 0, pitchA: 0, seen: false, range: 270, spread: SPREAD * 1.5, castle: true });
      }
    }
    this.destroyedCount = 0;

    // Brandbolzen: dunkler Schaft, brennende Spitze und ein leuchtender Schweif (damit man sie kommen sieht)
    const shaftGeo = new THREE.BoxGeometry(0.12, 0.12, 2.6);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.7, emissive: 0xff6a10, emissiveIntensity: 0.6 });
    const tracerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.0, 1.4, 0.4), // heller als 1 → leuchtet (Bloom)
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const tracerGeo = new THREE.BoxGeometry(0.22, 0.22, 12).translate(0, 0, 6);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(shaftGeo, shaftMat));
      const tr = new THREE.Mesh(tracerGeo, tracerMat);
      g.add(tr);
      g.visible = false;
      scene.add(g);
      this.bolts.push({ mesh: g, tracer: tr, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, state: 0 }); // 0 frei, 1 fliegt, 2 steckt
    }

    this.onShot = null; // (Position) → Ton
    this.onHit = null; // (Richtung, Punkt) → Rückstoss, Schaden …
    this.onDestroyed = null; // (Anzahl, Gesamt)
    this.onAim = null; // erster Turm zielt auf den Drachen → Hinweis
    this.onNearMiss = null; // Bolzen knapp vorbei
  }

  get total() {
    return this.towers.length;
  }

  /**
   * Belagerungs-Armbrust auf einem Karren (für die Schlacht). Brennbar. Schiesst nur, wenn
   * enabled = true (setzt Battle.js während der Schlacht).
   */
  addField(x, y, z) {
    const b = makeBallista();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.9 });
    const cart = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 3.6), wood);
    bed.position.y = 1.0;
    cart.add(bed);
    const wheelGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.25, 12).rotateZ(Math.PI / 2);
    for (const [wx, wz] of [[-1.4, -1.2], [1.4, -1.2], [-1.4, 1.2], [1.4, 1.2]]) {
      const w = new THREE.Mesh(wheelGeo, wood);
      w.position.set(wx, 0.75, wz);
      cart.add(w);
    }
    cart.traverse((o) => o.isMesh && (o.castShadow = true));
    b.root.add(cart);
    b.root.children[0].position.y += 0.9; // Pfosten auf den Karren stellen
    b.yaw.position.y += 0.9;
    b.root.position.set(x, y, z);
    this.scene.add(b.root);
    const top = new THREE.Vector3(x, y + 1.0, z);
    const burn = this.world.burn.addEntity({ kind: 'ballista', x, y: y + 1.5, z, r: 3.5, h: 3, w: 3.6, d: 4, fuel: 10 });
    // als Bauwerk: zerbricht bei Wucht (Landung, Biss, Aufprall) – siehe Destruction.js
    const structure = this.world.destruction?.add({ kind: 'cart', x, z, r: 2, base: y, ground: y, top: y + 3.5, group: b.root, burn });
    const tw = { top, burn, structure, ...b, timer: AIM_TIME, destroyed: false, yawA: -Math.PI / 2, pitchA: 0, seen: false, range: 300, spread: SPREAD * 1.3, field: true, enabled: false };
    this.towers.push(tw);
    return tw;
  }

  _lineOfSight(from, to) {
    const t = this.world.terrain;
    for (let i = 1; i < 12; i++) {
      _los.lerpVectors(from, to, i / 12);
      if (t.heightAt(_los.x, _los.z) > _los.y - 1) return false;
    }
    return true;
  }

  _fire(tw, target, targetVel) {
    const bolt = this.bolts.find((b) => b.state === 0) || this.bolts.reduce((a, b) => (a.age > b.age ? a : b));
    _a.copy(tw.top).setY(tw.top.y + 1.4);
    // Vorhalt: dort hinzielen, wo der Drache sein wird, wenn der Bolzen ankommt
    const dist = _a.distanceTo(target);
    let t = dist / BOLT_SPEED;
    _aim.copy(target).addScaledVector(targetVel, t);
    t = _a.distanceTo(_aim) / BOLT_SPEED;
    _aim.copy(target).addScaledVector(targetVel, t);
    _aim.y += 0.5 * GRAVITY * t * t;
    _dir.subVectors(_aim, _a).normalize();
    // Streuung
    const sp = tw.spread ?? SPREAD;
    _dir.x += (Math.random() - 0.5) * 2 * sp;
    _dir.y += (Math.random() - 0.5) * 2 * sp;
    _dir.z += (Math.random() - 0.5) * 2 * sp;
    _dir.normalize();
    bolt.pos.copy(_a).addScaledVector(_dir, 2);
    bolt.vel.copy(_dir).multiplyScalar(BOLT_SPEED);
    bolt.age = 0;
    bolt.state = 1;
    bolt.minD = Infinity;
    bolt.nearDone = false;
    bolt.mesh.visible = true;
    bolt.tracer.visible = true;
    this.onShot?.(_a);
  }

  /**
   * s = { dragonPos, dragonVel, active }  (active = Gegner dürfen schiessen)
   */
  update(dt, s) {
    // --- Türme ---
    for (const tw of this.towers) {
      const e = tw.burn;
      const fallen = tw.structure && tw.structure.state !== 'intact';
      const burnt = fallen || (e && (e.state === 2 || (e.state === 1 && e.t / e.fuel > 0.45)));
      tw.root.visible = !burnt;
      if (((e && e.state !== 0) || fallen) && !tw.destroyed) {
        tw.destroyed = true;
        this.destroyedCount++;
        this.onDestroyed?.(this.destroyedCount, this.total, tw);
      } else if ((!e || e.state === 0) && !fallen && tw.destroyed) {
        tw.destroyed = false; // Neustart: Turm wieder aufgebaut
        this.destroyedCount = Math.max(0, this.destroyedCount - 1);
      }
      if (tw.destroyed || !s.active || tw.enabled === false) {
        tw.timer = AIM_TIME;
        continue;
      }
      _to.subVectors(s.dragonPos, tw.top);
      const d = _to.length();
      if (d > (tw.range ?? RANGE) || !this._lineOfSight(_eye.copy(tw.top).setY(tw.top.y + 1.5), s.dragonPos)) {
        tw.timer = Math.max(tw.timer, AIM_TIME);
        continue;
      }
      if (!tw.seen) {
        tw.seen = true;
        this.onAim?.();
      }
      // drehen und neigen (mit begrenzter Geschwindigkeit)
      const yawT = Math.atan2(-_to.x, -_to.z);
      const pitchT = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
      let dy = yawT - tw.yawA;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      tw.yawA += clamp(dy, -TURN_RATE * dt, TURN_RATE * dt);
      tw.pitchA += clamp(pitchT - tw.pitchA, -TURN_RATE * dt, TURN_RATE * dt);
      tw.yaw.rotation.y = tw.yawA;
      tw.pitch.rotation.x = tw.pitchA;
      tw.timer -= dt;
      tw.bolt.visible = tw.timer < RELOAD_MIN; // Bolzen liegt auf, wenn nachgeladen
      if (tw.timer <= 0 && Math.abs(dy) < 0.3) {
        this._fire(tw, s.dragonPos, s.dragonVel);
        tw.timer = RELOAD_MIN + Math.random() * (RELOAD_MAX - RELOAD_MIN);
      }
    }

    // --- Bolzen ---
    for (const b of this.bolts) {
      if (b.state === 0) continue;
      b.age += dt;
      if (b.state === 2) {
        if (b.age > 6) {
          b.state = 0;
          b.mesh.visible = false;
        }
        continue;
      }
      _prev.copy(b.pos);
      b.vel.y -= GRAVITY * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.quaternion.setFromUnitVectors(_z, _dir.copy(b.vel).normalize());
      // Treffer? (kürzester Abstand der Flugstrecke zum Drachen)
      const hit = segmentDistance(_prev, b.pos, s.dragonPos);
      if (hit < HIT_RADIUS && s.active) {
        b.state = 0;
        b.mesh.visible = false;
        this.onHit?.(_dir.copy(b.vel).normalize(), b.pos);
        continue;
      }
      // knapp vorbei? (war nah, entfernt sich jetzt wieder)
      if (s.active && !b.nearDone) {
        if (hit < b.minD) b.minD = hit;
        else if (b.minD < NEAR_MISS && hit > b.minD + 3) {
          b.nearDone = true;
          this.onNearMiss?.();
        }
      }
      const gh = this.world.terrain.heightAt(b.pos.x, b.pos.z);
      if (b.pos.y < gh) {
        b.state = 2; // steckt im Boden
        b.age = 0;
        b.pos.y = gh + 0.6;
        b.mesh.position.copy(b.pos);
        b.tracer.visible = false;
      } else if (b.age > 4) {
        b.state = 0;
        b.mesh.visible = false;
      }
    }
  }
}

/** Kürzester Abstand vom Punkt p zur Strecke a–b */
function segmentDistance(a, b, p) {
  _b.subVectors(b, a);
  const l2 = _b.lengthSq();
  const t = l2 > 0 ? clamp(_to.subVectors(p, a).dot(_b) / l2, 0, 1) : 0;
  return _to.copy(a).addScaledVector(_b, t).distanceTo(p);
}
