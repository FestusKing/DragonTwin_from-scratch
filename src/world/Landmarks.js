// Besondere Orte: Felsbogen im Meer (zum Durchfliegen), Schiffswrack am Strand,
// Steinkreis auf einem Hügel, kleine Felseninsel und ferne Berge am Horizont.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/utils.js';
import { Noise2D } from '../core/noise.js';
import { PLACES } from './Terrain.js';
import { woodTexture, stoneTexture } from '../fx/Textures.js';

const _n3 = new Noise2D(5);
/** Verformt eine Geometrie "felsig". Gleiche Position → gleiche Verschiebung (keine Risse). */
function rocky(g, amount = 0.25, freq = 0.25) {
  const p = g.getAttribute('position');
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const n = _n3.noise(x * freq + z * freq * 0.7 + 3.1, y * freq - z * freq * 0.4);
    const s = 1 + n * amount;
    p.setXYZ(k, x * s, y * s, z * s);
  }
  return g;
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);

export class Landmarks {
  constructor(scene, terrain, colliders) {
    this.scene = scene;
    this.terrain = terrain;
    this.colliders = colliders;
    this.group = new THREE.Group();
    this.group.name = 'Landmarks';
    scene.add(this.group);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x7c756b, roughness: 0.95, flatShading: true });
  }

  /** Küste suchen: von (x, zStart) nach Süden gehen, bis Wasser kommt. */
  findCoast(x, zStart) {
    for (let z = zStart; z < 2500; z += 4) {
      if (this.terrain.heightAt(x, z) < 0) return z;
    }
    return 2000;
  }

  /** Positionen vorab planen (das Dorf braucht den Leuchtturm-Platz). */
  plan() {
    const V = PLACES.village;
    // Felsbogen: vor der Küste, südlich vom Dorf etwas nach Osten
    const ax = V.x + 320;
    let az = this.findCoast(ax, V.z);
    // weiter hinaus, bis das Wasser ca. 12 m tief ist
    while (this.terrain.heightAt(ax, az) > -12 && az < 2400) az += 4;
    this.arch = new THREE.Vector3(ax, 0, az);
    // Leuchtturm: an Land, auf der Klippe westlich des Bogens
    const lx = ax - 170;
    const lz = this.findCoast(lx, V.z) - 30;
    this.lighthouse = { x: lx, z: lz };
    // Schiffswrack am Strand östlich
    const wx = ax + 260;
    this.wreck = new THREE.Vector3(wx, 0, this.findCoast(wx, V.z) + 6);
    // Kleine Felseninsel weiter draussen
    this.islet = new THREE.Vector3(ax - 520, 0, az + 260);
    return this;
  }

  build() {
    this._arch();
    this._wreck();
    this._islet();
    this._stoneCircle();
    this._distantMountains();
    return this;
  }

  // Felsbogen: gebogene "Röhre" aus verformten Felsbrocken
  _arch() {
    const a = this.arch;
    const rnd = mulberry32(3);
    const parts = [];
    const span = 34; // Innenbreite
    const height = 36;
    const n = 26;
    this.archPoints = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const ang = Math.PI * t;
      const x = Math.cos(ang) * (span / 2 + 7);
      const y = Math.sin(ang) * height - 14;
      const r = 8 + Math.sin(ang * 1.0) * -1.5 + (i === 0 || i === n ? 5 : 0);
      const g = rocky(new THREE.IcosahedronGeometry(r, 1), 0.28, 0.2 + rnd() * 0.1);
      g.scale(1, 0.9, 0.95);
      g.translate(x, y, 0);
      parts.push(ni(g));
      this.archPoints.push(new THREE.Vector3(x, y, 0));
    }
    // Säulenfüsse
    for (const s of [-1, 1]) {
      const g = rocky(new THREE.CylinderGeometry(9, 13, 30, 9, 3), 0.18, 0.15);
      g.translate(s * (span / 2 + 7), -20, 0);
      parts.push(ni(g));
    }
    const geo = mergeGeometries(parts.map((g) => {
      g.deleteAttribute('uv');
      return g;
    }));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.rockMat);
    // Bogen um 90° drehen: Die Öffnung zeigt entlang der Küste (Ost-West),
    // so fliegt man bei der Talrunde vom Leuchtturm kommend hindurch.
    // Drehung um y um 90°: (x, y, z) → (z, y, -x)
    mesh.position.copy(a);
    mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    for (const p of this.archPoints) this.colliders.addSphere(a.x, a.y + p.y, a.z - p.x, 7.5);
    for (const s of [-1, 1]) this.colliders.addBox(a.x, -10, a.z - s * (span / 2 + 7), 10, 18, 10);
    this.archCenter = new THREE.Vector3(a.x, 11, a.z);
    this.archTop = new THREE.Vector3(a.x, height - 14 + 8, a.z);
  }

  _wreck() {
    const w = this.wreck;
    const y = Math.max(this.terrain.heightAt(w.x, w.z), -1);
    const mat = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x7a6a5a, roughness: 1, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.position.set(w.x, y, w.z);
    g.rotation.set(0.12, 0.8, 0.35);
    const hull = new THREE.CylinderGeometry(4, 4, 22, 12, 1, true, Math.PI / 2, Math.PI);
    hull.rotateX(-Math.PI / 2);
    hull.scale(1, 0.8, 1);
    const hm = new THREE.Mesh(hull, mat);
    // Rippen
    const ribs = [];
    for (let i = 0; i < 7; i++) {
      const r = new THREE.TorusGeometry(4, 0.25, 4, 8, Math.PI);
      r.rotateZ(Math.PI);
      r.translate(0, 0, -9 + i * 3);
      ribs.push(r);
    }
    const rm = new THREE.Mesh(mergeGeometries(ribs), mat);
    rm.scale.set(1, 0.8, 1);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 16, 6), mat);
    mast.position.set(0, 5, 2);
    mast.rotation.z = 0.7;
    g.add(hm, rm, mast);
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
    this.group.add(g);
    this.wreckTop = new THREE.Vector3(w.x, y + 3, w.z);
  }

  _islet() {
    const p = this.islet;
    const rnd = mulberry32(9);
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const g = rocky(new THREE.IcosahedronGeometry(8 + rnd() * 8, 1), 0.3, 0.12);
      g.scale(1, 0.75 + rnd() * 0.4, 1);
      g.translate((rnd() - 0.5) * 30, -2 + rnd() * 8, (rnd() - 0.5) * 30);
      g.deleteAttribute('uv');
      parts.push(ni(g));
    }
    const geo = mergeGeometries(parts);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.rockMat);
    m.position.copy(p);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    // höchsten Punkt für eine Ziege merken
    geo.computeBoundingBox();
    this.isletTop = new THREE.Vector3(p.x, geo.boundingBox.max.y - 1.5, p.z);
    this.colliders.addSphere(p.x, 0, p.z, 18);
    // genauen Gipfel suchen (Vertex mit grösstem y)
    const pos = geo.getAttribute('position');
    let best = -Infinity;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) > best) {
        best = pos.getY(k);
        this.isletTop.set(p.x + pos.getX(k), best - 0.8, p.z + pos.getZ(k));
      }
    }
  }

  // Mystischer Steinkreis auf einem Hügel westlich vom Dorf
  _stoneCircle() {
    const V = PLACES.village;
    let best = null;
    for (let a = 2.2; a < 4.4; a += 0.1) {
      for (let r = 700; r < 1300; r += 50) {
        const x = V.x + Math.cos(a) * r;
        const z = V.z + Math.sin(a) * r;
        const h = this.terrain.heightAt(x, z);
        if (h < 20 || h > 200) continue;
        const n = this.terrain.normalAt(x, z);
        if (n.y < 0.96) continue;
        if (!best || h > best.h) best = { x, z, h };
      }
    }
    if (!best) return;
    const mat = new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0x9a968c, roughness: 1 });
    const rnd = mulberry32(12);
    const parts = [];
    const R = 14;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const h = 5 + rnd() * 2.5;
      const g = new THREE.BoxGeometry(2 + rnd() * 0.6, h, 1.4, 1, 2, 1);
      g.translate(0, h / 2 - 0.5, 0);
      g.rotateY(-a);
      g.rotateZ((rnd() - 0.5) * 0.12);
      g.translate(Math.cos(a) * R, 0, Math.sin(a) * R);
      parts.push(ni(g));
      // Deckstein auf jedem zweiten Paar
      if (i % 2 === 0) {
        const a2 = a + Math.PI / 12;
        const l = new THREE.BoxGeometry(1.6, 1, 8);
        l.rotateY(-a2 + Math.PI / 2);
        l.translate(Math.cos(a2) * R, h - 0.2, Math.sin(a2) * R);
        parts.push(ni(l));
      }
    }
    const altar = new THREE.BoxGeometry(4, 1.2, 2.4);
    altar.translate(0, 0.3, 0);
    parts.push(ni(altar));
    const m = new THREE.Mesh(mergeGeometries(parts), mat);
    m.position.set(best.x, best.h, best.z);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    this.stoneCircle = new THREE.Vector3(best.x, best.h, best.z);
    this.stoneAltar = new THREE.Vector3(best.x, best.h + 1.1, best.z);
  }

  // Ferne Berge als Silhouette (verschwinden im Dunst → Tiefe)
  _distantMountains() {
    const n = new Noise2D(88);
    const seg = 180;
    const pos = [];
    const idx = [];
    const R1 = 9000;
    const R2 = 13000;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      // im Süden (Meer) flacher, im Norden hoch
      const north = Math.max(0, -Math.sin(a)) * 0.8 + 0.2;
      const h = (n.ridged(a * 3, 0.5, 4) * 1400 + 200) * north;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      pos.push(cx * R1, -60, cz * R1);
      pos.push(cx * (R1 + R2) * 0.5, h, cz * (R1 + R2) * 0.5);
      pos.push(cx * R2, -60, cz * R2);
      if (i < seg) {
        const b = i * 3;
        idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0x55606a, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    this.group.add(m);
  }
}
