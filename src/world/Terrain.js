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
  // Vulkan "Drachenhort" im Nordosten: Kegel (Radius R), Kraterrand (rimR, Höhe rimH),
  // flacher Kraterboden (floorH) mit Lava-See (lavaR). Die Ostflanke fällt ins Meer.
  volcano: { x: 1600, z: -1150, R: 850, rimR: 130, rimH: 640, floorH: 540, lavaR: 34 },
  // Lavaströme: Richtung (Winkel, 0 = Osten, + = Süden) und Länge ab dem Kraterrand
  lavaFlows: [
    [0.35, 520], [1.3, 420], [2.35, 330],
  ],
  // Schlachtfeld: weite, sanfte Ebene südöstlich vom Dorf (Ellipse rx × rz, Höhe h).
  // Das feindliche Heer kommt von Osten (+x), die eigenen Truppen stehen im Westen.
  battle: { x: 450, z: 950, rx: 430, rz: 250, h: 20 },
  // Drachenschlucht im Westen: Mittellinie von der Mündung im Meer (Süden) bis zur
  // Felswand mit dem Wasserfall (Norden). Rundherum ein Hochplateau.
  canyon: [
    [-1480, 1560], [-1520, 1160], [-1660, 840], [-1560, 480], [-1720, 130], [-1600, -220], [-1720, -560],
  ],
};

// Länge der Schlucht (bis zur Felswand am oberen Ende)
let _canyonLen = 0;
for (let i = 1; i < PLACES.canyon.length; i++) {
  const [ax, az] = PLACES.canyon[i - 1];
  const [bx, bz] = PLACES.canyon[i];
  _canyonLen += Math.hypot(bx - ax, bz - az);
}
export const CANYON_LEN = _canyonLen;

/**
 * Abstand zur Linie (out.d) und Lage des nächsten Punktes entlang der Linie
 * (out.s, Meter ab dem ersten Punkt).
 */
export function polylineInfo(x, z, pts, out) {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const dx = pts[i + 1][0] - ax;
    const dz = pts[i + 1][1] - az;
    const len2 = dx * dx + dz * dz;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    const len = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestS = acc + t * len;
    }
    acc += len;
  }
  out.d = best;
  out.s = bestS;
  return out;
}

/** Lavastrom-Anteil (0..1) an einer Stelle des Vulkans (d = Abstand zur Mitte, ang = Winkel) */
export function lavaFlowAt(d, ang) {
  const V = PLACES.volcano;
  let m = 0;
  PLACES.lavaFlows.forEach(([a0, len], i) => {
    if (d < V.rimR - 5 || d > V.rimR + len) return;
    const a = a0 + 0.2 * Math.sin(d * 0.011 + i * 2.1) + 0.08 * Math.sin(d * 0.037 + i);
    let da = ang - a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const w = 7 + (d - V.rimR) * 0.02; // halbe Breite (m), wird unten breiter
    const across = Math.abs(da) * d;
    const along = smoothstep(V.rimR - 5, V.rimR + 15, d) * smoothstep(V.rimR + len, V.rimR + len * 0.7, d);
    m = Math.max(m, smoothstep(w, w * 0.35, across) * along);
  });
  return m;
}

const _pi = { d: 0, s: 0 };

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
    // Erodierte Grate gemischt mit weichem Rauschen → massive Berge mit scharfen
    // Hauptgraten und glatten Flanken (5 Schichten: feiner wäre kleiner als das Raster)
    const ridge = n.erodedRidged(wx * 0.00082 + 5, wz * 0.00082 + 9, 5, 2.0, 0.55, 0.12);
    const soft = n.fbm(wx * 0.0006 + 40, wz * 0.0006, 4) * 0.5 + 0.5;
    h += mMask * (ridge * 400 + soft * 150 + 30);
    const P = PLACES;
    const dp = Math.hypot(x - P.peak.x, z - P.peak.z);
    h += 470 * Math.exp(-(dp * dp) / (470 * 470)) * (0.75 + 0.5 * ridge);
    const dp2 = Math.hypot(x - P.peak2.x, z - P.peak2.z);
    h += 280 * Math.exp(-(dp2 * dp2) / (380 * 380)) * (0.7 + 0.5 * ridge);

    // 2b) Vulkan "Drachenhort": Kegel mit Rinnen, Kraterrand, flacher Kraterboden
    const VO = P.volcano;
    const dvx = x - VO.x;
    const dvz = z - VO.z;
    const dvo = Math.hypot(dvx, dvz);
    if (dvo < VO.R) {
      const hv = this.volcanoHeight(dvo, dvx, dvz);
      h = lerp(h, Math.max(h, hv), smoothstep(VO.R, VO.R * 0.75, dvo));
      h = lerp(h, hv, smoothstep(VO.rimR + 70, VO.rimR + 15, dvo)); // Krater genau so, wie geplant
    }

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

    // 5a) Schlachtfeld-Ebene
    const BF = P.battle;
    const eb = Math.hypot((x - BF.x) / BF.rx, (z - BF.z) / BF.rz) + n.noise(x * 0.003, z * 0.003) * 0.08;
    h = lerp(h, BF.h + n.fbm(x * 0.004 + 9, z * 0.004, 2) * 2.5, smoothstep(1.3, 0.9, eb));

    // 5b) Hochplateau mit der Drachenschlucht im Westen
    polylineInfo(x, z, P.canyon, _pi);
    const plat = 128 + n.fbm(x * 0.002 + 7, z * 0.002, 3) * 14;
    const edge = _pi.d + n.noise(x * 0.004, z * 0.004) * 45 + n.fbm(x * 0.0017 + 3, z * 0.0017, 2) * 110;
    h = lerp(h, Math.max(h, plat), smoothstep(430, 350, edge));
    // Schlucht: steile, leicht gestufte Felswände, sandiger Grund, Fluss in der Mitte.
    // Am oberen Ende (Norden) eine Felswand, dort stürzt der Wasserfall herunter.
    const dcan = _pi.d + n.noise(x * 0.012, z * 0.012) * 9;
    const head = smoothstep(CANYON_LEN, CANYON_LEN - 14, _pi.s); // steile Felswand (Wasserfall fällt frei)
    let tc = smoothstep(80, 27, dcan);
    tc = clamp(tc + Math.sin(tc * Math.PI * 6) * 0.035, 0, 1) * head;
    const bed = lerp(1.8, -3.5, smoothstep(20, 9, dcan));
    h = lerp(h, Math.min(h, bed), tc);
    // Bach-Rinne von der Quelle (70 m hinter der Kante) bis zum Wasserfall
    const CE = P.canyon[P.canyon.length - 1];
    const CP = P.canyon[P.canyon.length - 2];
    const cl = Math.hypot(CE[0] - CP[0], CE[1] - CP[1]);
    const cdx = (CE[0] - CP[0]) / cl;
    const cdz = (CE[1] - CP[1]) / cl;
    const along = (x - CE[0]) * cdx + (z - CE[1]) * cdz;
    const across = Math.abs((x - CE[0]) * -cdz + (z - CE[1]) * cdx);
    if (along > -5 && along < 85 && across < 20) {
      const k = smoothstep(18, 6, across + n.noise(x * 0.04, z * 0.04) * 2) * smoothstep(85, 70, along);
      h = lerp(h, Math.min(h, 187.5 + along * 0.05), k);
    }

    // 6) Küste im Süden + Inselrand
    const coastLine = 1450 + n.fbm(x * 0.0009 + 3, 0.5, 4) * 380;
    const coastT = smoothstep(coastLine - 260, coastLine + 160, z);
    const r = Math.pow(Math.pow(Math.abs(wx) / HALF, 4) + Math.pow(Math.abs(wz) / HALF, 4), 0.25);
    const edgeT = smoothstep(0.8, 0.985, r);
    const seaT = Math.max(coastT, edgeT);
    h = lerp(h, -42 + n.fbm(x * 0.003, z * 0.003, 2) * 10, seaT);
    return h;
  }

  /** Höhe des Vulkans bei Abstand d zur Mitte (dx, dz = Richtung von der Mitte). */
  volcanoHeight(d, dx, dz) {
    const V = PLACES.volcano;
    const n = this.noise;
    const ca = dx / (d + 1e-6);
    const sa = dz / (d + 1e-6);
    // Kegel: oben steil, unten flach auslaufend
    const k = clamp((V.R - d) / (V.R - V.rimR), 0, 1);
    let h = 15 + (V.rimH - 15) * Math.pow(k, 1.75);
    // Rinnen (Erosion) den Hang hinunter
    const gully = Math.max(0, n.noise(ca * 5 + d * 0.0015 + 31, sa * 5 - d * 0.001));
    h -= gully * 34 * k * (1 - k) * 4;
    // Lavaströme fliessen in flachen Rinnen
    h -= lavaFlowAt(d, Math.atan2(dz, dx)) * 2.5;
    // Kraterrand mit Wulst, innen steile Wände und ein flacher Boden
    const lip = 12 * Math.exp(-(((d - V.rimR) / 24) ** 2));
    if (d < V.rimR + 70) {
      const bowl = V.floorH + (V.rimH + 12 - V.floorH) * smoothstep(V.rimR * 0.64, V.rimR, d);
      h = lerp(h + lip, bowl, smoothstep(V.rimR + 8, V.rimR - 8, d));
    } else h += lip;
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
    this._createRegionTexture();
    onProgress(1);
  }

  /**
   * Regionen-Karte für den Boden-Shader (1024², ca. 5 m pro Pixel):
   * R = Vulkan-Asche, G = Schlucht (Gesteinsschichten), B = Lava (leuchtet).
   */
  _createRegionTexture() {
    const S = 1024;
    const data = new Uint8Array(S * S * 4);
    const V = PLACES.volcano;
    const px = WORLD_SIZE / S;
    const info = { d: 0, s: 0 };
    for (let j = 0; j < S; j++) {
      const z = -HALF + (j + 0.5) * px;
      for (let i = 0; i < S; i++) {
        const x = -HALF + (i + 0.5) * px;
        const k = (j * S + i) * 4;
        const dx = x - V.x;
        const dz = z - V.z;
        const d = Math.hypot(dx, dz);
        if (d < V.R) {
          data[k] = 255 * smoothstep(V.R * 0.95, V.R * 0.62, d + this.noise.noise(x * 0.01, z * 0.01) * 60);
          let lava = lavaFlowAt(d, Math.atan2(dz, dx));
          if (d < V.lavaR + 6) lava = Math.max(lava, smoothstep(V.lavaR + 6, V.lavaR - 4, d)); // Lava-See
          data[k + 2] = 255 * lava;
        }
        if (x < -900 && x > -2400 && z > -1100 && z < 2100) {
          polylineInfo(x, z, PLACES.canyon, info);
          data[k + 1] = 255 * smoothstep(470, 380, info.d);
        }
        data[k + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.regionData = data;
    this.regionSize = S;
    this.regionTexture = t;
  }

  /** Regionen an einer Stelle: [Asche, Schlucht, Lava] je 0..1 */
  regionAt(x, z) {
    if (!this.regionData) return [0, 0, 0];
    const S = this.regionSize;
    const i = clamp(Math.floor(((x + HALF) / WORLD_SIZE) * S), 0, S - 1);
    const j = clamp(Math.floor(((z + HALF) / WORLD_SIZE) * S), 0, S - 1);
    const k = (j * S + i) * 4;
    return [this.regionData[k] / 255, this.regionData[k + 1] / 255, this.regionData[k + 2] / 255];
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

  /** lavaGain: Lava heller machen (am Tag, damit man sie auch in der Sonne gut sieht) */
  update(dt, wetness, lavaGain = 1) {
    this.scorchTimer -= dt;
    if (this.scorchDirty && this.scorchTimer <= 0) {
      this.scorchTexture.needsUpdate = true;
      this.scorchDirty = false;
      this.scorchTimer = 0.2;
    }
    if (this.uniforms) {
      this.uniforms.uWet.value = wetness;
      this.uniforms.uTime.value += dt;
      this.uniforms.uLavaGain.value = lavaGain;
    }
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
      uTime: { value: 0 },
      uLavaGain: { value: 1 },
      uRegion: { value: this.regionTexture },
      // gedämpfte, natürliche Farben (wie Alpenwiesen im Spätsommer)
      cGrassA: { value: col(0x4f5c33) },
      cGrassB: { value: col(0x6e6b44) },
      cForest: { value: col(0x2f3a22) },
      cSand: { value: col(0xafa283) },
      cRock: { value: col(0x6a645b) },
      cRock2: { value: col(0x3a3632) },
      cSnow: { value: col(0xcfd5de) }, // nicht ganz weiss: sonst überstrahlt der Schnee in der Sonne
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
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += lavaColor(gLava) * uLavaGain;`
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
uniform sampler2D uSplat, uScorch, uDetail, uForest, uRegion;
uniform float uSize, uSnow, uWet, uTime, uLavaGain;
uniform vec3 cGrassA, cGrassB, cForest, cSand, cRock, cRock2, cSnow, cDirt, cWheat, cCrop;
float gSnowT;
float gLava;

// Regionen: Asche am Vulkan (r), Schlucht (g), Lava (b)
vec4 terrRegion(vec3 wp) {
  return texture2D(uRegion, vec2(wp.x / uSize + 0.5, wp.z / uSize + 0.5));
}
// Gesteinsschichten der Schlucht (rot-beige Bänder, leicht schräg und gewellt)
vec3 strataColor(vec3 wp, float n1) {
  float b = wp.y * 0.21 + wp.x * 0.004 + n1 * 1.4;
  float s1 = 0.5 + 0.5 * sin(b);
  float s2 = 0.5 + 0.5 * sin(b * 2.7 + 1.3);
  vec3 red = vec3(0.52, 0.29, 0.19);
  vec3 sand = vec3(0.64, 0.49, 0.36);
  vec3 dark = vec3(0.36, 0.24, 0.18);
  return mix(mix(red, sand, smoothstep(0.35, 0.8, s1)), dark, smoothstep(0.75, 1.0, s2) * 0.6);
}
// Lava: fliessende, pulsierende Glut mit dunkler Kruste.
// Ergebnis = Temperatur: 0 = kalte, dunkle Kruste … 1 = heisser Riss
float lavaGlow(vec3 wp, float m) {
  if (m < 0.01) return 0.0;
  float a = texture2D(uDetail, wp.xz * 0.018 + vec2(uTime * 0.011, uTime * 0.017)).r;
  float b = texture2D(uDetail, wp.xz * 0.05 - vec2(uTime * 0.02, uTime * 0.006)).r;
  float hot = smoothstep(0.38, 0.8, a * 0.6 + b * 0.6);
  return m * (0.15 + 0.85 * hot) * (0.9 + 0.1 * sin(uTime * 2.3 + wp.x * 0.05));
}
// Glühfarbe nach Temperatur (wie heisses Eisen): dunkelrot → orange → gelb.
// Nicht zu hell, sonst macht das Tone Mapping die Lava weiss.
vec3 lavaColor(float t) {
  vec3 c = mix(vec3(0.5, 0.03, 0.004), vec3(1.0, 0.16, 0.012), smoothstep(0.15, 0.6, t));
  c = mix(c, vec3(1.0, 0.42, 0.08), smoothstep(0.7, 1.0, t));
  return c * t * t * 1.3;
}
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
vec4 region = terrRegion(wp);
gSnowT *= 1.0 - region.r;
tRock = max(tRock, region.r * smoothstep(0.08, 0.2, slope + n1 * 0.05)); // Vulkan: Fels schon an flachen Hängen

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
  rockTint = mix(rockTint, strataColor(wp, n1) * 1.1, region.g);
  rockTint = mix(rockTint, vec3(0.07, 0.065, 0.065), region.r);           // dunkler Basalt
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
col = mix(col, col * vec3(1.12, 0.95, 0.72), region.g * (1.0 - tRock) * 0.6); // trockenes Plateau
float lum = dot(col, vec3(0.3, 0.59, 0.11));
col = mix(col, vec3(lum) * vec3(0.16, 0.15, 0.145), region.r * 0.95);        // Asche und Basalt
gLava = lavaGlow(wp, region.b);
col *= 1.0 - region.b * 0.85;
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
vec4 region = terrRegion(wp);
rock = mix(rock, strataColor(wp, n1), region.g);
rock = mix(rock, vec3(0.07, 0.065, 0.065) * (0.8 + 0.4 * det), region.r);
rockT = max(rockT, region.r * smoothstep(0.08, 0.2, slope));
col = mix(col, rock, rockT * max(region.r, region.g));
float lum = dot(col, vec3(0.3, 0.59, 0.11));
col = mix(col, vec3(lum) * vec3(0.16, 0.15, 0.145), region.r * 0.95);
gLava = lavaGlow(wp, region.b);
col *= 1.0 - region.b * 0.85;
gSnowT = smoothstep(uSnow - 40.0, uSnow + 30.0, wp.y + n1 * 60.0) * (1.0 - smoothstep(0.38, 0.6, slope)) * (1.0 - region.r);
col = mix(col, cSnow, gSnowT);
col *= 1.0 - min(1.0, texture2D(uForest, suv).r) * (1.0 - gSnowT) * 0.5;
col *= mix(1.0, 0.45, smoothstep(0.0, -8.0, wp.y));
float sc = texture2D(uScorch, vec2(wp.x / uSize + 0.5, wp.z / uSize + 0.5)).r;
col = mix(col, vec3(0.025, 0.02, 0.018), sc);
col *= 1.0 - uWet * 0.3 * (1.0 - gSnowT);
diffuseColor.rgb = col * (0.82 + det * 0.36);
`;
