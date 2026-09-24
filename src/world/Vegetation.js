// Bäume, Büsche und Felsen. Tausende Objekte → "Instancing":
// Ein Modell wird einmal an die Grafikkarte geschickt und dann an vielen
// Positionen gezeichnet. Das ist VIEL schneller als tausend einzelne Objekte.
// Die Karte ist in 4×4 Stücke geteilt, damit Unsichtbares weggelassen wird.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D } from '../core/noise.js';
import { mulberry32, smoothstep } from '../core/utils.js';
import { HALF, WORLD_SIZE } from './Terrain.js';

const CHUNKS = 4;
const CHUNK_SIZE = WORLD_SIZE / CHUNKS;

function colored(geo, hex) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function jitter(geo, amount, seed) {
  const rnd = mulberry32(seed);
  const p = geo.getAttribute('position');
  // gleiche Positionen gleich verschieben (sonst entstehen Löcher)
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(rnd() - 0.5) * amount, (rnd() - 0.5) * amount, (rnd() - 0.5) * amount]);
    const d = map.get(key);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  return geo;
}

export function makeConifer() {
  const parts = [
    colored(new THREE.CylinderGeometry(0.3, 0.5, 4, 6).translate(0, 2, 0), 0x5a3d25),
    colored(new THREE.ConeGeometry(3.3, 5.2, 7).translate(0, 5, 0), 0x2b4a22),
    colored(new THREE.ConeGeometry(2.6, 4.6, 7).rotateY(0.4).translate(0, 7.6, 0), 0x315429),
    colored(new THREE.ConeGeometry(1.7, 4.0, 7).rotateY(0.9).translate(0, 10.1, 0), 0x3a5f2f),
  ];
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

export function makeBroadleaf() {
  const parts = [
    colored(new THREE.CylinderGeometry(0.35, 0.6, 5, 6).translate(0, 2.5, 0), 0x5b4029),
    colored(jitter(new THREE.IcosahedronGeometry(3.4, 1), 0.9, 1).scale(1, 0.85, 1).translate(0, 7, 0), 0x4b6c29),
    colored(jitter(new THREE.IcosahedronGeometry(2.3, 1), 0.7, 2).translate(1.9, 6.1, 0.8), 0x567a2e),
    colored(jitter(new THREE.IcosahedronGeometry(2.1, 1), 0.7, 3).translate(-1.6, 6.5, -1.1), 0x44632a),
  ];
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

export function makeDeadTree() {
  const parts = [colored(new THREE.CylinderGeometry(0.22, 0.45, 6, 5).translate(0, 3, 0), 0x1d1a17)];
  const rnd = mulberry32(8);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.06, 0.15, 2.6, 4).translate(0, 1.3, 0);
    b.rotateZ(0.7 + rnd() * 0.4);
    b.rotateY((i / 4) * Math.PI * 2 + rnd());
    b.translate(0, 3 + rnd() * 2.2, 0);
    parts.push(colored(b, 0x1d1a17));
  }
  return mergeGeometries(parts);
}

export function makeBush() {
  const g = mergeGeometries([
    colored(jitter(new THREE.IcosahedronGeometry(1.4, 1), 0.5, 4).scale(1.2, 0.8, 1).translate(0, 0.8, 0), 0x3f5d24),
    colored(jitter(new THREE.IcosahedronGeometry(1.0, 1), 0.4, 5).translate(0.9, 0.6, 0.4), 0x4a6b2a),
  ]);
  g.computeVertexNormals();
  return g;
}

export function makeRock(seed) {
  const g = colored(jitter(new THREE.IcosahedronGeometry(1, 0), 0.55, seed).scale(1.3, 0.8, 1.1), 0x8a847c);
  g.computeVertexNormals();
  return g;
}

export class Vegetation {
  /**
   * @param terrain  Terrain
   * @param exclusions Liste {x, z, r}: dort keine Bäume (Häuser, Burg …)
   * @param density  1 = hohe Qualität
   */
  constructor(scene, terrain, exclusions, density = 1) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'Vegetation';
    scene.add(this.group);
    this.trees = []; // alle Bäume (für das Feuer-System)
    this.time = { value: 0 };
    this.wind = { value: 0.3 };

    const types = [
      { name: 'conifer', geo: makeConifer(), burnable: true, height: 11.5 },
      { name: 'broad', geo: makeBroadleaf(), burnable: true, height: 9.5 },
      { name: 'bush', geo: makeBush(), burnable: false, height: 2 },
      { name: 'rock', geo: makeRock(12), burnable: false, height: 1.5 },
    ];
    this.types = types;
    this.material = this._material(true);
    this.rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    this.deadGeo = makeDeadTree();
    this.deadMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

    this._place(exclusions, density);
  }

  _material(sway) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88 });
    if (sway) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.time;
        shader.uniforms.uWind = this.wind;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float sw = sin(uTime * 1.4 + ip.x * 0.05 + ip.z * 0.043) + 0.4 * sin(uTime * 3.1 + ip.z * 0.2);
  float k = max(0.0, position.y - 2.5) * 0.035 * (0.3 + uWind);
  transformed.x += sw * k;
  transformed.z += sw * k * 0.6;
#endif`
          );
      };
    }
    return mat;
  }

  _place(exclusions, density) {
    const t = this.terrain;
    const rnd = mulberry32(999);
    const forest = new Noise2D(31);
    const kind = new Noise2D(47);
    const perChunk = [];
    for (let i = 0; i < CHUNKS * CHUNKS; i++) perChunk.push([[], [], [], []]);

    const excluded = (x, z) => {
      for (const e of exclusions) {
        const dx = x - e.x;
        const dz = z - e.z;
        if (dx * dx + dz * dz < e.r * e.r) return true;
      }
      return false;
    };
    const nrm = new THREE.Vector3();
    const targetTrees = Math.floor(7500 * density);
    let trees = 0;
    let attempts = 0;
    while (trees < targetTrees && attempts < targetTrees * 14) {
      attempts++;
      const x = (rnd() - 0.5) * (WORLD_SIZE - 200);
      const z = (rnd() - 0.5) * (WORLD_SIZE - 200);
      const h = t.heightAt(x, z);
      if (h < 3.5 || h > 380) continue;
      t.normalAt(x, z, nrm);
      if (nrm.y < 0.8) continue;
      const f = forest.fbm(x * 0.0016, z * 0.0016, 4);
      const p = smoothstep(-0.05, 0.35, f) * 0.95 + 0.04;
      if (rnd() > p) continue;
      const sp = t.splatAt(x, z);
      if (sp[0] + sp[1] + sp[2] > 0.15) continue;
      if (excluded(x, z)) continue;
      const conProb = smoothstep(60, 190, h) * 0.85 + (kind.noise(x * 0.002, z * 0.002) * 0.5 + 0.5) * 0.35;
      const type = rnd() < conProb ? 0 : 1;
      const ci = this._chunkIndex(x, z);
      const s = 0.75 + rnd() * 0.6;
      perChunk[ci][type].push({ x, y: h - 0.4, z, s, r: rnd() * Math.PI * 2, type });
      trees++;
    }
    // Büsche
    const bushes = Math.floor(2500 * density);
    for (let i = 0, a = 0; i < bushes && a < bushes * 8; a++) {
      const x = (rnd() - 0.5) * (WORLD_SIZE - 200);
      const z = (rnd() - 0.5) * (WORLD_SIZE - 200);
      const h = t.heightAt(x, z);
      if (h < 3 || h > 300) continue;
      t.normalAt(x, z, nrm);
      if (nrm.y < 0.8) continue;
      const sp = t.splatAt(x, z);
      if (sp[0] + sp[1] + sp[2] > 0.2 || excluded(x, z)) continue;
      perChunk[this._chunkIndex(x, z)][2].push({ x, y: h - 0.2, z, s: 0.7 + rnd() * 0.9, r: rnd() * 6.28, type: 2 });
      i++;
    }
    // Felsen: eher an Hängen und in den Bergen
    const rocks = Math.floor(1800 * density);
    for (let i = 0, a = 0; i < rocks && a < rocks * 10; a++) {
      const x = (rnd() - 0.5) * (WORLD_SIZE - 200);
      const z = (rnd() - 0.5) * (WORLD_SIZE - 200);
      const h = t.heightAt(x, z);
      if (h < 1) continue;
      t.normalAt(x, z, nrm);
      const want = nrm.y < 0.9 || h > 200 ? 0.9 : 0.12;
      if (rnd() > want) continue;
      if (excluded(x, z)) continue;
      const big = rnd() < 0.12;
      perChunk[this._chunkIndex(x, z)][3].push({ x, y: h - 0.3, z, s: big ? 4 + rnd() * 5 : 0.8 + rnd() * 2, r: rnd() * 6.28, type: 3 });
      i++;
    }

    // Instanced Meshes pro Stück erzeugen
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    this.chunks = [];
    for (let ci = 0; ci < perChunk.length; ci++) {
      const chunk = { meshes: [], dead: null, deadCount: 0 };
      let burnableCount = 0;
      for (let ty = 0; ty < 4; ty++) {
        const list = perChunk[ci][ty];
        if (!list.length) {
          chunk.meshes.push(null);
          continue;
        }
        const type = this.types[ty];
        const mat = ty === 3 ? this.rockMaterial : this.material;
        const mesh = new THREE.InstancedMesh(type.geo, mat, list.length);
        mesh.castShadow = true;
        mesh.receiveShadow = ty !== 3 ? false : true;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          pos.set(it.x, it.y, it.z);
          q.setFromAxisAngle(up, it.r);
          if (ty === 3) sc.set(it.s, it.s * (0.6 + (i % 5) * 0.12), it.s * 1.1);
          else sc.set(it.s, it.s * (0.9 + (i % 7) * 0.04), it.s);
          m.compose(pos, q, sc);
          mesh.setMatrixAt(i, m);
          const v = 0.82 + ((i * 7919) % 100) / 300;
          if (ty === 3) col.setRGB(v, v * 0.98, v * 0.95);
          else col.setRGB(v * (0.95 + ((i * 31) % 10) / 100), v, v * 0.9);
          mesh.setColorAt(i, col);
          if (type.burnable) {
            it.chunk = ci;
            it.index = i;
            it.mesh = mesh;
            it.color = col.clone();
            it.matrix = m.clone();
            it.height = type.height * it.s;
            this.trees.push(it);
            burnableCount++;
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        chunk.meshes.push(mesh);
      }
      if (burnableCount > 0) {
        const dead = new THREE.InstancedMesh(this.deadGeo, this.deadMaterial, burnableCount);
        dead.count = 0;
        dead.castShadow = true;
        dead.frustumCulled = false;
        this.group.add(dead);
        chunk.dead = dead;
      }
      this.chunks.push(chunk);
    }
  }

  _chunkIndex(x, z) {
    const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor((x + HALF) / CHUNK_SIZE)));
    const cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor((z + HALF) / CHUNK_SIZE)));
    return cz * CHUNKS + cx;
  }

  /** Brennfortschritt anzeigen: Baum wird dunkel und glüht. t = 0..1 */
  setBurning(tree, t) {
    const c = new THREE.Color().copy(tree.color);
    const ember = new THREE.Color(0.35, 0.12, 0.04);
    const coal = new THREE.Color(0.08, 0.07, 0.06);
    if (t < 0.5) c.lerp(ember, t * 2);
    else c.copy(ember).lerp(coal, (t - 0.5) * 2);
    tree.mesh.setColorAt(tree.index, c);
    tree.mesh.instanceColor.needsUpdate = true;
  }

  /** Baum ist abgebrannt → verkohlten Stamm zeigen. */
  setBurnt(tree) {
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    tree.mesh.setMatrixAt(tree.index, m);
    tree.mesh.instanceMatrix.needsUpdate = true;
    const chunk = this.chunks[tree.chunk];
    if (chunk.dead && chunk.deadCount < chunk.dead.instanceMatrix.count) {
      const dm = new THREE.Matrix4().compose(
        new THREE.Vector3(tree.x, tree.y, tree.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.r),
        new THREE.Vector3(tree.s, tree.s * 1.1, tree.s)
      );
      chunk.dead.setMatrixAt(chunk.deadCount++, dm);
      chunk.dead.count = chunk.deadCount;
      chunk.dead.instanceMatrix.needsUpdate = true;
    }
  }

  /** Alles wieder wie neu (Neustart). */
  reset() {
    for (const tree of this.trees) {
      tree.mesh.setMatrixAt(tree.index, tree.matrix);
      tree.mesh.setColorAt(tree.index, tree.color);
      tree.mesh.instanceMatrix.needsUpdate = true;
      tree.mesh.instanceColor.needsUpdate = true;
    }
    for (const c of this.chunks) {
      if (c.dead) {
        c.deadCount = 0;
        c.dead.count = 0;
      }
    }
  }

  update(dt, wind) {
    this.time.value += dt;
    this.wind.value = wind;
  }
}
