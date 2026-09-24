// Prozedurale Texturen: Alle Bilder werden mit Code auf ein <canvas>
// gezeichnet. Sie dienen als Ersatz, falls die Foto-Texturen
// (siehe PhotoTextures.js) fehlen, und für alles, wofür es kein Foto gibt.
import * as THREE from 'three';
import { Noise2D } from '../core/noise.js';
import { mulberry32 } from '../core/utils.js';
import { hasPhoto, applyPhoto } from './PhotoTextures.js';

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Weicher, runder Punkt (für Partikel) */
export function softCircleTexture() {
  return cached('soft', () => {
    const c = canvas(64);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return toTexture(c, { srgb: false });
  });
}

/** Flammen-/Rauch-Fleck mit Rauschen (unregelmässiger Rand) */
export function puffTexture(seed = 3, size = 128) {
  return cached('puff' + seed, () => {
    const c = canvas(size);
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const n = new Noise2D(seed);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x / size) * 2 - 1;
        const dy = (y / size) * 2 - 1;
        const d = Math.sqrt(dx * dx + dy * dy);
        const nn = n.fbm(x * 0.045, y * 0.045, 4) * 0.5 + 0.5;
        let a = Math.max(0, 1 - d * (1.1 + (1 - nn) * 0.6));
        a = Math.pow(a, 1.4) * (0.6 + nn * 0.6);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false });
  });
}

/** Wolken-Atlas: 2×2 verschiedene Wolkenbäusche in einem Bild */
export function cloudAtlasTexture() {
  return cached('cloudAtlas', () => {
    const S = 256;
    const c = canvas(S * 2);
    const g = c.getContext('2d');
    const img = g.createImageData(S * 2, S * 2);
    for (let v = 0; v < 4; v++) {
      const n = new Noise2D(100 + v * 17);
      const ox = (v % 2) * S;
      const oy = Math.floor(v / 2) * S;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dx = (x / S) * 2 - 1;
          const dy = (y / S) * 2 - 1;
          // unten etwas flacher (Wolken haben flache Unterseiten)
          const d = Math.sqrt(dx * dx + (dy > 0.2 ? dy * 1.6 : dy) ** 2);
          const nn = n.fbm(x * 0.022, y * 0.022, 5) * 0.5 + 0.5;
          let a = 1 - d * (0.95 + (1 - nn) * 0.9);
          a = Math.max(0, Math.min(1, a * 1.6));
          a = a * a * (3 - 2 * a);
          // Helligkeit: oben heller → im Shader als "Beleuchtung" genutzt
          const light = Math.max(0, Math.min(1, 0.55 + nn * 0.45 - dy * 0.25));
          const i = ((oy + y) * S * 2 + ox + x) * 4;
          img.data[i] = light * 255;
          img.data[i + 1] = nn * 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = a * 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    const t = toTexture(c, { srgb: false });
    t.generateMipmaps = true;
    return t;
  });
}

/** Kachelbare Wasser-Normalmap (für die Wellen) */
export function waterNormalTexture() {
  return cached('waterNormal', () => {
    const S = 256;
    const h = new Float32Array(S * S);
    const rnd = mulberry32(77);
    // Summe von Sinuswellen mit ganzzahligen Frequenzen → nahtlos kachelbar
    const waves = [];
    for (let i = 0; i < 28; i++) {
      const fx = Math.floor(rnd() * 12) - 6;
      const fy = Math.floor(rnd() * 12) - 6;
      if (fx === 0 && fy === 0) continue;
      waves.push([fx, fy, rnd() * Math.PI * 2, 1 / Math.sqrt(fx * fx + fy * fy)]);
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = 0;
        for (const [fx, fy, ph, a] of waves) v += Math.sin(((fx * x + fy * y) / S) * Math.PI * 2 + ph) * a;
        h[y * S + x] = v;
      }
    }
    const data = new Uint8Array(S * S * 4);
    const k = 0.9;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const l = h[y * S + ((x - 1 + S) % S)];
        const r = h[y * S + ((x + 1) % S)];
        const d = h[((y - 1 + S) % S) * S + x];
        const u = h[((y + 1) % S) * S + x];
        let nx = (l - r) * k;
        let ny = (d - u) * k;
        let nz = 1;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        const i = (y * S + x) * 4;
        data[i] = (nx * 0.5 + 0.5) * 255;
        data[i + 1] = (ny * 0.5 + 0.5) * 255;
        data[i + 2] = (nz * 0.5 + 0.5) * 255;
        data[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  });
}

/** Drachenschuppen als Bump-Map (Graustufen, Höhe) */
export function scaleBumpTexture() {
  return cached('scales', () => {
    const S = 256;
    const c = canvas(S);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    const rows = 10;
    const cols = 8;
    const w = S / cols;
    const h = S / rows;
    for (let r = -1; r <= rows + 1; r++) {
      for (let col = -1; col <= cols + 1; col++) {
        const x = col * w + (r % 2 ? w / 2 : 0);
        const y = r * h;
        const grd = g.createRadialGradient(x, y + h * 0.1, 1, x, y + h * 0.4, w * 0.75);
        grd.addColorStop(0, '#fff');
        grd.addColorStop(0.7, '#999');
        grd.addColorStop(1, '#222');
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(x, y + h * 0.35, w * 0.55, h * 0.95, 0, 0, Math.PI);
        g.fill();
      }
    }
    return toTexture(c, { srgb: false, repeat: true });
  });
}

// ---------- Gebäude-Texturen ----------

/** Gemalter Ersatz, falls das Foto fehlt (putz: nur Farbe) */
const PAINTED = {
  stein: () => stoneTexture(),
  holz: () => woodTexture(),
  stroh: () => thatchTexture(),
  schiefer: () => tileRoofTexture(),
  fachwerk: () => timberWallTexture(),
  putz: () => null,
};

/**
 * Material für Gebäude: mit Foto-Textur, falls geladen – sonst mit der
 * im Code gemalten Textur.
 *   kind:   'stein' | 'holz' | 'stroh' | 'schiefer' | 'fachwerk' | 'putz'
 *   params: normale Material-Einstellungen (color, roughness, side …)
 *   photo:  Einstellungen nur für die Foto-Variante, z. B.
 *           { avgColor: 0xe0dccf } → Foto auf diese mittlere Farbe einfärben
 *           { tile: 2 }           → eine UV-Einheit der Geometrie = 2 m
 *           { normalScale: 1.5 }  → Relief der Normal-Map verstärken
 */
export function surfaceMaterial(kind, params = {}, photo = {}) {
  const mat = new THREE.MeshStandardMaterial(params);
  if (hasPhoto(kind)) {
    const { tile, avgColor, normalScale, ...rest } = photo;
    mat.setValues(rest);
    applyPhoto(mat, kind, { tile, avgColor, normalScale });
  } else {
    mat.map = PAINTED[kind]();
  }
  return mat;
}

function noiseFill(g, S, base, amount, seed, scale = 0.05) {
  const img = g.getImageData(0, 0, S, S);
  const n = new Noise2D(seed);
  const rnd = mulberry32(seed);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const v = (n.fbm(x * scale, y * scale, 3) * 0.6 + (rnd() - 0.5) * 0.4) * amount;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + v));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + v));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + v));
    }
  }
  g.putImageData(img, 0, 0);
}

/** Fachwerk: weisser Putz mit dunklen Holzbalken. Kachel = 4 m */
export function timberWallTexture() {
  return cached('timber', () => {
    const S = 256;
    const c = canvas(S);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#c9bfab';
    g.fillRect(0, 0, S, S);
    noiseFill(g, S, 0, 28, 5, 0.06);
    g.fillStyle = '#3a291d';
    const beam = 14;
    // Rahmen
    g.fillRect(0, 0, S, beam);
    g.fillRect(0, S - beam, S, beam);
    g.fillRect(0, 0, beam, S);
    g.fillRect(S / 2 - beam / 2, 0, beam, S);
    g.fillRect(0, S / 2 - beam / 2, S, beam * 0.8);
    // Diagonalstreben
    g.strokeStyle = '#3a291d';
    g.lineWidth = beam * 0.85;
    g.beginPath();
    g.moveTo(beam, S / 2);
    g.lineTo(S / 2, beam);
    g.moveTo(S - beam, S - beam);
    g.lineTo(S / 2 + beam, S / 2);
    g.stroke();
    noiseFill(g, S, 0, 12, 9, 0.2);
    return toTexture(c, { repeat: true });
  });
}

/** Strohdach */
export function thatchTexture() {
  return cached('thatch', () => {
    const S = 256;
    const c = canvas(S);
    const g = c.getContext('2d');
    g.fillStyle = '#6e5d3e';
    g.fillRect(0, 0, S, S);
    const rnd = mulberry32(11);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const l = 10 + rnd() * 22;
      const b = 70 + rnd() * 70;
      g.strokeStyle = `rgba(${b + 40},${b + 15},${b * 0.45},${0.5 + rnd() * 0.5})`;
      g.lineWidth = 1 + rnd() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 3, y + l);
      g.stroke();
    }
    // Reihen
    g.fillStyle = 'rgba(40,25,10,0.25)';
    for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 3);
    return toTexture(c, { repeat: true });
  });
}

/** Ziegeldach (rot) */
export function tileRoofTexture() {
  return cached('tiles', () => {
    const S = 256;
    const c = canvas(S);
    const g = c.getContext('2d');
    g.fillStyle = '#4e2a20';
    g.fillRect(0, 0, S, S);
    const rows = 12;
    const cols = 10;
    const rnd = mulberry32(21);
    for (let r = 0; r < rows; r++) {
      for (let col = -1; col <= cols; col++) {
        const w = S / cols;
        const h = S / rows;
        const x = col * w + (r % 2 ? w / 2 : 0);
        const y = r * h;
        const shade = 90 + rnd() * 50;
        g.fillStyle = `rgb(${shade * 0.9 + 10},${shade * 0.5},${shade * 0.38})`;
        g.beginPath();
        g.ellipse(x + w / 2, y + h * 0.55, w * 0.46, h * 0.6, 0, 0, Math.PI);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(x, y, w, 2);
      }
    }
    return toTexture(c, { repeat: true });
  });
}

/** Steinmauer (Burg). Kachel = 4 m */
export function stoneTexture() {
  return cached('stone', () => {
    const S = 256;
    const c = canvas(S);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#6d6a63';
    g.fillRect(0, 0, S, S);
    const rnd = mulberry32(31);
    const rows = 8;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -h * 0.8 : 0;
      while (x < S) {
        const w = h * (1.2 + rnd() * 1.4);
        const v = 95 + rnd() * 45;
        g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.9})`;
        g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        x += w;
      }
    }
    noiseFill(g, S, 0, 22, 33, 0.08);
    return toTexture(c, { repeat: true });
  });
}

/** Holzbretter */
export function woodTexture() {
  return cached('wood', () => {
    const S = 128;
    const c = canvas(S);
    const g = c.getContext('2d', { willReadFrequently: true });
    const rnd = mulberry32(41);
    const planks = 6;
    for (let i = 0; i < planks; i++) {
      const v = 80 + rnd() * 40;
      g.fillStyle = `rgb(${v + 30},${v * 0.75},${v * 0.45})`;
      g.fillRect(0, (i * S) / planks, S, S / planks - 2);
    }
    noiseFill(g, S, 0, 20, 43, 0.15);
    return toTexture(c, { repeat: true });
  });
}

/** Detail-Rauschen für den Boden (Graustufen) */
export function detailNoiseTexture() {
  return cached('detail', () => {
    const S = 256;
    const c = canvas(S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const n = new Noise2D(55);
    const rnd = mulberry32(56);
    // kachelbar durch Überblenden an den Rändern (einfacher Trick: 4D-Torus wäre besser)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const fx = x / S;
        const fy = y / S;
        const a = n.fbm(fx * 8, fy * 8, 4);
        const b = n.fbm((fx - 1) * 8, fy * 8, 4);
        const cc = n.fbm(fx * 8, (fy - 1) * 8, 4);
        const d = n.fbm((fx - 1) * 8, (fy - 1) * 8, 4);
        const v = (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy;
        const val = 128 + v * 110 + (rnd() - 0.5) * 30;
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, val));
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false, repeat: true });
  });
}

// ---------- Realistischere Drachenhaut ----------

/** Kachelbares Werte-Rauschen (wiederholt sich alle "period" Einheiten) */
function periodicNoise(seed) {
  const rnd = mulberry32(seed);
  const table = new Float32Array(256 * 256);
  for (let i = 0; i < table.length; i++) table[i] = rnd();
  return (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = (a, b) => table[(((b % period) + period) % period) * 256 + (((a % period) + period) % period)];
    const a = w(xi, yi);
    const b = w(xi + 1, yi);
    const c = w(xi, yi + 1);
    const d = w(xi + 1, yi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
}

function heightToNormal(h, S, strength) {
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = h[y * S + ((x - 1 + S) % S)];
      const r = h[y * S + ((x + 1) % S)];
      const d = h[((y - 1 + S) % S) * S + x];
      const u = h[((y + 1) % S) * S + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * S + x) * 4;
      data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Normal-Map für Drachenhaut: kleine, überlappende Schuppen + Falten.
 * (Normal-Map = jedes Pixel speichert eine "Flächenrichtung" → Licht wirkt rau)
 */
export function dragonSkinNormalTexture() {
  return cached('dragonSkinN', () => {
    const S = 512;
    const h = new Float32Array(S * S);
    const n = periodicNoise(91);
    const rows = 32;
    const cols = 24;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // Schuppen: versetzte Reihen, jede Schuppe wölbt sich nach oben
        const gy = (y / S) * rows;
        const row = Math.floor(gy);
        const gx = (x / S) * cols + (row % 2 ? 0.5 : 0);
        const fx = gx - Math.floor(gx) - 0.5;
        const fy = gy - row;
        const jitter = n(Math.floor(gx) * 3.1, row * 2.3, 256) * 0.3;
        const scale = Math.max(0, 1 - Math.hypot(fx * 1.6, (fy - 0.35) * 1.2)) * (0.7 + jitter);
        // Falten: grobes Rauschen
        const w1 = n((x / S) * 8, (y / S) * 8, 8);
        const w2 = n((x / S) * 32, (y / S) * 32, 32);
        h[y * S + x] = scale * 0.8 + w1 * 1.2 + w2 * 0.35;
      }
    }
    return heightToNormal(h, S, 2.2);
  });
}

/** Flughaut: helle Grundfarbe mit dunklen Adern und Flecken (wird mit der Hautfarbe multipliziert) */
export function membraneTexture() {
  return cached('membrane', () => {
    const S = 512;
    const c = canvas(S);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#d8d0c8';
    g.fillRect(0, 0, S, S);
    noiseFill(g, S, 0, 38, 17, 0.02);
    const rnd = mulberry32(23);
    // verästelte Adern
    const vein = (x, y, ang, width, depth) => {
      g.strokeStyle = `rgba(60,35,30,${0.25 + width * 0.12})`;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x, y);
      const len = 30 + rnd() * 50;
      for (let i = 0; i < 6; i++) {
        ang += (rnd() - 0.5) * 0.6;
        x += Math.cos(ang) * len / 6;
        y += Math.sin(ang) * len / 6;
        g.lineTo(x, y);
      }
      g.stroke();
      if (depth > 0) {
        vein(x, y, ang + 0.5, width * 0.65, depth - 1);
        vein(x, y, ang - 0.5, width * 0.65, depth - 1);
      }
    };
    for (let i = 0; i < 14; i++) vein(rnd() * S, rnd() * S, rnd() * 6.28, 3, 3);
    const t = toTexture(c, { repeat: true });
    return t;
  });
}
