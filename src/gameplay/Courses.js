// Die Ring-Strecken. Die Ringe werden aus markanten Orten der Welt
// berechnet (Burg, Felsbogen, Fluss, Gipfel …), damit sie immer passen.
import * as THREE from 'three';
import { PLACES } from '../world/Terrain.js';

export const COURSES = [
  { id: 'valley', name: 'Talrunde', difficulty: 'Leicht', desc: 'Über das Dorf, durch den Felsbogen im Meer, den Fluss hinauf und zurück.' },
  { id: 'summit', name: 'Gipfelsturm', difficulty: 'Schwer', desc: 'Hoch in die Berge: enge Pässe, eisige Gipfel und ein steiler Sturzflug.' },
];

/**
 * Baut die Ringliste für eine Strecke.
 * Jeder Punkt: { x, z, y (absolut) | above (über Boden), r (Radius) }
 */
export function buildCourse(id, world) {
  const t = world.terrain;
  const S = world.settlement.poi;
  const L = world.landmarks;
  const V = PLACES.village;
  const P = [];
  const add = (x, z, opts = {}) => P.push({ x, z, ...opts });

  if (id === 'valley') {
    add(V.x + 20, V.z + 40, { above: 38 });
    add(S.gate.x, S.gate.z + 25, { y: S.gate.y + 9 });
    const tt = S.towerTops;
    add((tt[0].x + tt[1].x) / 2, (tt[0].z + tt[1].z) / 2 - 20, { y: tt[0].y - 6 });
    add(S.windmill.x + 40, S.windmill.z - 40, { above: 30 });
    add(V.x - 480, V.z + 180, { above: 24 });
    add(L.lighthouse.x - 90, L.lighthouse.z + 40, { above: 38 });
    add(L.archCenter.x, L.archCenter.z, { y: L.archCenter.y, r: 11, clear: 0 });
    add(L.wreck.x - 60, L.wreck.z + 60, { above: 22 });
    add(1450, 1600, { above: 18 });
    add(1350, 1150, { above: 20 });
    add(1180, 600, { above: 22 });
    add(PLACES.island.x, PLACES.island.z + 60, { above: 26 });
    if (S.pier) add(S.pier.x + 40, S.pier.z + 60, { above: 22 });
    add(V.x + 160, V.z - 40, { above: 45 });
    add(V.x + 30, V.z + 10, { above: 36 });
  } else {
    const L2 = PLACES.lake;
    const pk = t.peak;
    const pk2 = t.peak2;
    add(L2.x - 80, L2.z - 380, { above: 40 });
    add((L2.x + pk2.x) / 2, (L2.z + pk2.z) / 2, { above: 45 });
    add(pk2.x + 230, pk2.z + 60, { above: 45 });
    add(pk2.x + 60, pk2.z - 240, { above: 50 });
    add(pk2.x - 200, pk2.z - 60, { above: 45 });
    // durch den Pass zwischen den Gipfeln (tief!)
    add((pk.x + pk2.x) / 2, (pk.z + pk2.z) / 2, { above: 28, r: 11 });
    add(pk.x + 220, pk.z + 120, { above: 40 });
    add(pk.x, pk.z, { y: pk.h + 45, r: 13 });
    add(pk.x - 250, pk.z - 60, { above: 40 });
    // steiler Sturzflug nach Süden
    add(pk.x - 150, pk.z + 450, { above: 30 });
    add(pk.x - 60, pk.z + 800, { above: 24 });
    if (L.stoneCircle) add(L.stoneCircle.x + 30, L.stoneCircle.z - 30, { above: 22 });
    add(S.churchTop.x + 30, S.churchTop.z - 20, { y: S.churchTop.y + 12 });
    const tt = S.towerTops;
    add((tt[2].x + tt[3].x) / 2, (tt[2].z + tt[3].z) / 2 + 20, { y: tt[2].y - 4, r: 11 });
    add(V.x + 60, V.z + 80, { above: 30 });
  }

  // In echte Ringe umwandeln: Höhe prüfen, Ausrichtung berechnen
  const rings = P.map((p) => {
    const ground = t.surfaceAt(p.x, p.z);
    let y = p.y ?? ground + (p.above ?? 30);
    const clear = p.clear ?? 14;
    if (clear > 0) y = Math.max(y, ground + clear);
    return { pos: new THREE.Vector3(p.x, y, p.z), radius: p.r ?? 14, normal: new THREE.Vector3() };
  });
  for (let i = 0; i < rings.length; i++) {
    const prev = rings[Math.max(0, i - 1)].pos;
    const next = rings[Math.min(rings.length - 1, i + 1)].pos;
    const n = rings[i].normal.copy(next).sub(prev);
    if (i === 0) n.copy(next).sub(rings[i].pos);
    if (i === rings.length - 1) n.copy(rings[i].pos).sub(prev);
    n.y *= 0.6;
    n.normalize();
  }
  // Die Öffnung des Felsbogens zeigt nach Osten/Westen → Ring genau so ausrichten
  if (id === 'valley') {
    const arch = rings.find((r) => Math.abs(r.pos.x - L.archCenter.x) < 1 && Math.abs(r.pos.z - L.archCenter.z) < 1);
    if (arch) {
      const s = Math.sign(arch.normal.x) || 1;
      arch.normal.set(s, 0, 0);
    }
  }
  // Streckenlänge (für die Medaillen-Zeiten)
  let length = 0;
  for (let i = 1; i < rings.length; i++) length += rings[i].pos.distanceTo(rings[i - 1].pos);
  length += 70;
  return {
    rings,
    length,
    medals: { gold: length / 52, silver: length / 42, bronze: length / 33 },
  };
}
