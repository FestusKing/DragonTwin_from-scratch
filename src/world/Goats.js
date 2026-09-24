// Versteckte Ziegen (ein echtes DragonTwin-Easter-Egg 🐐).
// Fliege nahe an eine Ziege heran → sie meckert und wird gezählt.
// Tipp im Spiel: Ab und zu meckert eine Ziege in der Nähe → hinhören!
import * as THREE from 'three';
import { storage, mulberry32 } from '../core/utils.js';

const KEY = 'dragontwin.goats.v1';
const FIND_RADIUS = 17; // so nah muss man heran (Meter)
const COLORS = [
  [0xefe9dc, 0x5b4a3a],
  [0x8a5a3a, 0x3a2a1c],
  [0x2e2a27, 0xe8e2d8],
  [0xa39d93, 0x4a4540],
];

function makeGoat(variant) {
  const [bodyCol, darkCol] = COLORS[variant % COLORS.length];
  const body = new THREE.MeshStandardMaterial({ color: bodyCol, roughness: 1, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: darkCol, roughness: 1, flatShading: true });
  const horn = new THREE.MeshStandardMaterial({ color: 0xcfc2a0, roughness: 0.7, flatShading: true });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 1.0), body);
  torso.position.y = 0.8;
  g.add(torso);
  const legs = [];
  for (const [x, z] of [[-0.18, 0.36], [0.18, 0.36], [-0.18, -0.36], [0.18, -0.36]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.58, 0.11), dark);
    leg.geometry.translate(0, -0.29, 0);
    leg.position.set(x, 0.6, z);
    g.add(leg);
    legs.push(leg);
  }
  const neck = new THREE.Group();
  neck.position.set(0, 0.95, 0.42);
  const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.22), body);
  neckMesh.position.set(0, 0.16, 0.05);
  neckMesh.rotation.x = 0.4;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.14);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.42), body);
  skull.position.z = 0.14;
  skull.rotation.x = 0.35;
  head.add(skull);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.34, 5), horn);
    h.position.set(s * 0.07, 0.2, 0.02);
    h.rotation.set(-0.9, 0, s * 0.15);
    head.add(h);
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.08), dark);
    ear.position.set(s * 0.16, 0.08, 0.02);
    ear.rotation.z = s * -0.4;
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    eye.position.set(s * 0.125, 0.07, 0.14);
    head.add(eye);
  }
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), dark);
  beard.position.set(0, -0.14, 0.3);
  beard.rotation.x = Math.PI;
  head.add(beard);
  neck.add(head);
  g.add(neck);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.06), body);
  tail.position.set(0, 1.05, -0.52);
  tail.rotation.x = -0.5;
  g.add(tail);
  // Goldene Glocke (erscheint, wenn gefunden)
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffa020, emissiveIntensity: 1.5, metalness: 0.8, roughness: 0.3 })
  );
  bell.position.set(0, 0.8, 0.6);
  bell.visible = false;
  g.add(bell);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.scale.setScalar(1.5);
  return { group: g, neck, head, legs, tail, bell };
}

export class Goats {
  /** spots: Liste { id, x, y, z, name } */
  constructor(scene, spots) {
    this.scene = scene;
    this.goats = [];
    const found = new Set(storage.get(KEY, []));
    const rnd = mulberry32(7);
    spots.forEach((s, i) => {
      const m = makeGoat(i);
      m.group.position.set(s.x, s.y, s.z);
      m.group.rotation.y = rnd() * Math.PI * 2;
      scene.add(m.group);
      this.goats.push({
        ...m,
        id: s.id,
        name: s.name,
        pos: new THREE.Vector3(s.x, s.y, s.z),
        found: found.has(s.id),
        t: rnd() * 10,
        jump: 0,
        eat: rnd() < 0.5,
        eatTimer: 2 + rnd() * 4,
      });
      if (found.has(s.id)) m.bell.visible = true;
    });
    this.hintTimer = 18;
    this.pendingBleats = [];
    this.onFound = null;
  }

  get total() {
    return this.goats.length;
  }

  get foundCount() {
    return this.goats.filter((g) => g.found).length;
  }

  _save() {
    storage.set(KEY, this.goats.filter((g) => g.found).map((g) => g.id));
  }

  resetProgress() {
    for (const g of this.goats) {
      g.found = false;
      g.bell.visible = false;
    }
    this._save();
  }

  /** Nach einem Brüllen antworten die Ziegen in der Nähe */
  respondToRoar(pos) {
    for (const g of this.goats) {
      const d = g.pos.distanceTo(pos);
      if (d < 500) this.pendingBleats.push({ goat: g, t: 0.6 + Math.random() * 1.2 + d / 400 });
    }
  }

  update(dt, dragonPos, audio, active = true) {
    for (const g of this.goats) {
      g.t += dt;
      // Grasen: Kopf runter und hoch
      g.eatTimer -= dt;
      if (g.eatTimer <= 0) {
        g.eat = !g.eat;
        g.eatTimer = 1.5 + Math.random() * 4;
      }
      const targetNeck = g.eat ? 1.1 : -0.1 + Math.sin(g.t * 0.7) * 0.1;
      g.neck.rotation.x += (targetNeck - g.neck.rotation.x) * Math.min(1, dt * 4);
      if (g.eat) g.head.rotation.x = Math.sin(g.t * 9) * 0.08;
      g.tail.rotation.x = -0.5 + Math.sin(g.t * 11) * 0.2;
      // Freudensprung nach dem Finden
      if (g.jump > 0) {
        g.jump -= dt;
        const k = 1 - g.jump / 1.6;
        g.group.position.y = g.pos.y + Math.abs(Math.sin(k * Math.PI * 3)) * 1.6 * (1 - k);
        g.group.rotation.y += dt * 9 * (1 - k);
      }

      if (!active || g.found) continue;
      const d = g.pos.distanceTo(dragonPos);
      if (d < FIND_RADIUS) {
        g.found = true;
        g.jump = 1.6;
        g.bell.visible = true;
        audio?.playBleat(g.pos, 1.3);
        this._save();
        this.onFound?.(g, this.foundCount, this.total);
      }
    }

    // Antworten auf das Brüllen
    for (let i = this.pendingBleats.length - 1; i >= 0; i--) {
      const b = this.pendingBleats[i];
      b.t -= dt;
      if (b.t <= 0) {
        audio?.playBleat(b.goat.pos, 1.2);
        b.goat.jump = Math.max(b.goat.jump, 0.8);
        this.pendingBleats.splice(i, 1);
      }
    }

    // Hinweis: nächste unentdeckte Ziege meckert gelegentlich
    if (!active) return;
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) {
      this.hintTimer = 16 + Math.random() * 22;
      let best = null;
      let bd = 420;
      for (const g of this.goats) {
        if (g.found) continue;
        const d = g.pos.distanceTo(dragonPos);
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      if (best) audio?.playBleat(best.pos, 1.4);
    }
  }
}
