// Terrain = die Landschaft. Die Höhe jedes Punktes wird aus Rauschen
// berechnet (Hügel + Berge) und dann gezielt geformt: See ausheben,
// Fluss graben, Dorf-Plateau ebnen, Küste absenken.
import * as THREE from 'three';
import { Noise2D } from '../core/noise.js';
import { clamp, lerp, smoothstep, nextFrame } from '../core/utils.js';
import { detailNoiseTexture } from '../fx/Textures.js';

export const WORLD_SIZE = 5000; // Meter (5 × 5 km)
export const HALF = WORLD_SIZE / 2;
export const SEGMENTS = 400; // Gitterzellen pro Seite → 12.5 m pro Zelle
export const WATER_LEVEL = 0;

// Wichtige Orte der Karte (x, z in Metern)
export const PLACES = {
  peak: { x: -700, z: -1500 }, // "Drachenhorn" – der grosse Berg
  peak2: { x: 650, z: -1750 },
  lake: { x: 650, z: -250, r: 330 },
  island: { x: 720, z: -230, r: 42 },
  village: { x: -300, z: 450, r: 240, h: 24 },
  river: [
    [880, -120], [1060, 150], [1180, 550], [1300, 950], [1400, 1350], [1500, 1850], [1580, 2400],
  ],
};

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function distToPolyline(x, z, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    d = Math.min(d, distToSegment(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  return d;
}

export class Terrain {
  constructor(seed = 1337) {
    this.noise = new Noise2D(seed);
    this.N = SEGMENTS + 1; // Punkte pro Seite
    this.cell = WORLD_SIZE / SEGMENTS;
    this.heights = new Float32Array(this.N * this.N);
    this.normals = new Float32Array(this.N * this.N * 3);
    this.group = new THREE.Group();
    this.group.name = 'Terrain';
    this.uniforms = null;
  }

  /** Die eigentliche "Landschafts-Formel" für einen Punkt. */
  rawHeight(x, z) {
    const n = this.noise;
    // Domain-Warp: Koordinaten leicht verbiegen → natürlichere Formen
    const wx = x + n.fbm(x * 0.0005 + 11, z * 0.0005, 3) * 220;
    const wz = z + n.fbm(x * 0.0005, z * 0.0005 + 23, 3) * 220;

    // 1) Sanfte Hügel
    let h = 22 + n.fbm(wx * 0.0011, wz * 0.0011, 5) * 48;
    h += n.fbm(wx * 0.005, wz * 0.005, 3) * 5;

    // 2) Gebirge im Norden (negatives z)
    const mMask = smoothstep(150, -1300, wz);
    const ridge = n.ridged(wx * 0.0011 + 5, wz * 0.0011 + 9, 5);
    h += mMask * (ridge * 430 + 30);
    const P = PLACES;
    const dp = Math.hypot(x - P.peak.x, z - P.peak.z);
    h += 470 * Math.exp(-(dp * dp) / (470 * 470)) * (0.75 + 0.5 * ridge);
    const dp2 = Math.hypot(x - P.peak2.x, z - P.peak2.z);
    h += 280 * Math.exp(-(dp2 * dp2) / (380 * 380)) * (0.7 + 0.5 * ridge);

    // 3) Flusstal und Flussbett (liegt unter dem Meeresspiegel → Wasser)
    const dr = distToPolyline(x, z, P.river) + n.noise(x * 0.006, z * 0.006) * 14;
    h = lerp(h, Math.min(h, 9), smoothstep(230, 70, dr));
    h = lerp(h, -7, smoothstep(62, 22, dr));

    // 4) See ausheben
    const dl = Math.hypot(x - P.lake.x, z - P.lake.z) + n.noise(x * 0.004, z * 0.004) * 45;
    h = lerp(h, -15, smoothstep(P.lake.r + 130, P.lake.r - 50, dl));
    // kleine Insel im See
    const di = Math.hypot(x - P.island.x, z - P.island.z);
    h = Math.max(h, lerp(-15, 6.5, smoothstep(P.island.r, P.island.r * 0.3, di)));

    // 5) Dorf-Plateau ebnen
    const dv = Math.hypot(x - P.village.x, z - P.village.z);
    h = lerp(h, P.village.h + n.fbm(x * 0.004, z * 0.004, 2) * 2.5, smoothstep(P.village.r + 160, P.village.r - 30, dv));

    // 6) Küste im Süden + Inselrand
    const coastLine = 1450 + n.fbm(x * 0.0009 + 3, 0.5, 4) * 380;
    const coastT = smoothstep(coastLine - 260, coastLine + 160, z);
    const r = Math.pow(Math.pow(Math.abs(wx) / HALF, 4) + Math.pow(Math.abs(wz) / HALF, 4), 0.25);
    const edgeT = smoothstep(0.8, 0.985, r);
    const seaT = Math.max(coastT, edgeT);
    h = lerp(h, -42 + n.fbm(x * 0.003, z * 0.003, 2) * 10, seaT);
    return h;
  }

  /** Höhen für das ganze Gitter berechnen (dauert etwas → in Etappen). */
  async generate(onProgress = () => {}) {
    const { N, cell, heights } = this;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * cell;
      for (let i = 0; i < N; i++) {
        heights[j * N + i] = this.rawHeight(-HALF + i * cell, z);
      }
      if (j % 40 === 0) {
        onProgress(j / N);
        await nextFrame();
      }
    }
    // Normalen (Flächen-Richtung) aus den Nachbarhöhen
    const nr = this.normals;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const hl = heights[j * N + Math.max(0, i - 1)];
        const hr = heights[j * N + Math.min(N - 1, i + 1)];
        const hd = heights[Math.max(0, j - 1) * N + i];
        const hu = heights[Math.min(N - 1, j + 1) * N + i];
        let nx = (hl - hr) / (2 * cell);
        let nz = (hd - hu) / (2 * cell);
        const len = Math.hypot(nx, 1, nz);
        const k = (j * N + i) * 3;
        nr[k] = nx / len;
        nr[k + 1] = 1 / len;
        nr[k + 2] = nz / len;
      }
    }
    this._findLandmarks();
    onProgress(1);
  }

  /** Höhe an beliebiger Stelle (bilinear zwischen Gitterpunkten). */
  heightAt(x, z) {
    const gx = (x + HALF) / this.cell;
    const gz = (z + HALF) / this.cell;
    if (gx < 0 || gz < 0 || gx >= SEGMENTS || gz >= SEGMENTS) return -42;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const N = this.N;
    const h = this.heights;
    const a = h[j * N + i];
    const b = h[j * N + i + 1];
    const c = h[(j + 1) * N + i];
    const d = h[(j + 1) * N + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /** Oberfläche: Boden oder Wasser – je nachdem was höher ist. */
  surfaceAt(x, z) {
    return Math.max(this.heightAt(x, z), WATER_LEVEL);
  }

  normalAt(x, z, target = new THREE.Vector3()) {
    const gx = clamp(Math.round((x + HALF) / this.cell), 0, SEGMENTS);
    const gz = clamp(Math.round((z + HALF) / this.cell), 0, SEGMENTS);
    const k = (gz * this.N + gx) * 3;
    return target.set(this.normals[k], this.normals[k + 1], this.normals[k + 2]);
  }

  _findLandmarks() {
    // Echten Gipfel in der Nähe der geplanten Bergposition suchen
    const find = (p, radius) => {
      let best = { x: p.x, z: p.z, h: -Infinity };
      for (let z = p.z - radius; z <= p.z + radius; z += 10) {
        for (let x = p.x - radius; x <= p.x + radius; x += 10) {
          const h = this.heightAt(x, z);
          if (h > best.h) best = { x, z, h };
        }
      }
      return best;
    };
    this.peak = find(PLACES.peak, 400);
    this.peak2 = find(PLACES.peak2, 400);
    let maxH = -Infinity;
    for (const h of this.heights) maxH = Math.max(maxH, h);
    this.maxHeight = maxH;
  }

  /** Meshes (in 8×8 Stücken → nur sichtbare Stücke werden gezeichnet). */
  buildMesh() {
    const CH = 8;
    const per = SEGMENTS / CH;
    const { N, cell, heights, normals } = this;
    this.material = this._createMaterial();

    for (let cz = 0; cz < CH; cz++) {
      for (let cx = 0; cx < CH; cx++) {
        const vc = (per + 1) * (per + 1);
        const pos = new Float32Array(vc * 3);
        const nor = new Float32Array(vc * 3);
        const uv = new Float32Array(vc * 2);
        let v = 0;
        for (let j = 0; j <= per; j++) {
          for (let i = 0; i <= per; i++) {
            const gi = cx * per + i;
            const gj = cz * per + j;
            const x = -HALF + gi * cell;
            const z = -HALF + gj * cell;
            const k = gj * N + gi;
            pos[v * 3] = x;
            pos[v * 3 + 1] = heights[k];
            pos[v * 3 + 2] = z;
            nor[v * 3] = normals[k * 3];
            nor[v * 3 + 1] = normals[k * 3 + 1];
            nor[v * 3 + 2] = normals[k * 3 + 2];
            uv[v * 2] = x * 0.06;
            uv[v * 2 + 1] = z * 0.06;
            v++;
          }
        }
        const idx = new Uint32Array(per * per * 6);
        let t = 0;
        for (let j = 0; j < per; j++) {
          for (let i = 0; i < per; i++) {
            const a = j * (per + 1) + i;
            const b = a + 1;
            const c = a + per + 1;
            const d = c + 1;
            idx[t++] = a; idx[t++] = c; idx[t++] = b;
            idx[t++] = b; idx[t++] = c; idx[t++] = d;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
      }
    }
    this._createHeightTexture();
    return this.group;
  }

  // ---------- Splat-Map: Wege und Felder (wird vom Dorf bemalt) ----------

  createSplat() {
    const S = 2048; // ≈ 2.4 m pro Pixel
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(0, 0, S, S);
    this.splatCanvas = c;
    this.splatCtx = g;
    this.splatSize = S;
    this.splatTexture = new THREE.CanvasTexture(c);
    this.splatTexture.colorSpace = THREE.NoColorSpace;
    this.splatTexture.generateMipmaps = true;
    this.splatTexture.minFilter = THREE.LinearMipmapLinearFilter;
    return g;
  }

  /** Weltkoordinate → Pixel in der Splat-Map */
  toSplat(x, z) {
    return [((x + HALF) / WORLD_SIZE) * this.splatSize, ((z + HALF) / WORLD_SIZE) * this.splatSize];
  }

  finishSplat() {
    this.splatTexture.needsUpdate = true;
    this.splatData = this.splatCtx.getImageData(0, 0, this.splatSize, this.splatSize).data;
  }

  /** Liegt hier ein Weg oder Feld? (0..1 je Kanal) */
  splatAt(x, z) {
    if (!this.splatData) return [0, 0, 0];
    const [px, pz] = this.toSplat(x, z);
    const i = (clamp(Math.floor(pz), 0, this.splatSize - 1) * this.splatSize + clamp(Math.floor(px), 0, this.splatSize - 1)) * 4;
    return [this.splatData[i] / 255, this.splatData[i + 1] / 255, this.splatData[i + 2] / 255];
  }

  // ---------- Brandspuren (dynamisch) ----------

  _createScorch() {
    const S = 512;
    this.scorchSize = S;
    this.scorchData = new Uint8Array(S * S);
    this.scorchTexture = new THREE.DataTexture(this.scorchData, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    this.scorchTexture.magFilter = THREE.LinearFilter;
    this.scorchTexture.minFilter = THREE.LinearFilter;
    this.scorchTexture.needsUpdate = true;
    this.scorchDirty = false;
    this.scorchTimer = 0;
  }

  /** Brandfleck auf den Boden malen */
  paintScorch(x, z, radius = 4, amount = 0.3) {
    const S = this.scorchSize;
    const px = ((x + HALF) / WORLD_SIZE) * S;
    const pz = ((z + HALF) / WORLD_SIZE) * S;
    const r = (radius / WORLD_SIZE) * S + 0.5;
    const x0 = Math.max(0, Math.floor(px - r));
    const x1 = Math.min(S - 1, Math.ceil(px + r));
    const z0 = Math.max(0, Math.floor(pz - r));
    const z1 = Math.min(S - 1, Math.ceil(pz + r));
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i - px, j - pz) / r;
        if (d >= 1) continue;
        const k = j * S + i;
        this.scorchData[k] = Math.min(235, this.scorchData[k] + (1 - d) * amount * 255);
      }
    }
    this.scorchDirty = true;
  }

  clearScorch() {
    this.scorchData.fill(0);
    this.scorchTexture.needsUpdate = true;
  }

  update(dt, wetness) {
    this.scorchTimer -= dt;
    if (this.scorchDirty && this.scorchTimer <= 0) {
      this.scorchTexture.needsUpdate = true;
      this.scorchDirty = false;
      this.scorchTimer = 0.2;
    }
    if (this.uniforms) this.uniforms.uWet.value = wetness;
  }

  // ---------- Höhen-Textur für das Wasser (Ufer-Schaum, Tiefe) ----------

  _createHeightTexture() {
    const N = this.N;
    const data = new Uint16Array(N * N);
    for (let k = 0; k < N * N; k++) data[k] = THREE.DataUtils.toHalfFloat(this.heights[k]);
    const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    this.heightTexture = t;
  }

  // ---------- Boden-Material ----------

  _createMaterial() {
    this._createScorch();
    if (!this.splatTexture) this.createSplat();
    const detail = detailNoiseTexture();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.93,
      metalness: 0,
      bumpMap: detail,
      bumpScale: 1.6,
    });
    const col = (hex) => new THREE.Color(hex);
    const uniforms = {
      uSplat: { value: this.splatTexture },
      uScorch: { value: this.scorchTexture },
      uDetail: { value: detail },
      uSize: { value: WORLD_SIZE },
      uSnow: { value: 420 },
      uWet: { value: 0 },
      cGrassA: { value: col(0x4a6a24) },
      cGrassB: { value: col(0x7a8a3a) },
      cForest: { value: col(0x33501c) },
      cSand: { value: col(0xc9b58a) },
      cRock: { value: col(0x77706a) },
      cRock2: { value: col(0x524c47) },
      cSnow: { value: col(0xf2f5fa) },
      cDirt: { value: col(0x7a5f40) },
      cWheat: { value: col(0xc9a650) },
      cCrop: { value: col(0x5c7a2c) },
    };
    this.uniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uSplat, uScorch, uDetail;
uniform float uSize, uSnow, uWet;
uniform vec3 cGrassA, cGrassB, cForest, cSand, cRock, cRock2, cSnow, cDirt, cWheat, cCrop;
float gSnowT;`
        )
        .replace(
          '#include <map_fragment>',
          `
vec3 wp = vWPos;
vec3 wn = normalize(vWNrm);
float slope = 1.0 - wn.y;
vec2 suv = vec2(wp.x / uSize + 0.5, 0.5 - wp.z / uSize);
vec4 splat = texture2D(uSplat, suv);
float det = texture2D(uDetail, wp.xz * 0.045).r;
float det2 = texture2D(uDetail, wp.xz * 0.0045).r;
float det3 = texture2D(uDetail, wp.xz * 0.0009).r;
float n1 = det2 * 2.0 - 1.0;
float n2 = det3 * 2.0 - 1.0;
vec3 grass = mix(cGrassA, cGrassB, smoothstep(-0.25, 0.55, n1 + n2 * 0.6));
grass = mix(grass, cForest, smoothstep(0.1, 0.6, -n2) * 0.7);
vec3 col = grass;
col = mix(col, cWheat * (0.8 + 0.4 * det), splat.g);
col = mix(col, cCrop * (0.8 + 0.4 * det), splat.b);
col = mix(col, cDirt * (0.75 + 0.5 * det), splat.r);
float sandT = 1.0 - smoothstep(1.5, 4.5 + n1 * 2.0, wp.y);
col = mix(col, cSand * (0.85 + 0.3 * det), sandT);
vec3 rock = mix(cRock2, cRock, det * 0.7 + det2 * 0.5);
float rockT = smoothstep(0.24, 0.4, slope + n1 * 0.06);
rockT = max(rockT, smoothstep(250.0, 430.0, wp.y + n1 * 70.0) * 0.55);
col = mix(col, rock, rockT);
gSnowT = smoothstep(uSnow - 40.0, uSnow + 30.0, wp.y + n1 * 60.0) * (1.0 - smoothstep(0.38, 0.6, slope));
col = mix(col, cSnow, gSnowT);
col *= mix(1.0, 0.45, smoothstep(0.0, -8.0, wp.y));
float sc = texture2D(uScorch, vec2(wp.x / uSize + 0.5, wp.z / uSize + 0.5)).r;
col = mix(col, vec3(0.025, 0.02, 0.018), sc);
col *= 1.0 - uWet * 0.3 * (1.0 - gSnowT);
diffuseColor.rgb = col * (0.82 + det * 0.36);
`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.55, gSnowT * 0.5);
roughnessFactor *= 1.0 - uWet * 0.45;`
        );
    };
    return mat;
  }
}
