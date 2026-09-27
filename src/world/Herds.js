// Schafherden auf den Weiden. Kommt der Drache tief und nah heran, rennt die ganze
// Herde in Panik davon. Im Tiefflug (oder zu Fuss) kann der Drache ein Schaf packen →
// das gibt Kraft (Leben, Ausdauer; macht Game.js). Gefangene Schafe kommen nach
// einer Weile wieder (nur wenn der Drache weit weg ist).
import * as THREE from 'three';
import { mulberry32, clamp } from '../core/utils.js';
import { mergeParts } from '../dragon/geo.js';

const HERD_RADIUS = 34; // so weit laufen die Schafe beim Grasen
const FLEE_RADIUS = 95; // ab hier bekommen sie Angst (Meter)
const FLEE_SPEED = 8.5; // m/s
const WALK_SPEED = 1.1;
const CATCH_RADIUS = 7; // Abstand zu den Krallen (Meter)
const RESPAWN_TIME = 120; // Sekunden
const SHEEP_PER_HERD = 11;

// Ungefähre Weide-Orte; das Programm sucht in der Nähe eine flache Wiese.
const ANCHORS = [
  { x: 1750, z: 350, name: 'Weide hinter dem Fluss' },
  { x: 900, z: 1250, name: 'Küstenweide' },
  { x: -760, z: 860, name: 'Weide westlich vom Dorf' },
  { x: -1290, z: 700, name: 'Hochweide am Schluchtrand' },
  { x: -880, z: -280, name: 'Weide beim Steinkreis' },
  { x: 250, z: 120, name: 'Seewiese' },
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _tilt = new THREE.Quaternion();

/** Flache Wiese in der Nähe suchen (vor dem Pflanzen der Bäume aufrufen) */
export function planPastures(terrain) {
  const out = [];
  for (const a of ANCHORS) {
    let best = null;
    for (let r = 0; r <= 400 && !best; r += 20) {
      for (let k = 0; k < Math.max(1, r / 8); k++) {
        const ang = (k / Math.max(1, r / 8)) * Math.PI * 2;
        const x = a.x + Math.cos(ang) * r;
        const z = a.z + Math.sin(ang) * r;
        const h = terrain.heightAt(x, z);
        if (h < 3 || h > 200) continue;
        let flat = true;
        for (let j = 0; j < 8 && flat; j++) {
          const b = (j / 8) * Math.PI * 2;
          const hx = terrain.heightAt(x + Math.cos(b) * 40, z + Math.sin(b) * 40);
          if (Math.abs(hx - h) > 7 || hx < 2) flat = false;
        }
        if (flat) {
          best = { x, z, name: a.name };
          break;
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}

function sheepGeometry() {
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const wool = new THREE.IcosahedronGeometry(0.62, 1);
  wool.scale(0.85, 0.75, 1.15);
  const woolParts = [
    { geo: wool, p: [0, 0.98, 0] },
    { geo: new THREE.IcosahedronGeometry(0.28, 0), p: [0, 1.28, 0.55] }, // Wollschopf
  ];
  const darkParts = [
    { geo: B(0.3, 0.34, 0.46), p: [0, 1.16, 0.86], r: [0.35, 0, 0] }, // Kopf
    { geo: B(0.28, 0.08, 0.14), p: [0, 1.28, 0.74], r: [0, 0, 0] },
  ];
  for (const sd of [-1, 1]) {
    darkParts.push({ geo: B(0.2, 0.07, 0.1), p: [sd * 0.2, 1.24, 0.76], r: [0, 0, sd * -0.5] }); // Ohren
    for (const z of [-0.36, 0.36]) darkParts.push({ geo: B(0.1, 0.6, 0.1), p: [sd * 0.2, 0.3, z] }); // Beine
  }
  return { wool: mergeParts(woolParts), dark: mergeParts(darkParts) };
}

export class Herds {
  constructor(scene, terrain, pastures) {
    this.terrain = terrain;
    this.pastures = pastures;
    const rnd = mulberry32(21);
    this.rnd = rnd;
    this.sheep = [];
    pastures.forEach((p, hi) => {
      p.fear = 0;
      for (let i = 0; i < SHEEP_PER_HERD; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * HERD_RADIUS * 0.7;
        const s = {
          herd: hi,
          x: p.x + Math.cos(a) * r,
          z: p.z + Math.sin(a) * r,
          y: 0,
          heading: rnd() * Math.PI * 2,
          speed: 0,
          tx: 0,
          tz: 0,
          wait: rnd() * 5,
          graze: rnd(),
          alive: true,
          respawn: 0,
          phase: rnd() * 10,
          size: 0.9 + rnd() * 0.25,
          black: rnd() < 0.08, // ab und zu ein schwarzes Schaf
        };
        s.tx = s.x;
        s.tz = s.z;
        s.y = terrain.heightAt(s.x, s.z);
        this.sheep.push(s);
      }
    });
    const geo = sheepGeometry();
    const n = this.sheep.length;
    this.woolMesh = new THREE.InstancedMesh(geo.wool, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), n);
    this.darkMesh = new THREE.InstancedMesh(geo.dark, new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9, flatShading: true }), n);
    const white = new THREE.Color(0xeee8dc);
    const black = new THREE.Color(0x3a3430);
    this.sheep.forEach((s, i) => this.woolMesh.setColorAt(i, s.black ? black : white.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.08)));
    for (const m of [this.woolMesh, this.darkMesh]) {
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.bleatTimer = 2;
    this.onCatch = null; // (Schaf, Position)
    this.onPanic = null; // (Weide)
    this._write();
  }

  get alive() {
    return this.sheep.filter((s) => s.alive).length;
  }

  /** Nächste Weide mit Schafen (für Aufträge und Hinweise) */
  nearestPasture(pos) {
    let best = null;
    let bd = Infinity;
    for (const p of this.pastures) {
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  _write() {
    this.sheep.forEach((s, i) => {
      if (!s.alive) {
        _s.set(0, 0, 0);
      } else {
        const sc = s.size * 1.35;
        _s.set(sc, sc, sc);
      }
      const hop = s.speed > 3 ? Math.abs(Math.sin(s.phase * 11)) * 0.35 : 0;
      _p.set(s.x, s.y + hop, s.z);
      this.terrain.normalAt(s.x, s.z, _n);
      _q.setFromAxisAngle(_up, s.heading);
      // leicht an den Hang anpassen und beim Grasen den Körper nach vorne neigen
      _q.premultiply(_tilt.setFromUnitVectors(_up, _n.lerp(_up, 0.5).normalize()));
      _m.compose(_p, _q, _s);
      this.woolMesh.setMatrixAt(i, _m);
      this.darkMesh.setMatrixAt(i, _m);
    });
    this.woolMesh.instanceMatrix.needsUpdate = true;
    this.darkMesh.instanceMatrix.needsUpdate = true;
  }

  /** Alle gefangenen Schafe sofort zurück (Neustart) */
  reset() {
    for (const s of this.sheep) {
      s.alive = true;
      s.respawn = 0;
    }
    for (const p of this.pastures) p.fear = 0;
  }

  /**
   * ctx = { dragonPos, dragonSpeed, agl (Höhe über Boden), canCatch, audio }
   */
  update(dt, ctx) {
    const t = this.terrain;
    const D = ctx.dragonPos;
    const rnd = this.rnd;
    // Angst: Drache nah und tief (oder laut brüllend → ctx.roar)
    for (const p of this.pastures) {
      const d = Math.hypot(D.x - p.x, D.z - p.z);
      const scary = d < FLEE_RADIUS + HERD_RADIUS && (ctx.agl ?? 99) < 80;
      const roar = ctx.roar && d < 260;
      if (scary || roar) {
        if (p.fear <= 0) this.onPanic?.(p);
        p.fear = 6;
      } else p.fear = Math.max(0, p.fear - dt);
    }
    // Krallen: etwa 3 m unter der Körpermitte
    const clawY = D.y - 3;
    for (const s of this.sheep) {
      if (!s.alive) {
        s.respawn -= dt;
        if (s.respawn <= 0) {
          const p = this.pastures[s.herd];
          if (Math.hypot(D.x - p.x, D.z - p.z) > 300) {
            const a = rnd() * Math.PI * 2;
            s.x = p.x + Math.cos(a) * 10;
            s.z = p.z + Math.sin(a) * 10;
            s.tx = s.x;
            s.tz = s.z;
            s.alive = true;
          }
        }
        continue;
      }
      const p = this.pastures[s.herd];
      const dx = s.x - D.x;
      const dz = s.z - D.z;
      const dh = Math.hypot(dx, dz);
      let want = 0;
      let dirX = 0;
      let dirZ = 0;
      if (p.fear > 0) {
        // weg vom Drachen, etwas zur Herde hin, etwas Zickzack
        const away = 1 / Math.max(dh, 1);
        dirX = dx * away;
        dirZ = dz * away;
        const toC = Math.hypot(p.x - s.x, p.z - s.z);
        if (toC > HERD_RADIUS * 2.5) {
          dirX += ((p.x - s.x) / toC) * 0.4;
          dirZ += ((p.z - s.z) / toC) * 0.4;
        }
        const zig = Math.sin(s.phase * 1.7 + s.herd) * 0.5;
        const zx = -dirZ * zig;
        const zz = dirX * zig;
        dirX += zx;
        dirZ += zz;
        want = FLEE_SPEED * (0.85 + 0.3 * s.size - 0.1);
        s.wait = 1 + rnd() * 3;
      } else {
        // grasen: ab und zu ein paar Schritte zu einem neuen Platz
        s.wait -= dt;
        const tdx = s.tx - s.x;
        const tdz = s.tz - s.z;
        const td = Math.hypot(tdx, tdz);
        if (td > 0.6) {
          dirX = tdx / td;
          dirZ = tdz / td;
          want = WALK_SPEED;
        } else if (s.wait <= 0) {
          const a = rnd() * Math.PI * 2;
          const r = Math.sqrt(rnd()) * HERD_RADIUS;
          s.tx = p.x + Math.cos(a) * r;
          s.tz = p.z + Math.sin(a) * r;
          s.wait = 3 + rnd() * 7;
        }
      }
      // nicht ins Wasser und nicht über Klippen laufen
      if (want > 0) {
        const nx = s.x + dirX * 4;
        const nz = s.z + dirZ * 4;
        const hn = t.heightAt(nx, nz);
        if (hn < 1.5 || Math.abs(hn - s.y) > 4) {
          // umdrehen, zur Weide hin
          const toC = Math.hypot(p.x - s.x, p.z - s.z) || 1;
          dirX = (p.x - s.x) / toC;
          dirZ = (p.z - s.z) / toC;
        }
      }
      s.speed += (want - s.speed) * clamp(dt * 3, 0, 1);
      if (want > 0) {
        const target = Math.atan2(dirX, dirZ);
        let dA = target - s.heading;
        dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        s.heading += clamp(dA, -dt * 6, dt * 6);
      }
      s.x += Math.sin(s.heading) * s.speed * dt;
      s.z += Math.cos(s.heading) * s.speed * dt;
      s.y = t.heightAt(s.x, s.z);
      s.phase += dt * (0.5 + s.speed * 0.5);

      // Gepackt?
      if (ctx.canCatch && dh < CATCH_RADIUS && clawY - (s.y + 1) < 5 && clawY - (s.y + 1) > -4) {
        s.alive = false;
        s.respawn = RESPAWN_TIME;
        this.onCatch?.(s, _p.set(s.x, s.y + 1, s.z));
      }
    }
    // Blöken (öfter in Panik)
    this.bleatTimer -= dt;
    if (this.bleatTimer <= 0 && ctx.audio) {
      let best = null;
      let bd = 500;
      for (const s of this.sheep) {
        if (!s.alive) continue;
        const d = Math.hypot(s.x - D.x, s.z - D.z);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      const panic = best && this.pastures[best.herd].fear > 0;
      this.bleatTimer = panic ? 0.5 + rnd() * 0.8 : 5 + rnd() * 8;
      if (best) ctx.audio.playBleat(_p.set(best.x, best.y + 1, best.z), panic ? 1.1 : 0.8, 0.62 + rnd() * 0.1);
    }
    this._write();
  }
}
