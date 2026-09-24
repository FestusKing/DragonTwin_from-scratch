// Terrain = die Landschaft. Die Höhe jedes Punktes wird aus Rauschen
// berechnet (Hügel + Berge) und dann gezielt geformt: See ausheben,
// Fluss graben, Dorf-Plateau ebnen, Küste absenken.
import * as THREE from 'three';
import { Noise2D } from '../core/noise.js';
import { clamp, lerp, smoothstep, nextFrame } from '../core/utils.js';
import { detailNoiseTexture } from '../fx/Textures.js';
import { terrainTextureArrays } from '../fx/PhotoTextures.js';
import { addAtmosphereUniforms } from '../fx/Atmosphere.js';

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
    // Grate (ridged) gemischt mit weichem Rauschen → massive statt nadelspitze Berge
    const ridge = n.ridged(wx * 0.0009 + 5, wz * 0.0009 + 9, 6, 2.0, 0.55);
    const soft = n.fbm(wx * 0.0007 + 40, wz * 0.0007, 4) * 0.5 + 0.5;
    h += mMask * (ridge * 330 + soft * 140 + 30);
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

  /** Wald-Karte der Vegetation übernehmen (dunklerer Waldboden). */
  setForestMap(tex) {
    this.uniforms.uForest.value = tex;
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

  /**
   * Grafik-Qualität "Niedrig": ohne triplanare Felsen und ohne die zweite,
   * grosse Gras-Textur (spart Textur-Zugriffe auf schwachen Grafikchips).
   */
  setDetail(on) {
    const m = this.material;
    if (!m?.defines || !('PHOTO_TEX' in m.defines)) return;
    if ('TERRAIN_DETAIL' in m.defines === on) return;
    if (on) m.defines.TERRAIN_DETAIL = '';
    else delete m.defines.TERRAIN_DETAIL;
    m.needsUpdate = true;
    // schräg gesehener Boden: scharf (8) oder schneller (2)
    for (const t of [this.uniforms.uCol.value, this.uniforms.uNor.value]) {
      t.anisotropy = on ? 8 : 2;
      t.needsUpdate = true;
    }
  }

  _createMaterial() {
    this._createScorch();
    if (!this.splatTexture) this.createSplat();
    const detail = detailNoiseTexture();
    // Foto-Texturen (falls geladen). Die Reihenfolge ist die Schicht-Nummer im Shader:
    // 0 Gras, 1 Fels, 2 Sand, 3 Schnee, 4 Erde
    const photo = terrainTextureArrays(['gras', 'fels', 'sand', 'schnee', 'erde']);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.93,
      metalness: 0,
      // ohne Fotos sorgt Rauschen als Bump-Map für etwas Struktur
      bumpMap: photo ? null : detail,
      bumpScale: 2.6,
    });
    if (photo) mat.defines = { PHOTO_TEX: '', TERRAIN_DETAIL: '' };
    const col = (hex) => new THREE.Color(hex);
    const uniforms = {
      uSplat: { value: this.splatTexture },
      uScorch: { value: this.scorchTexture },
      uDetail: { value: detail },
      uSize: { value: WORLD_SIZE },
      uForest: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, // Wald-Karte (kommt später)
      uSnow: { value: 390 },
      uWet: { value: 0 },
      // gedämpfte, natürliche Farben (wie Alpenwiesen im Spätsommer)
      cGrassA: { value: col(0x4f5c33) },
      cGrassB: { value: col(0x6e6b44) },
      cForest: { value: col(0x2f3a22) },
      cSand: { value: col(0xafa283) },
      cRock: { value: col(0x6a645b) },
      cRock2: { value: col(0x3a3632) },
      cSnow: { value: col(0xe2e6ec) },
      cDirt: { value: col(0x66523d) },
      cWheat: { value: col(0xa39058) },
      cCrop: { value: col(0x535e35) },
    };
    if (photo) {
      uniforms.uCol = { value: photo.color };
      uniforms.uNor = { value: photo.normal };
      uniforms.uAvg = { value: photo.avg };
    }
    this.uniforms = uniforms;
    mat.onBeforeCompile = (shader) => {
      addAtmosphereUniforms(shader);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_COMMON}`)
        .replace('#include <map_fragment>', `#ifdef PHOTO_TEX\n${TERRAIN_PHOTO}\n#else\n${TERRAIN_PAINTED}\n#endif`)
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
#ifdef PHOTO_TEX
roughnessFactor = gTerrR;
#endif
roughnessFactor = mix(roughnessFactor, 0.55, gSnowT * 0.5);
roughnessFactor *= 1.0 - uWet * 0.45;`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#ifdef PHOTO_TEX
normal = normalize((viewMatrix * vec4(gTerrN, 0.0)).xyz);
#else
#include <normal_fragment_maps>
#endif`
        );
    };
    return mat;
  }
}

// ---------------------------------------------------------------------------
// Terrain-Shader (GLSL). Drei Teile: gemeinsam, mit Fotos, ohne Fotos.
// ---------------------------------------------------------------------------

const TERRAIN_COMMON = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
uniform sampler2D uSplat, uScorch, uDetail, uForest;
uniform float uSize, uSnow, uWet;
uniform vec3 cGrassA, cGrassB, cForest, cSand, cRock, cRock2, cSnow, cDirt, cWheat, cCrop;
float gSnowT;
#ifdef PHOTO_TEX
uniform sampler2DArray uCol, uNor; // Foto-Schichten: Farbe+Höhe, Normale+Rauheit
uniform vec3 uAvg[5];              // mittlere Farbe jeder Schicht
vec3 gTerrN;                       // fertige Normale (Welt)
float gTerrR;                      // fertige Rauheit

// Eine Schicht an einer Stelle: Farbe, Normale (Welt), Rauheit, Höhe
struct Layer { vec3 col; vec3 n; float r; float h; };

// Die Ableitungen (dx, dy) werden ausserhalb der if-Blöcke berechnet
// → saubere Mipmaps auch dort, wo nur ein Teil der Pixel eine Schicht braucht.
void readLayer(float i, vec2 uv, vec2 dx, vec2 dy, out vec4 c, out vec3 t, out float r) {
  c = textureGrad(uCol, vec3(uv, i), dx, dy);
  vec4 n = textureGrad(uNor, vec3(uv, i), dx, dy);
  t = n.xyz * 2.0 - 1.0;
  r = n.a;
}

// Projektion von oben (für flache Böden)
Layer layerTop(float i, vec2 uv, vec2 dx, vec2 dy, vec3 wn) {
  vec4 c; vec3 t; Layer L;
  readLayer(i, uv, dx, dy, c, t, L.r);
  L.col = c.rgb;
  L.h = c.a;
  // "Whiteout": Foto-Normale auf die Hang-Richtung setzen (x → Welt-x, y → Welt-z)
  L.n = vec3(t.x + wn.x, abs(t.z) * wn.y, t.y + wn.z);
  return L;
}

// Fels: von drei Seiten projiziert (triplanar) → keine Streifen an steilen Wänden
Layer layerRock(vec3 p, vec3 dpx, vec3 dpy, vec3 wn) {
#ifdef TERRAIN_DETAIL
  vec3 w = pow(abs(wn), vec3(4.0));
  w /= w.x + w.y + w.z;
  w *= step(0.05, w); // winzige Anteile weglassen
  w /= w.x + w.y + w.z;
  Layer L = Layer(vec3(0.0), vec3(0.0), 0.0, 0.0);
  vec4 c; vec3 t; float r;
  if (w.x > 0.0) {
    readLayer(1.0, p.zy, dpx.zy, dpy.zy, c, t, r);
    L.col += c.rgb * w.x; L.h += c.a * w.x; L.r += r * w.x;
    L.n += vec3(abs(t.z) * wn.x, t.y + wn.y, t.x + wn.z) * w.x;
  }
  if (w.y > 0.0) {
    readLayer(1.0, p.xz, dpx.xz, dpy.xz, c, t, r);
    L.col += c.rgb * w.y; L.h += c.a * w.y; L.r += r * w.y;
    L.n += vec3(t.x + wn.x, abs(t.z) * wn.y, t.y + wn.z) * w.y;
  }
  if (w.z > 0.0) {
    readLayer(1.0, p.xy, dpx.xy, dpy.xy, c, t, r);
    L.col += c.rgb * w.z; L.h += c.a * w.z; L.r += r * w.z;
    L.n += vec3(t.x + wn.x, t.y + wn.y, abs(t.z) * wn.z) * w.z;
  }
  return L;
#else
  return layerTop(1.0, p.xz, dpx.xz, dpy.xz, wn);
#endif
}

// Höhen-Überblendung: Im Übergang setzt sich die "höhere" Schicht zuerst durch
// (z. B. Steine ragen aus dem Gras) → natürliche, unregelmässige Kanten.
// Bei t = 0 und t = 1 ändert sich nichts.
float hmix(float t, float hA, float hB) {
  float x = t + (hB - hA) * 4.0 * t * (1.0 - t);
  return smoothstep(0.15, 0.85, x);
}

void addLayer(inout vec3 col, inout vec3 nrm, inout float rough, inout float hgt, Layer B, vec3 tint, float t) {
  float k = hmix(t, hgt, B.h);
  col = mix(col, B.col * tint, k);
  nrm = mix(nrm, B.n, k);
  rough = mix(rough, B.r, k);
  hgt = mix(hgt, B.h, k);
}
#endif
`;

// Mit Fotos: Jede Schicht ist ein Foto. Es wird in die Farbe der Landschaft
// umgefärbt (Foto / Durchschnittsfarbe × Wunschfarbe) → Details vom Foto,
// Farbstimmung wie vorher.
const TERRAIN_PHOTO = /* glsl */ `
vec3 wp = vWPos;
vec3 wn = normalize(vWNrm);
float slope = 1.0 - wn.y;
vec2 suv = vec2(wp.x / uSize + 0.5, 0.5 - wp.z / uSize);
vec4 splat = texture2D(uSplat, suv);
float det2 = texture2D(uDetail, wp.xz * 0.0045).r;
float det3 = texture2D(uDetail, wp.xz * 0.0009).r;
float n1 = det2 * 2.0 - 1.0;
float n2 = det3 * 2.0 - 1.0;
vec3 dpx = dFdx(wp);
vec3 dpy = dFdy(wp);

// 1) Anteile der Schichten (gleiche Regeln wie ohne Fotos)
float tSand = 1.0 - smoothstep(1.5, 4.5 + n1 * 2.0, wp.y);
float tRock = smoothstep(0.17, 0.33, slope + n1 * 0.06);
tRock = max(tRock, smoothstep(200.0, 380.0, wp.y + n1 * 70.0) * 0.75);
gSnowT = smoothstep(uSnow - 40.0, uSnow + 30.0, wp.y + n1 * 60.0) * (1.0 - smoothstep(0.38, 0.6, slope));

// 2) Grundschicht Gras (Kachel 4 m), auf Feldern umgefärbt
vec3 grassTint = mix(cGrassA, cGrassB, smoothstep(-0.25, 0.55, n1 + n2 * 0.6));
grassTint = mix(grassTint, cForest, smoothstep(0.1, 0.6, -n2) * 0.7);
grassTint = mix(grassTint, cWheat, splat.g);
grassTint = mix(grassTint, cCrop, splat.b);
Layer grassL = Layer(vec3(0.0), wn, 1.0, 0.0);
if (max(tRock, gSnowT) < 0.995) {
  grassL = layerTop(0.0, wp.xz / 4.0, dpx.xz / 4.0, dpy.xz / 4.0, wn);
#ifdef TERRAIN_DETAIL
  // gegen sichtbare Wiederholung: dasselbe Foto gross und gedreht darüberlegen
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  vec3 big = textureGrad(uCol, vec3(rot * wp.xz / 23.0, 0.0), rot * dpx.xz / 23.0, rot * dpy.xz / 23.0).rgb;
  grassL.col *= mix(vec3(1.0), big / uAvg[0], 0.6);
#endif
}
vec3 col = grassL.col / uAvg[0] * grassTint;
vec3 nrm = grassL.n;
float rough = grassL.r;
float hgt = grassL.h;

// 3) Weitere Schichten nur rechnen, wo sie vorkommen (spart Zeit)
if (splat.r > 0.004) {
  Layer dirtL = layerTop(4.0, wp.xz / 4.0, dpx.xz / 4.0, dpy.xz / 4.0, wn);
  addLayer(col, nrm, rough, hgt, dirtL, cDirt / uAvg[4], splat.r);
}
if (tSand > 0.004) {
  Layer sandL = layerTop(2.0, wp.xz / 15.0, dpx.xz / 15.0, dpy.xz / 15.0, wn);
  addLayer(col, nrm, rough, hgt, sandL, cSand / uAvg[2], tSand);
}
if (tRock > 0.004) {
  Layer rockL = layerRock(wp / 9.0, dpx / 9.0, dpy / 9.0, wn);
#ifdef TERRAIN_DETAIL
  // Dasselbe Foto noch einmal 4× grösser darüberlegen: grosse Risse und Flecken
  // → das 9-m-Muster wiederholt sich nicht mehr sichtbar.
  Layer bigL = layerRock(wp / 37.0 + 0.37, dpx / 37.0, dpy / 37.0, wn);
  rockL.col *= bigL.col / uAvg[1];
  rockL.n += bigL.n - wn; // beide Normal-Details addieren
  rockL.h = (rockL.h + bigL.h) * 0.5;
#endif
  vec3 rockTint = mix(cRock2, cRock, clamp(0.6 + n1 * 0.8, 0.0, 1.0));
  addLayer(col, nrm, rough, hgt, rockL, rockTint / uAvg[1], tRock);
}
if (gSnowT > 0.004) {
  Layer snowL = layerTop(3.0, wp.xz / 6.0, dpx.xz / 6.0, dpy.xz / 6.0, wn);
  addLayer(col, nrm, rough, hgt, snowL, cSnow / uAvg[3], gSnowT);
}

// 4) Waldboden dunkler, unter Wasser dunkler, Brandflecken, Nässe
float forest = min(1.0, texture2D(uForest, suv).r) * (1.0 - gSnowT);
col *= 1.0 - forest * 0.5;
col = mix(col, col * vec3(0.8, 0.9, 0.75), forest * 0.6);
col *= mix(1.0, 0.45, smoothstep(0.0, -8.0, wp.y));
float sc = texture2D(uScorch, vec2(wp.x / uSize + 0.5, wp.z / uSize + 0.5)).r;
col = mix(col, vec3(0.025, 0.02, 0.018), sc);
col *= 1.0 - uWet * 0.3 * (1.0 - gSnowT);
diffuseColor.rgb = col * (0.9 + det2 * 0.2);
gTerrN = normalize(nrm);
gTerrR = rough;
`;

// Ohne Fotos: alles aus Farben und Rauschen (wie früher)
const TERRAIN_PAINTED = /* glsl */ `
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
float rockT = smoothstep(0.17, 0.33, slope + n1 * 0.06);
rockT = max(rockT, smoothstep(200.0, 380.0, wp.y + n1 * 70.0) * 0.75);
// dunkle Rinnen in steilen Felsen
rock *= 0.8 + 0.35 * smoothstep(0.2, 0.8, det2 + det * 0.3);
col = mix(col, rock, rockT);
gSnowT = smoothstep(uSnow - 40.0, uSnow + 30.0, wp.y + n1 * 60.0) * (1.0 - smoothstep(0.38, 0.6, slope));
col = mix(col, cSnow, gSnowT);
col *= 1.0 - min(1.0, texture2D(uForest, suv).r) * (1.0 - gSnowT) * 0.5;
col *= mix(1.0, 0.45, smoothstep(0.0, -8.0, wp.y));
float sc = texture2D(uScorch, vec2(wp.x / uSize + 0.5, wp.z / uSize + 0.5)).r;
col = mix(col, vec3(0.025, 0.02, 0.018), sc);
col *= 1.0 - uWet * 0.3 * (1.0 - gSnowT);
diffuseColor.rgb = col * (0.82 + det * 0.36);
`;
