// Drachenschlucht im Westen: Wasserfall am oberen Ende (mit Bach auf dem Plateau und
// Gischt unten) und eine Hängebrücke quer über die Schlucht – zum Drunterdurch-Fliegen.
// Die Schlucht selbst kommt aus der Landschaft (Terrain.js: PLACES.canyon).
import * as THREE from 'three';
import { PLACES, CANYON_LEN } from './Terrain.js';

const _p = new THREE.Vector3();

/** Punkt und Richtung auf der Schlucht-Mittellinie bei Länge s (hinter dem Ende geradeaus weiter). */
export function canyonPoint(s, out = { x: 0, z: 0, dx: 0, dz: 1 }) {
  const pts = PLACES.canyon;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (s <= acc + len || i === pts.length - 2) {
      const t = (s - acc) / len; // darf > 1 sein (hinter dem Ende)
      out.dx = (bx - ax) / len;
      out.dz = (bz - az) / len;
      out.x = ax + (bx - ax) * t;
      out.z = az + (bz - az) * t;
      return out;
    }
    acc += len;
  }
  return out;
}

/** Wasser-Textur: helle Längsstreifen mit Lücken (fliesst, wenn man sie verschiebt) */
function streakTexture() {
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(200,225,240,0.55)';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const w = 1 + Math.random() * 3;
    const h = 20 + Math.random() * 90;
    const a = 0.35 + Math.random() * 0.6;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, w, h);
    if (y + h > H) g.fillRect(x, y - H, w, h); // kachelbar
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Canyon {
  constructor(scene, terrain, colliders) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'Schlucht';
    scene.add(this.group);
    this.time = 0;
    this.tex = streakTexture();
    this.mistTimer = 0;
    this._waterfall();
    this._bridge(colliders);
  }

  /**
   * Band aus Dreiecken entlang der Mittellinie von s0 bis s1, dicht über dem Boden.
   * width(s) = Breite, lift = Abstand über dem Boden. v läuft in Metern (für die Textur).
   */
  _ribbon(s0, s1, step, width, lift, mat) {
    const t = this.terrain;
    const pos = [];
    const uv = [];
    const idx = [];
    const c = { x: 0, z: 0, dx: 0, dz: 1 };
    let v = 0;
    let prev = null;
    const n = Math.ceil(Math.abs(s1 - s0) / step);
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      canyonPoint(s, c);
      const w = width(s) / 2;
      const nx = -c.dz;
      const nz = c.dx;
      const y = t.heightAt(c.x, c.z) + lift;
      _p.set(c.x, y, c.z);
      if (prev) v += _p.distanceTo(prev) / 18;
      prev = _p.clone();
      for (const k of [-1, 1]) {
        const x = c.x + nx * w * k;
        const z = c.z + nz * w * k;
        pos.push(x, Math.max(y, t.heightAt(x, z) + lift * 0.6), z);
        uv.push(k < 0 ? 0 : 2.5, v);
      }
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 3;
    this.group.add(mesh);
    return mesh;
  }

  _waterfall() {
    const L = CANYON_LEN;
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex,
      color: 0xe6f2ff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fallMat = mat;
    // Bach auf dem Plateau → über die Kante → an der Felswand hinunter bis in den Fluss
    this._ribbon(L + 240, L - 55, 1.5, (s) => (s > L + 8 ? 9 : 9 + (L + 8 - s) * 0.3), 0.9, mat);
    const c = canyonPoint(L - 48);
    this.mistPos = new THREE.Vector3(c.x, 1, c.z);
    this.mistDir = new THREE.Vector3(-c.dx, 0, -c.dz);
    const top = canyonPoint(L + 6);
    this.top = new THREE.Vector3(top.x, this.terrain.heightAt(top.x, top.z), top.z);
  }

  _bridge(colliders) {
    const t = this.terrain;
    const s = CANYON_LEN * 0.42;
    const c = canyonPoint(s);
    const nx = -c.dz;
    const nz = c.dx;
    // Kanten der Schlucht suchen (dort, wo das Plateau beginnt)
    const rim = (k) => {
      for (let d = 30; d < 260; d += 2) {
        const x = c.x + nx * d * k;
        const z = c.z + nz * d * k;
        if (t.heightAt(x, z) > 100) return new THREE.Vector3(x + nx * 6 * k, t.heightAt(x + nx * 6 * k, z + nz * 6 * k), z + nz * 6 * k);
      }
      return null;
    };
    const A = rim(-1);
    const B = rim(1);
    if (!A || !B) return;
    const span = A.distanceTo(B);
    const sag = span * 0.07;
    const deckY = (u) => A.y + (B.y - A.y) * u + 1.5 - sag * 4 * u * (1 - u);
    const along = new THREE.Vector3().subVectors(B, A).setY(0).normalize();
    const side = new THREE.Vector3(-along.z, 0, along.x);
    const yaw = Math.atan2(-along.z, along.x);
    this.bridge = { A, B, mid: new THREE.Vector3((A.x + B.x) / 2, deckY(0.5), (A.z + B.z) / 2), yaw };

    const wood = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x8a7658, roughness: 1 });
    // Bretter
    const nPl = Math.floor(span / 0.85);
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 0.1, 3.0), wood, nPl);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nPl; i++) {
      const u = (i + 0.5) / nPl;
      const u2 = Math.min(1, u + 0.01);
      const slope = Math.atan2(deckY(u2) - deckY(u), span * 0.01);
      _p.lerpVectors(A, B, u).setY(deckY(u));
      e.set(0, yaw, slope + (Math.random() - 0.5) * 0.06, 'YXZ');
      planks.setMatrixAt(i, m.compose(_p, q.setFromEuler(e), one));
    }
    planks.castShadow = true;
    this.group.add(planks);
    // Seile (Handläufe und Tragseile) als dünne Röhren
    for (const k of [-1, 1]) {
      for (const h of [0.05, 1.2]) {
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const u = i / 24;
          pts.push(new THREE.Vector3().lerpVectors(A, B, u).addScaledVector(side, k * 1.55).setY(deckY(u) + h + (h > 1 ? 0.3 * 4 * u * (1 - u) : 0)));
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.07, 5), rope);
        this.group.add(tube);
      }
    }
    // Pfosten an beiden Enden
    const post = new THREE.CylinderGeometry(0.18, 0.22, 3.2, 6);
    for (const P of [A, B]) {
      for (const k of [-1, 1]) {
        const mesh = new THREE.Mesh(post, wood);
        mesh.position.copy(P).addScaledVector(side, k * 1.6);
        mesh.position.y = t.heightAt(mesh.position.x, mesh.position.z) + 1.4;
        mesh.castShadow = true;
        this.group.add(mesh);
      }
    }
    // Kollision: die Brücke in Stücken (man kann sie rammen)
    const n = 10;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      _p.lerpVectors(A, B, u);
      colliders.addBox(_p.x, deckY(u) + 0.4, _p.z, span / n / 2, 1.0, 1.9, yaw);
    }
  }

  /** ctx = { particles } */
  update(dt, ctx) {
    this.time += dt;
    this.tex.offset.y = -this.time * 0.9; // Wasser fliesst
    // Gischt unten am Wasserfall
    const P = ctx.particles;
    if (ctx.camPos.distanceTo(this.mistPos) > 1600) return;
    this.mistTimer -= dt;
    while (this.mistTimer <= 0) {
      this.mistTimer += 0.06;
      const a = (Math.random() - 0.5) * 16;
      P.spray.spawn(
        this.mistPos.x + this.mistDir.z * a + (Math.random() - 0.5) * 6, 0.8, this.mistPos.z - this.mistDir.x * a + (Math.random() - 0.5) * 6,
        this.mistDir.x * (3 + Math.random() * 5), 3 + Math.random() * 7, this.mistDir.z * (3 + Math.random() * 5),
        2 + Math.random() * 1.5, 5, 16 + Math.random() * 10
      );
    }
  }
}
