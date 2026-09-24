// Baum-Modelle für die Vegetation – realistischer als einfache Kugeln:
//  - ein dunkler "Kern" aus wenigen Flächen (von weitem wirkt der Baum dicht)
//  - darum herum viele "Karten": kleine Flächen mit einer Blätter- bzw.
//    Nadel-Textur, deren Ränder durchsichtig sind (alphaTest schneidet sie aus)
//    → unregelmässige, blättrige Umrisse.
// Alle Texturen werden hier im Code auf ein <canvas> gemalt.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep, TAU } from '../core/utils.js';

// Stamm und Kern bekommen die Textur-Koordinate u = 0.005 ("fester Teil"):
// Der Shader (Vegetation.js) nimmt dort nur die Eckpunkt-Farbe und schneidet nie etwas aus.
const SOLID_UV = [0.005, 0.5];
const CARD_UV = [0.03, 0.97];

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

let leafTex = null;
let needleTex = null;

/** Laub: viele kleine Blätter in einer runden Wolke, am Rand lückig. */
export function leafTexture() {
  if (leafTex) return leafTex;
  const S = 512;
  const c = canvas(S);
  const g = c.getContext('2d');
  const rnd = mulberry32(77);
  // Zweige zuerst (liegen hinter den Blättern)
  g.strokeStyle = '#4a3b2c';
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU;
    g.lineWidth = 3 + rnd() * 3;
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * 30, 256 + Math.sin(a) * 30);
    g.quadraticCurveTo(256 + Math.cos(a + 0.3) * 120, 256 + Math.sin(a + 0.3) * 120, 256 + Math.cos(a) * 200, 256 + Math.sin(a) * 200);
    g.stroke();
  }
  for (let i = 0; i < 1100; i++) {
    const a = rnd() * TAU;
    const r = Math.pow(rnd(), 0.6) * 232;
    const x = 256 + Math.cos(a) * r;
    const y = 256 + Math.sin(a) * r * 0.92;
    const len = 15 + rnd() * 15;
    const wid = len * (0.38 + rnd() * 0.14);
    // hellere Blätter aussen/oben (mehr Licht), dunklere innen
    const light = 0.78 + rnd() * 0.3 + (r / 232) * 0.12 - (y / S) * 0.12;
    const hue = 82 + rnd() * 30;
    const sat = 38 + rnd() * 22;
    const lum = (22 + rnd() * 12) * light;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * TAU);
    g.fillStyle = `hsl(${hue}, ${sat}%, ${lum}%)`;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, -wid, len / 2, 0);
    g.quadraticCurveTo(-len * 0.1, wid, -len / 2, 0);
    g.fill();
    // Mittelrippe
    g.strokeStyle = `hsla(${hue}, ${sat}%, ${lum * 0.7}%, 0.8)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.lineTo(len * 0.4, 0);
    g.stroke();
    g.restore();
  }
  leafTex = finish(c);
  return leafTex;
}

/** Nadelzweig: Ast von links (Stamm) nach rechts (Spitze), dicht mit Nadeln. */
export function needleTexture() {
  if (needleTex) return needleTex;
  const W = 512;
  const H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(91);
  g.lineCap = 'round';
  const needles = (x0, y0, x1, y1, spread, count, width) => {
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const len = spread * (1 - t * 0.6) * (0.7 + rnd() * 0.5);
      for (const sd of [-1, 1]) {
        const a = ang + sd * (0.9 + rnd() * 0.35);
        const lum = 16 + rnd() * 10 + t * 8; // Spitzen = junge, hellere Triebe
        g.strokeStyle = `hsl(${112 + rnd() * 28}, ${28 + rnd() * 16}%, ${lum}%)`;
        g.lineWidth = width * (0.8 + rnd() * 0.5);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
    }
  };
  // Seitenzweige (dicht, nach aussen kürzer)
  for (let i = 0; i < 16; i++) {
    const t = 0.06 + i * 0.056;
    const x = 12 + t * 480;
    const sd = i % 2 ? 1 : -1;
    const len = (1 - t) * 150 + 40;
    const x1 = x + len * 0.55;
    const y1 = H / 2 + sd * Math.min(len * 0.62, 118);
    g.strokeStyle = '#3d3024';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, H / 2);
    g.lineTo(x1, y1);
    g.stroke();
    needles(x, H / 2, x1, y1, 30, 34, 2.4);
  }
  // Hauptast
  g.strokeStyle = '#3a2e22';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(8, H / 2);
  g.lineTo(500, H / 2);
  g.stroke();
  needles(8, H / 2, 504, H / 2, 38, 90, 2.6);
  needleTex = finish(c);
  return needleTex;
}

// ---------------------------------------------------------------------------
// Geometrie-Baukasten
// ---------------------------------------------------------------------------
class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  /** Fertige Three-Geometrie (Stamm, Kern) mit einer Farbe übernehmen. */
  addSolid(geo, color, shade = null) {
    const g = geo.index ? geo : mergeVertices(geo);
    g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(SOLID_UV[0], SOLID_UV[1]);
      const k = shade ? shade(p.getX(i), p.getY(i), p.getZ(i)) : 1;
      this.col.push(color.r * k, color.g * k, color.b * k);
    }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(base + ix[i]);
  }

  /**
   * Karte (Viereck mit Textur). c = Mitte, ax/ay = halbe Seitenvektoren,
   * normalFn(p) = Normale je Ecke, uv = [u0, v0, u1, v1], shade(p) = Helligkeit.
   */
  addCard(c, ax, ay, normalFn, uv, shade) {
    const base = this.count;
    const corners = [
      [-1, -1, uv[0], uv[1]],
      [1, -1, uv[2], uv[1]],
      [1, 1, uv[2], uv[3]],
      [-1, 1, uv[0], uv[3]],
    ];
    for (const [sx, sy, u, v] of corners) {
      const p = new THREE.Vector3().copy(c).addScaledVector(ax, sx).addScaledVector(ay, sy);
      const n = normalFn(p);
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(u, v);
      const k = shade(p);
      this.col.push(k, k, k);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function jitter(geo, amount, rnd) {
  const g = geo.index ? geo : mergeVertices(geo);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + (rnd() - 0.5) * amount, p.getY(i) + (rnd() - 0.5) * amount, p.getZ(i) + (rnd() - 0.5) * amount);
  }
  return g;
}

const ico = (r, d = 0) => mergeVertices(new THREE.IcosahedronGeometry(r, d).deleteAttribute('uv').deleteAttribute('normal'));
const cyl = (r0, r1, h, seg) => mergeVertices(new THREE.CylinderGeometry(r0, r1, h, seg, 1, true).deleteAttribute('uv').deleteAttribute('normal'));

/** Zwei Achsen senkrecht zu n (für Karten, zufällig gedreht). */
function tangents(n, rnd) {
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3().crossVectors(n, ref).normalize();
  const b = new THREE.Vector3().crossVectors(n, a).normalize();
  const r = rnd() * TAU;
  const ta = a.clone().multiplyScalar(Math.cos(r)).addScaledVector(b, Math.sin(r));
  const tb = new THREE.Vector3().crossVectors(n, ta).normalize();
  return [ta, tb];
}

/**
 * Blätterkrone aus Klumpen: Kern + Karten auf den Klumpen-Oberflächen.
 * lumps = [{ c: Vector3, r }], cc = Mittelpunkt der Krone, top/bottom = Höhe der Krone
 */
function crown(B, lumps, cc, bottom, top, rnd, cardsPer, cardSize, coreColor) {
  const shade = (p) => 0.5 + 0.5 * smoothstep(bottom, top, p.y);
  for (const L of lumps) {
    const core = jitter(ico(L.r * 0.66, 0), L.r * 0.18, rnd).translate(L.c.x, L.c.y, L.c.z);
    B.addSolid(core, coreColor, (x, y) => 0.55 + 0.45 * smoothstep(bottom, top, y));
  }
  const n = new THREE.Vector3();
  for (const L of lumps) {
    for (let i = 0; i < cardsPer; i++) {
      // Richtung: gleichmässig auf der Kugel, unten etwas seltener
      const u = rnd() * 2 - 1;
      const phi = rnd() * TAU;
      n.set(Math.sqrt(1 - u * u) * Math.cos(phi), u, Math.sqrt(1 - u * u) * Math.sin(phi));
      if (n.y < -0.4 && rnd() < 0.5) n.y *= -0.5;
      n.normalize();
      const c = L.c.clone().addScaledVector(n, L.r * (0.55 + rnd() * 0.4));
      const s = cardSize * (0.75 + rnd() * 0.5);
      // Karte nicht genau tangential, sondern etwas zufällig gekippt → keine flachen Kanten
      const cn = n.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(1.3)).normalize();
      const [ta, tb] = tangents(cn, rnd);
      const light = 0.85 + rnd() * 0.25;
      B.addCard(
        c,
        ta.multiplyScalar(s / 2),
        tb.multiplyScalar(s / 2),
        // weiche "Kugel"-Normale der ganzen Krone → Licht wie bei echtem Laub
        (p) => new THREE.Vector3().subVectors(p, cc).normalize().multiplyScalar(0.7).addScaledVector(n, 0.3).normalize(),
        [CARD_UV[0], CARD_UV[0], CARD_UV[1], CARD_UV[1]],
        (p) => shade(p) * light
      );
    }
  }
}

/** Laubbaum (ca. 9.5 m hoch bei Skalierung 1). */
export function makeBroadleafTree(seed = 1) {
  const rnd = mulberry32(seed);
  const B = new Builder();
  const bark = new THREE.Color(0x5a4a3a);
  B.addSolid(cyl(0.3, 0.55, 5.2, 7).translate(0, 2.6, 0), bark, (x, y) => 0.6 + y * 0.06);
  // Äste in die Krone
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rnd();
    const br = cyl(0.08, 0.2, 3.0, 5).translate(0, 1.5, 0);
    br.rotateZ(0.65 + rnd() * 0.3);
    br.rotateY(a);
    br.translate(0, 4.2 + rnd() * 0.8, 0);
    B.addSolid(br, bark, () => 0.7);
  }
  const lumps = [
    { c: new THREE.Vector3(0, 7.3, 0), r: 3.2 },
    { c: new THREE.Vector3(1.9, 6.3, 0.8), r: 2.4 },
    { c: new THREE.Vector3(-1.7, 6.5, -1.1), r: 2.3 },
    { c: new THREE.Vector3(0.6, 6.0, -2.0), r: 2.0 },
    { c: new THREE.Vector3(0.3, 8.9, -0.6), r: 1.9 },
    { c: new THREE.Vector3(-1.2, 5.9, 1.6), r: 1.9 },
  ];
  crown(B, lumps, new THREE.Vector3(0, 7, 0), 4.2, 10.5, rnd, 14, 1.9, new THREE.Color(0x36491f));
  return B.build();
}

/** Nadelbaum / Tanne (ca. 11.5 m hoch). */
export function makeConiferTree(seed = 2) {
  const rnd = mulberry32(seed);
  const B = new Builder();
  B.addSolid(cyl(0.12, 0.42, 12.5, 6).translate(0, 6.25, 0), new THREE.Color(0x4a3b2c), (x, y) => 0.55 + y * 0.03);
  const tiers = 8;
  const coreColor = new THREE.Color(0x23331f);
  const uv = [0.03, 0.03, 0.985, 0.97];
  let angle = rnd() * TAU;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 3.2 - t * 2.6;
    const h = 2.7 - t * 0.9;
    const y = 2.2 + i * 1.3;
    // dunkler Kern (Kegel), etwas kleiner als die Zweige
    const cone = jitter(new THREE.ConeGeometry(r * 0.84, h, 8, 1, true).deleteAttribute('uv').deleteAttribute('normal'), 0.22, rnd);
    cone.translate(0, y + h / 2, 0);
    B.addSolid(cone, coreColor, (x, yy) => 0.5 + 0.3 * t + 0.2 * smoothstep(y, y + h, yy));
    // hängende Zweige rundherum
    const n = 8 + Math.round((1 - t) * 5);
    for (let k = 0; k < n; k++) {
      angle += 2.39996; // goldener Winkel → gleichmässig verteilt
      const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const start = new THREE.Vector3(0, y + h * 0.55, 0);
      const end = dir.clone().multiplyScalar(r * (1.02 + rnd() * 0.18)).add(new THREE.Vector3(0, y - 0.1 - rnd() * 0.25, 0));
      const along = new THREE.Vector3().subVectors(end, start);
      const len = along.length();
      along.normalize();
      const side = new THREE.Vector3().crossVectors(along, new THREE.Vector3(0, 1, 0)).normalize();
      const width = 0.9 + r * 0.36;
      const c = start.clone().addScaledVector(along, len / 2);
      const nUp = new THREE.Vector3().crossVectors(side, along).normalize(); // zeigt nach oben/aussen
      const light = (0.62 + 0.38 * t) * (0.85 + rnd() * 0.25);
      B.addCard(
        c,
        along.clone().multiplyScalar(len / 2),
        side.clone().multiplyScalar(width / 2),
        (p) => new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.6).addScaledVector(nUp, 0.4).normalize(),
        uv,
        () => light
      );
    }
  }
  // Spitze
  const top = new THREE.Vector3(0, 2.2 + (tiers - 1) * 1.3 + 2.4, 0);
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI * 0.5;
    B.addCard(
      top.clone().add(new THREE.Vector3(0, -0.6, 0)),
      new THREE.Vector3(0, 0.9, 0),
      new THREE.Vector3(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35),
      () => new THREE.Vector3(0, 1, 0),
      uv,
      () => 1
    );
  }
  return B.build();
}

/** Busch (ca. 2 m hoch). */
export function makeBushModel(seed = 3) {
  const rnd = mulberry32(seed);
  const B = new Builder();
  const lumps = [
    { c: new THREE.Vector3(0, 0.9, 0), r: 1.3 },
    { c: new THREE.Vector3(0.9, 0.7, 0.4), r: 0.95 },
    { c: new THREE.Vector3(-0.7, 0.65, -0.5), r: 0.9 },
  ];
  crown(B, lumps, new THREE.Vector3(0, 0.8, 0), 0.0, 2.2, rnd, 9, 1.1, new THREE.Color(0x2c3a1c));
  return B.build();
}
