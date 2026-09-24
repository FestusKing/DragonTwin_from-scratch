// Foto-Texturen von Poly Haven (Lizenz CC0, siehe public/textures/QUELLEN.md).
//
// Pro Textur gibt es drei kleine JPG-Dateien:
//   <name>_diff.jpg  Farbe
//   <name>_nor.jpg   Normal-Map (OpenGL-Format: grün = oben)
//   <name>_arh.jpg   R = Umgebungsverdeckung (AO), G = Rauheit, B = Höhe
//
// Die Bilder werden beim Start geladen. Fehlt etwas (z. B. Ordner gelöscht),
// nimmt das Spiel automatisch wieder die im Code gemalten Texturen.
import * as THREE from 'three';
import { addAtmosphereUniforms } from './Atmosphere.js';

const BASE = `${import.meta.env.BASE_URL}textures/`;
const photos = new Map(); // Schlüssel → { info, diff, nor, arh } (Bilder)
const cache = new Map();

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild fehlt: ${url}`));
    img.src = url;
  });
}

/**
 * Alle Foto-Texturen laden. Gibt true zurück, wenn mindestens eine geladen wurde.
 * onProgress(0..1) meldet den Fortschritt.
 */
export async function loadPhotoTextures(onProgress = () => {}) {
  // Zum Vergleichen: Adresse mit "?fotos=0" öffnen → nur gemalte Texturen
  if (new URLSearchParams(location.search).get('fotos') === '0') return false;
  let manifest;
  try {
    const res = await fetch(`${BASE}textures.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (e) {
    console.warn('Keine Foto-Texturen gefunden → Code-Texturen werden benutzt.', e);
    return false;
  }
  const keys = Object.keys(manifest.textures);
  let done = 0;
  await Promise.all(
    keys.map(async (key) => {
      try {
        const [diff, nor, arh] = await Promise.all(
          ['diff', 'nor', 'arh'].map((m) =>
            loadImage(`${BASE}${key}_${m}.jpg`).finally(() => onProgress(++done / (keys.length * 3)))
          )
        );
        photos.set(key, { info: manifest.textures[key], diff, nor, arh });
      } catch (e) {
        console.warn(`Foto-Textur "${key}" konnte nicht geladen werden.`, e);
      }
    })
  );
  return photos.size > 0;
}

/** Gibt es diese Foto-Textur? ("fachwerk" wird aus Putz + Holz zusammengesetzt) */
export function hasPhoto(key) {
  if (key === 'fachwerk') return photos.has('putz') && photos.has('holz');
  return photos.has(key);
}

// ---------------------------------------------------------------------------
// Normale Texturen (für Gebäude, Felsen …)
// ---------------------------------------------------------------------------

function imageTexture(img, srgb) {
  const t = new THREE.Texture(img);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Die drei Grund-Texturen einer Foto-Textur (einmal pro Schlüssel). */
function baseSet(key) {
  const id = `base:${key}`;
  if (!cache.has(id)) {
    const p = photos.get(key);
    cache.set(id, {
      info: p.info,
      map: imageTexture(p.diff, true),
      normalMap: imageTexture(p.nor, false),
      arhMap: imageTexture(p.arh, false),
    });
  }
  return cache.get(id);
}

/**
 * Foto-Texturen für ein Material mit "Meter-UVs".
 * tile = so viele Meter entspricht eine UV-Einheit der Geometrie
 * (bei BuildingGeo.box() sind das 4 m). Die Textur wird dann in ihrer
 * echten Grösse wiederholt – ein Stein ist also überall gleich gross.
 */
export function photoSet(key, tile = 4) {
  if (!photos.has(key)) return null;
  const id = `${key}@${tile}`;
  if (!cache.has(id)) {
    const b = baseSet(key);
    const [w, h] = b.info.size_m;
    const set = {};
    for (const name of ['map', 'normalMap', 'arhMap']) {
      // clone() teilt sich das Bild → wird nur einmal zur Grafikkarte geschickt
      const t = b[name].clone();
      t.repeat.set(tile / w, tile / h);
      set[name] = t;
    }
    cache.set(id, set);
  }
  return cache.get(id);
}

/**
 * Foto-Texturen auf ein MeshStandardMaterial setzen.
 * Die Rauheit im Material wird mit der Rauheit aus dem Bild multipliziert.
 * avgColor (optional, z. B. 0xe0dccf): Das Foto wird so eingefärbt, dass seine
 * mittlere Farbe genau diese Farbe ist (praktisch für weissen Putz oder roten Anstrich).
 */
export function applyPhoto(mat, key, { tile = 4, normalScale = 1, aoIntensity = 0.8, avgColor } = {}) {
  const set = key === 'fachwerk' ? timberFramePhotoSet() : photoSet(key, tile);
  if (!set) return false;
  if (avgColor !== undefined) {
    const avg = averageColor(key === 'fachwerk' ? 'putz' : key);
    mat.color.set(avgColor);
    mat.color.setRGB(mat.color.r / avg.x, mat.color.g / avg.y, mat.color.b / avg.z);
  }
  mat.map = set.map;
  mat.normalMap = set.normalMap;
  mat.normalScale.set(normalScale, normalScale);
  mat.roughnessMap = set.arhMap; // liest den grünen Kanal
  mat.aoMap = set.arhMap; // liest den roten Kanal
  mat.aoMapIntensity = aoIntensity;
  mat.needsUpdate = true;
  return true;
}

// ---------------------------------------------------------------------------
// Pixel-Helfer
// ---------------------------------------------------------------------------

/** Bild → Pixel (RGBA) in der Grösse size × size */
function pixels(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

/** Bild als Kachelmuster in eine Fläche zeichnen (scale = Pixel pro Bild-Pixel) */
function tiledPixels(img, size, scale) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  const pat = g.createPattern(img, 'repeat');
  pat.setTransform(new DOMMatrix().scale(scale));
  g.fillStyle = pat;
  g.fillRect(0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

// sRGB (0..255) → linear (0..1), als Tabelle für Tempo
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// ---------------------------------------------------------------------------
// Terrain: alle Boden-Texturen in einem "Textur-Array"
// ---------------------------------------------------------------------------

/**
 * Packt mehrere Foto-Texturen in zwei Textur-Arrays (ein Bild pro Schicht):
 *   color:  RGB = Farbe (mit AO abgedunkelt), A = Höhe
 *   normal: RGB = Normal-Map,                 A = Rauheit
 * Vorteil: Der Shader braucht nur 2 statt 10 Textur-Plätze.
 * avg: mittlere Farbe jeder Schicht (linear) → damit färbt der Shader die
 * Fotos in die Farben der Landschaft um, ohne ihre Details zu verlieren.
 */
export function terrainTextureArrays(keys) {
  if (!keys.every((k) => photos.has(k))) return null;
  const id = `terrain:${keys.join(',')}`;
  if (cache.has(id)) return cache.get(id);

  const S = Math.max(...keys.map((k) => photos.get(k).info.px));
  const layer = S * S * 4;
  const col = new Uint8Array(layer * keys.length);
  const nor = new Uint8Array(layer * keys.length);
  const avg = [];
  keys.forEach((key, L) => {
    const p = photos.get(key);
    const d = pixels(p.diff, S);
    const n = pixels(p.nor, S);
    const m = pixels(p.arh, S);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < S; y++) {
      // Zeilen umdrehen: Bild oben = v = 1 (wie bei normalen Three.js-Texturen)
      const src = y * S * 4;
      const dst = L * layer + (S - 1 - y) * S * 4;
      for (let x = 0; x < S * 4; x += 4) {
        const ao = 0.45 + 0.55 * (m[src + x] / 255); // AO nur zur Hälfte, sonst zu dunkel
        const o = dst + x;
        col[o] = d[src + x] * ao;
        col[o + 1] = d[src + x + 1] * ao;
        col[o + 2] = d[src + x + 2] * ao;
        col[o + 3] = m[src + x + 2]; // Höhe
        nor[o] = n[src + x];
        nor[o + 1] = n[src + x + 1];
        nor[o + 2] = n[src + x + 2];
        nor[o + 3] = m[src + x + 1]; // Rauheit
        r += SRGB_TO_LINEAR[col[o]];
        g += SRGB_TO_LINEAR[col[o + 1]];
        b += SRGB_TO_LINEAR[col[o + 2]];
      }
    }
    avg.push(new THREE.Vector3(r, g, b).divideScalar(S * S));
  });

  const make = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, S, S, keys.length);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const res = { color: make(col, true), normal: make(nor, false), avg };
  cache.set(id, res);
  return res;
}

// ---------------------------------------------------------------------------
// Fachwerk: Putz-Foto + Holz-Foto zu einer Wand zusammensetzen
// ---------------------------------------------------------------------------

/**
 * Baut die Fachwerk-Textur (eine Kachel = 4 × 4 m) aus zwei Fotos:
 * Lehmputz als Füllung, verwitterte Bretter als Balken.
 * Die Balken-Lage ist dieselbe wie bei der gemalten Textur in Textures.js.
 * Gibt { map, normalMap, arhMap } zurück (oder null, wenn Fotos fehlen).
 */
export function timberFramePhotoSet() {
  if (!photos.has('putz') || !photos.has('holz')) return null;
  if (cache.has('fachwerk')) return cache.get('fachwerk');
  const S = 1024; // Pixel pro 4 m → 256 Pixel pro Meter
  const PX_PER_M = S / 4;
  const PLASTER_GAIN = 1.45;
  const putz = photos.get('putz');
  const holz = photos.get('holz');

  // Putz: als Muster in echter Grösse wiederholen
  const pScale = PX_PER_M * putz.info.size_m[0] / putz.info.px;
  const pD = tiledPixels(putz.diff, S, pScale);
  const pN = tiledPixels(putz.nor, S, pScale);
  const pM = tiledPixels(putz.arh, S, pScale);
  // Holz: Pixel zum freien (gedrehten) Auslesen
  const WS = holz.info.px;
  const wD = pixels(holz.diff, WS);
  const wN = pixels(holz.nor, WS);
  const wM = pixels(holz.arh, WS);
  const wScale = WS / (holz.info.size_m[0] * PX_PER_M); // Holz-Pixel pro Wand-Pixel

  // Die Bretter im Foto haben dunkle Fugen. Ein Balken soll mitten auf einem
  // Brett liegen → hellste Spalte suchen (= Mitte eines breiten Bretts).
  const colLum = new Float32Array(WS);
  for (let y = 0; y < WS; y++) for (let x = 0; x < WS; x++) colLum[x] += wD[(y * WS + x) * 4 + 1];
  let plankX = 0;
  let best = -1;
  const win = Math.round(WS * 0.03);
  for (let x = 0; x < WS; x++) {
    let s = 0;
    for (let k = -win; k <= win; k++) s += colLum[(x + k + WS) % WS];
    if (s > best) {
      best = s;
      plankX = x;
    }
  }

  // Balken als Strecken (in Pixeln, y nach oben, wie die Textur später im Spiel).
  // Alle Balken liegen ganz in der Kachel → beim Wiederholen passt alles zusammen.
  const beam = 14 * (S / 256); // Breite wie bei der gemalten Textur
  const segs = [
    [0, beam / 2, S, beam / 2], // Schwelle unten
    [0, S - beam / 2, S, S - beam / 2], // Rähm oben
    [0, S / 2, S, S / 2], // Riegel in der Mitte
    [beam / 2, 0, beam / 2, S], // Pfosten links
    [S / 2, 0, S / 2, S], // Pfosten Mitte
    [beam, S / 2, S / 2, S - beam], // Strebe oben links
    [S - beam, beam, S / 2 + beam, S / 2], // Strebe unten rechts
  ].map(([ax, ay, bx, by], i) => {
    const len = Math.hypot(bx - ax, by - ay);
    return { ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, seed: i * 173.3 };
  });
  const half = beam / 2;

  // bilinear aus dem Holz-Bild lesen (mit Wiederholung)
  const sampleWood = (arr, u, v, out) => {
    u = ((u % WS) + WS) % WS;
    v = ((v % WS) + WS) % WS;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const x1 = (x0 + 1) % WS;
    const y1 = (y0 + 1) % WS;
    for (let c = 0; c < 3; c++) {
      const a = arr[(y0 * WS + x0) * 4 + c];
      const b = arr[(y0 * WS + x1) * 4 + c];
      const d = arr[(y1 * WS + x0) * 4 + c];
      const e = arr[(y1 * WS + x1) * 4 + c];
      out[c] = (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
    }
    return out;
  };

  const outD = new ImageData(S, S);
  const outN = new ImageData(S, S);
  const outM = new ImageData(S, S);
  const cD = [0, 0, 0];
  const cN = [0, 0, 0];
  const cM = [0, 0, 0];
  for (let row = 0; row < S; row++) {
    const py = S - 1 - row; // y nach oben
    for (let px = 0; px < S; px++) {
      // nächsten Balken finden (Abstand quer zur Balken-Richtung)
      let hit = null;
      let dist = Infinity;
      let along = 0;
      for (const s of segs) {
        const rx = px - s.ax;
        const ry = py - s.ay;
        const t = rx * s.dx + ry * s.dy; // Position entlang des Balkens
        if (t < -half || t > s.len + half) continue;
        const d = Math.abs(rx * -s.dy + ry * s.dx); // Abstand zur Mittellinie
        if (d < dist) {
          dist = d;
          hit = s;
          along = t;
        }
      }
      const i = (row * S + px) * 4;
      // Anteil Holz (weiche Kante über 1.5 Pixel)
      const wood = hit ? Math.min(1, Math.max(0, (half - dist) / 1.5 + 0.5)) : 0;
      // Putz (das Foto ist eher grau → etwas aufhellen, wie heller Lehmputz)
      let r = pD[i] * PLASTER_GAIN;
      let g = pD[i + 1] * PLASTER_GAIN;
      let b = pD[i + 2] * PLASTER_GAIN;
      let nx = pN[i] / 127.5 - 1;
      let ny = pN[i + 1] / 127.5 - 1;
      let ao = pM[i] / 255;
      let rough = pM[i + 1] / 255;
      // Putz neben den Balken etwas dunkler (Schmutz, Schatten)
      if (hit && dist > half) ao *= 0.72 + 0.28 * Math.min(1, (dist - half) / (beam * 0.8));
      if (wood > 0) {
        // Holz so drehen, dass die Maserung entlang des Balkens läuft.
        // Im Foto laufen die Bretter senkrecht → Balken-Richtung = Bild-"oben".
        const cross = (px - hit.ax) * -hit.dy + (py - hit.ay) * hit.dx; // quer (−half..half)
        const u = plankX + cross * wScale * 0.8;
        const v = WS - (along * wScale + hit.seed);
        sampleWood(wD, u, v, cD);
        sampleWood(wN, u, v, cN);
        sampleWood(wM, u, v, cM);
        // Normal-Map mitdrehen: Holz-Koordinaten (quer, längs) → Wand (x, y)
        const tx = cN[0] / 127.5 - 1;
        const ty = cN[1] / 127.5 - 1;
        let wx = tx * -hit.dy + ty * hit.dx;
        let wy = tx * hit.dx + ty * hit.dy;
        // Balken-Kante abrunden: Normale kippt am Rand nach aussen
        const edge = Math.max(0, 1 - (half - dist) / (beam * 0.18));
        const side = Math.sign(cross) || 1;
        wx += -hit.dy * side * edge * 0.7;
        wy += hit.dx * side * edge * 0.7;
        r += (cD[0] * 0.8 - r) * wood;
        g += (cD[1] * 0.8 - g) * wood;
        b += (cD[2] * 0.8 - b) * wood;
        nx += (wx - nx) * wood;
        ny += (wy - ny) * wood;
        ao += (cM[0] / 255 - ao) * wood;
        rough += (cM[1] / 255 - rough) * wood;
      }
      const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      const len = Math.hypot(nx, ny, nz);
      const D = outD.data;
      const N = outN.data;
      const M = outM.data;
      D[i] = r;
      D[i + 1] = g;
      D[i + 2] = b;
      N[i] = (nx / len + 1) * 127.5;
      N[i + 1] = (ny / len + 1) * 127.5;
      N[i + 2] = (nz / len + 1) * 127.5;
      M[i] = ao * 255;
      M[i + 1] = rough * 255;
      D[i + 3] = N[i + 3] = M[i + 3] = 255;
    }
  }

  const toTex = (img, srgb) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    c.getContext('2d').putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  const set = { map: toTex(outD, true), normalMap: toTex(outN, false), arhMap: toTex(outM, false) };
  cache.set('fachwerk', set);
  return set;
}

// ---------------------------------------------------------------------------
// Felsen: Foto-Textur ohne UVs ("triplanar" = von drei Seiten projiziert)
// ---------------------------------------------------------------------------

/**
 * Macht aus einem MeshStandardMaterial ein Fels-Material mit Foto-Textur.
 * Die Textur wird in Welt-Koordinaten von oben, vorne und der Seite
 * aufprojiziert und je nach Flächen-Richtung gemischt. So braucht der Fels
 * keine UVs und nichts wird verzerrt. Die Materialfarbe bleibt die
 * Durchschnittsfarbe – das Foto liefert nur die Details.
 * tile = Meter pro Textur-Kachel.
 */
export function makeTriplanarRock(mat, key = 'fels', tile = 5) {
  if (!photos.has(key)) return false;
  const b = baseSet(key);
  const avg = averageColor(key);
  const uniforms = {
    uRockCol: { value: b.map },
    uRockNor: { value: b.normalMap },
    uRockArh: { value: b.arhMap },
    uRockAvg: { value: avg },
    uRockScale: { value: 1 / tile },
  };
  mat.onBeforeCompile = (shader) => {
    addAtmosphereUniforms(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 rockP = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
rockP = instanceMatrix * rockP;
#endif
vRockPos = (modelMatrix * rockP).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vRockPos;
uniform sampler2D uRockCol, uRockNor, uRockArh;
uniform vec3 uRockAvg;
uniform float uRockScale;
vec3 gRockN;
float gRockR;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  // Flächen-Normale in Weltkoordinaten (flache Facetten)
  vec3 wn = normalize(cross(dFdx(vRockPos), dFdy(vRockPos)));
  vec3 w = pow(abs(wn), vec3(4.0));
  w /= w.x + w.y + w.z;
  vec3 p = vRockPos * uRockScale;
  vec2 uvX = p.zy, uvY = p.xz, uvZ = p.xy;
  vec3 c = texture2D(uRockCol, uvX).rgb * w.x + texture2D(uRockCol, uvY).rgb * w.y + texture2D(uRockCol, uvZ).rgb * w.z;
  vec3 tX = texture2D(uRockNor, uvX).xyz * 2.0 - 1.0;
  vec3 tY = texture2D(uRockNor, uvY).xyz * 2.0 - 1.0;
  vec3 tZ = texture2D(uRockNor, uvZ).xyz * 2.0 - 1.0;
  vec2 m = texture2D(uRockArh, uvX).rg * w.x + texture2D(uRockArh, uvY).rg * w.y + texture2D(uRockArh, uvZ).rg * w.z;
  // "Whiteout"-Mischung: Foto-Normalen passend zu jeder Projektion drehen
  gRockN = normalize(
    vec3(abs(tX.z) * wn.x, tX.y + wn.y, tX.x + wn.z) * w.x +
    vec3(tY.x + wn.x, abs(tY.z) * wn.y, tY.y + wn.z) * w.y +
    vec3(tZ.x + wn.x, tZ.y + wn.y, abs(tZ.z) * wn.z) * w.z);
  gRockR = m.y;
  diffuseColor.rgb *= c / uRockAvg * (0.55 + 0.45 * m.x);
}`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor *= gRockR;`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(gRockN, 0.0)).xyz);`
      );
  };
  mat.customProgramCacheKey = () => `triplanar-${key}`;
  mat.needsUpdate = true;
  return true;
}

/** Mittlere Farbe (linear) einer Foto-Textur */
function averageColor(key) {
  const id = `avg:${key}`;
  if (!cache.has(id)) {
    const d = pixels(photos.get(key).diff, 64);
    const v = new THREE.Vector3();
    for (let i = 0; i < d.length; i += 4) {
      v.x += SRGB_TO_LINEAR[d[i]];
      v.y += SRGB_TO_LINEAR[d[i + 1]];
      v.z += SRGB_TO_LINEAR[d[i + 2]];
    }
    cache.set(id, v.divideScalar(d.length / 4));
  }
  return cache.get(id);
}
