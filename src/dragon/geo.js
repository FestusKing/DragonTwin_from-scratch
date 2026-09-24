// Geometrie-Helfer für den Drachen.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Röhre, die entlang einer Punktliste läuft und dünner werden kann.
 * Perfekt für Hörner, Krallen und Beine.
 */
export function taperedTube(points, radii, radial = 8) {
  const n = points.length;
  const pos = [];
  const uv = [];
  const idx = [];
  const T = new THREE.Vector3();
  let N = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    if (i === 0) {
      // beliebige Senkrechte als Start
      N.set(0, 1, 0);
      if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
    }
    // "Parallel-Transport": Normale möglichst wenig drehen
    N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    B.crossVectors(T, N).normalize();
    for (let k = 0; k <= radial; k++) {
      const phi = (k / radial) * Math.PI * 2;
      const r = radii[i];
      const c = Math.cos(phi) * r;
      const s = Math.sin(phi) * r;
      pos.push(points[i].x + N.x * c + B.x * s, points[i].y + N.y * c + B.y * s, points[i].z + N.z * c + B.z * s);
      uv.push(k / radial, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Punkte entlang einer quadratischen Bezierkurve */
export function bezierPoints(p0, p1, p2, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    pts.push(new THREE.Vector3(
      p0.x * a + p1.x * b + p2.x * c,
      p0.y * a + p1.y * b + p2.y * c,
      p0.z * a + p1.z * b + p2.z * c
    ));
  }
  return pts;
}

/**
 * Viele kleine Teile zu EINER Geometrie verschmelzen (spart Draw-Calls).
 * parts: [{ geo, p: [x,y,z], r: [x,y,z] (Euler), s: [x,y,z] | Zahl }]
 */
export function mergeParts(parts) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const list = parts.map(({ geo, p = [0, 0, 0], r = [0, 0, 0], s = 1 }) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    }
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    const sc = Array.isArray(s) ? s : [s, s, s];
    e.set(r[0], r[1], r[2]);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(...p), q, new THREE.Vector3(...sc));
    g.applyMatrix4(m);
    return g;
  });
  return mergeGeometries(list);
}
