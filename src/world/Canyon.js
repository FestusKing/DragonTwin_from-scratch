// Drachenschlucht im Westen: Wasserfall am oberen Ende und eine Hängebrücke quer über die
// Schlucht – zum Drunterdurch-Fliegen. Die Schlucht selbst kommt aus der Landschaft
// (Terrain.js: PLACES.canyon).
// Der Wasserfall: Ein Bach fliesst über das Plateau bis zur Kante. Dort schiesst das Wasser
// hinaus und fällt frei (Schwerkraft): tausende Wasserteilchen, dahinter ein fliessender
// Wasservorhang. Unten: Gischt-Nebel, Spritzer und Schaum. Das Rauschen macht AudioManager.
import * as THREE from 'three';
import { PLACES, CANYON_LEN } from './Terrain.js';
import { ParticleSystem } from '../fx/Particles.js';

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

/** Wassertropfen-Textur: senkrecht gestreckter, weicher Tropfen (für die fallenden Teilchen) */
function dropTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.save();
  g.translate(S / 2, S / 2);
  g.scale(0.45, 1); // schmal und hoch → wirkt wie fallendes Wasser
  g.translate(-S / 2, -S / 2);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Schaum-Textur: weisse Flecken und Bläschen (für das Becken unter dem Wasserfall) */
function foamTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 2 + Math.random() * 14;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${0.25 + Math.random() * 0.5})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
    this.fallAcc = 0;
    this.dropAcc = 0;
    this._waterfall(scene);
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

  /** Kante des Wasserfalls suchen: dort, wo die steile Felswand oben flach wird */
  _findLip() {
    const t = this.terrain;
    const L = CANYON_LEN;
    const c = { x: 0, z: 0, dx: 0, dz: 1 };
    const h = (s) => {
      canyonPoint(s, c);
      return t.heightAt(c.x, c.z);
    };
    let sLip = L;
    for (let s = L - 20; s <= L + 40; s += 0.5) {
      if (h(s) > 60 && (h(s + 3) - h(s)) / 3 < 0.6) {
        sLip = s;
        break;
      }
    }
    canyonPoint(sLip, c);
    return { s: sLip, x: c.x, z: c.z, y: t.heightAt(c.x, c.z), dx: -c.dx, dz: -c.dz };
  }

  _waterfall(scene) {
    const lip = this._findLip();
    this.lip = lip;
    const flow = new THREE.Vector3(lip.dx, 0, lip.dz); // Fliessrichtung (in die Schlucht hinein)
    const side = new THREE.Vector3(-lip.dz, 0, lip.dx);
    this.flow = flow;
    this.side = side;
    this.width = 13;
    this.v0 = 6.5; // so schnell schiesst das Wasser über die Kante (m/s)
    this.fallH = lip.y + 1;
    this.fallT = Math.sqrt((2 * this.fallH) / 9.81); // Fallzeit ohne Luftwiderstand

    // 1) Bach auf dem Plateau bis zur Kante
    const streamMat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xd8ecf8, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.streamMat = streamMat;
    this._ribbon(CANYON_LEN + 72, lip.s + 1.5, 1.0, (s) => 6 + Math.min(1, (CANYON_LEN + 72 - s) / 30) * 5, 0.7, streamMat);

    // 2) Wasservorhang: gebogene Fläche entlang der Fallkurve (Wurfparabel)
    const tex2 = this.tex.clone();
    tex2.needsUpdate = true;
    tex2.repeat.set(1.6, 1);
    this.curtainTex = tex2;
    // oben glasig und blau (kompaktes Wasser), nach unten weiss und durchsichtiger (zerstäubt)
    const curtainMat = new THREE.MeshBasicMaterial({ map: tex2, color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const rows = 60;
    const cols = 6;
    const pos = [];
    const uv = [];
    const col = [];
    const idx = [];
    let v = 0;
    let prev = null;
    for (let i = 0; i <= rows; i++) {
      const k = i / rows;
      const glassy = Math.max(0, 1 - k * 5); // die ersten 20 % der Fallstrecke
      const r = 0.55 + 0.45 * (1 - glassy);
      const gg = 0.75 + 0.25 * (1 - glassy);
      const a = 0.72 * glassy + 0.34 * (1 - glassy) * (1 - k * 0.5);
      const tt = (i / rows) * this.fallT;
      const cx = lip.x + flow.x * (this.v0 * tt + 1.2);
      const cz = lip.z + flow.z * (this.v0 * tt + 1.2);
      const cy = Math.max(0.2, this.fallH - 0.5 * 9.81 * tt * tt);
      const cur = new THREE.Vector3(cx, cy, cz);
      if (prev) v += cur.distanceTo(prev) / 22;
      prev = cur;
      const w = (this.width / 2) * (1 + tt * 0.08);
      for (let j = 0; j <= cols; j++) {
        const u = j / cols - 0.5;
        pos.push(cx + side.x * u * 2 * w, cy, cz + side.z * u * 2 * w);
        uv.push(u + 0.5, v);
        const edge = 1 - Math.abs(u) * 2; // an den Rändern durchsichtiger
        col.push(r, gg, 1, a * (0.35 + 0.65 * Math.min(1, edge * 2.5)));
      }
      if (i > 0) {
        for (let j = 0; j < cols; j++) {
          const a = (i - 1) * (cols + 1) + j;
          const b = a + cols + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    cg.setIndex(idx);
    const curtain = new THREE.Mesh(cg, curtainMat);
    curtain.renderOrder = 4;
    this.group.add(curtain);

    // 3) Wasserteilchen: fallen frei, werden breiter (Gischt), gleiten an der Wand ab
    const t = this.terrain;
    this.water = new ParticleSystem(scene, {
      max: 7000,
      texture: dropTexture(),
      colors: [0xffffff, 0xeaf4ff, 0xdcebf5],
      mid: 0.5,
      additive: false,
      alpha: 0.42,
      gravity: -9.81,
      drag: 0.06,
      turbulence: 5,
      windFactor: 0.15,
      collide: (x, z) => Math.max(t.heightAt(x, z), 0) + 0.3,
      fade: [0.86, 1],
      renderOrder: 24,
    });

    // Wasser fällt in Strähnen: jede Strähne wandert langsam hin und her
    this.strands = [];
    for (let i = 0; i < 7; i++) this.strands.push({ u: (i / 6 - 0.5) * this.width, ph: Math.random() * 10, w: 0.8 + Math.random() * 1.4, sp: 0.85 + Math.random() * 0.3 });

    // 4) Aufprall-Stelle: Schaum im Becken
    const land = this.v0 * this.fallT + 1.2;
    this.landPos = new THREE.Vector3(lip.x + flow.x * land, 0.3, lip.z + flow.z * land);
    this.foamTex = foamTexture();
    this.foamTex.repeat.set(2, 2);
    const foam = new THREE.Mesh(
      new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.foamTex, color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false })
    );
    foam.position.copy(this.landPos).setY(0.35);
    foam.renderOrder = 3;
    this.group.add(foam);
    this.foam = foam;
    // für Nebel, Ton und Wegweiser
    this.mistPos = this.landPos.clone().setY(1);
    this.mistDir = flow.clone();
    this.top = new THREE.Vector3(lip.x, lip.y, lip.z);
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

  /** Wie laut rauscht der Wasserfall an dieser Stelle? (0..1) */
  loudness(pos) {
    const d = Math.min(pos.distanceTo(this.landPos), pos.distanceTo(this.top) * 1.3);
    return Math.max(0, 1 - d / 900) ** 1.6;
  }

  /** ctx = { particles, camPos, wind, day } */
  update(dt, ctx) {
    this.time += dt;
    this.tex.offset.y = -this.time * 0.9; // Bach fliesst
    this.curtainTex.offset.y = -this.time * 2.4; // Vorhang fällt schnell
    this.foamTex.offset.set(Math.sin(this.time * 0.3) * 0.05, this.time * 0.02);
    this.foam.rotation.y = this.time * 0.05;
    const P = ctx.particles;
    const W = this.water;
    // Licht und Nebel wie der normale Rauch
    const su = P.smoke.uniforms;
    W.setEnvironment(su.uLight.value, su.uFogColor.value, su.uFogDensity.value);
    W.update(dt, ctx.wind);
    const dist = ctx.camPos.distanceTo(this.landPos);
    if (dist > 3500) return;

    // Wasser schiesst über die Kante
    const lip = this.lip;
    const f = this.flow;
    const sd = this.side;
    this.fallAcc += 1100 * P.q * dt;
    const T = this.time;
    while (this.fallAcc >= 1) {
      this.fallAcc -= 1;
      // meist in einer Strähne, manchmal einzelne Spritzer dazwischen
      const st = this.strands[Math.floor(Math.random() * this.strands.length)];
      const loose = Math.random() < 0.25;
      const u = loose
        ? (Math.random() - 0.5) * this.width * 1.1
        : st.u + Math.sin(T * 0.7 + st.ph) * 1.5 + (Math.random() + Math.random() - 1) * st.w;
      const sp = this.v0 * st.sp * (0.85 + Math.random() * 0.3) * (1 + 0.12 * Math.sin(T * 2.3 + st.ph));
      const late = Math.random() * dt; // gleichmässig im Zeitschritt verteilt
      const spread = loose ? 2.4 : 0.9;
      const b = 1.35 + Math.random() * 0.3; // hell: Wasser schäumt weiss
      W.spawn(
        lip.x + sd.x * u + f.x * (1.2 + sp * late), lip.y + 1 + Math.random() * 0.6, lip.z + sd.z * u + f.z * (1.2 + sp * late),
        f.x * sp + sd.x * (Math.random() - 0.5) * spread, (Math.random() - 0.6) * 1.2, f.z * sp + sd.z * (Math.random() - 0.5) * spread,
        this.fallT + 0.9 + Math.random() * 0.5, 0.9 + Math.random() * 1.4, loose ? 3 + Math.random() * 4 : 5 + Math.random() * 8,
        b, b, b * 1.03
      );
    }
    if (dist > 1800) return;
    // Spritzer am Aufprall
    const L = this.landPos;
    this.dropAcc += 160 * P.q * dt;
    while (this.dropAcc >= 1) {
      this.dropAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 10;
      const out = 3 + Math.random() * 6;
      W.spawn(
        L.x + Math.cos(a) * r, 0.5, L.z + Math.sin(a) * r,
        Math.cos(a) * out, 6 + Math.random() * 10, Math.sin(a) * out,
        1 + Math.random() * 0.7, 0.9, 2.6, 1.5, 1.5, 1.55
      );
    }
    // Gischt-Nebel steigt auf und treibt die Schlucht hinunter
    this.mistTimer -= dt;
    while (this.mistTimer <= 0) {
      this.mistTimer += 0.022;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 18;
      P.spray.spawn(
        L.x + Math.cos(a) * r, 1 + Math.random() * 4, L.z + Math.sin(a) * r,
        f.x * (2 + Math.random() * 6) + Math.cos(a) * 3, 3 + Math.random() * 8, f.z * (2 + Math.random() * 6) + Math.sin(a) * 3,
        3.5 + Math.random() * 2.5, 12, 40 + Math.random() * 22
      );
    }
  }
}
