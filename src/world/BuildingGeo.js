// Hilfsfunktionen für Gebäude-Geometrie (Kisten, Satteldächer, Türme)
// mit "Welt-UVs": Texturen werden je nach Grösse wiederholt statt gestreckt.
import * as THREE from 'three';

/** Kiste mit Textur-Wiederholung passend zur Grösse. s = Meter pro Textur-Kachel */
export function box(w, h, d, s = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / s, (uv.getY(i) * dims[f][1]) / s);
    }
  }
  return g.toNonIndexed();
}

/** Satteldach: First entlang z. w/d = Hausgrösse, rh = Dachhöhe, o = Überstand */
export function gableRoof(w, d, rh, o = 0.8, s = 4) {
  const W = w / 2 + o;
  const D = d / 2 + o;
  const L = Math.hypot(W, rh + o * 0.4);
  const y0 = -o * 0.4; // Traufe etwas tiefer als die Wand-Oberkante
  const pos = [];
  const uv = [];
  const quad = (a, b, c, e, ua, ub, uc, ue) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
    uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ue);
  };
  // linke Seite
  quad([-W, y0, -D], [-W, y0, D], [0, rh, D], [0, rh, -D], [0, 0], [(2 * D) / s, 0], [(2 * D) / s, L / s], [0, L / s]);
  // rechte Seite
  quad([W, y0, D], [W, y0, -D], [0, rh, -D], [0, rh, D], [0, 0], [(2 * D) / s, 0], [(2 * D) / s, L / s], [0, L / s]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Die dreieckigen Giebelwände vorne und hinten (gehören zur Wand). */
export function gableEnds(w, d, rh, s = 4) {
  const W = w / 2;
  const D = d / 2;
  const pos = [
    -W, 0, D, W, 0, D, 0, rh, D, // vorne
    W, 0, -D, -W, 0, -D, 0, rh, -D, // hinten
  ];
  const uv = [0, 0, w / s, 0, W / s, rh / s, 0, 0, w / s, 0, W / s, rh / s];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Zylinder (Turm) mit passender Textur-Wiederholung */
export function tower(rTop, rBottom, h, seg = 12, s = 4) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, false);
  const uv = g.getAttribute('uv');
  const circ = Math.PI * 2 * Math.max(rTop, rBottom);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / s, (uv.getY(i) * h) / s);
  return g.toNonIndexed();
}

export function cone(r, h, seg = 12, s = 4) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, false);
  const uv = g.getAttribute('uv');
  const circ = Math.PI * 2 * r;
  const slant = Math.hypot(r, h);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / s, (uv.getY(i) * slant) / s);
  return g.toNonIndexed();
}

/** Zinnen entlang einer Strecke (für Burgmauern) */
export function battlements(length, thickness, size = 1.4, gap = 1.4) {
  const parts = [];
  const n = Math.floor(length / (size + gap));
  const start = -((n - 1) * (size + gap)) / 2;
  for (let i = 0; i < n; i++) {
    const b = box(size, size * 1.1, thickness, 4);
    b.translate(start + i * (size + gap), size * 0.55, 0);
    parts.push(b);
  }
  return parts;
}

/**
 * UVs strecken, damit Texturen in echter Grösse erscheinen.
 * Beispiel: Ein Zylinder hat UVs von 0 bis 1 – ist er 22 m lang, dann
 * scaleUV(g, …, 22 / 4) → eine UV-Einheit = 4 m (wie bei box()).
 */
export function scaleUV(g, su, sv) {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Geometrie verschieben + drehen (um y) – gibt dieselbe Geometrie zurück */
export function place(g, x, y, z, rotY = 0) {
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}
