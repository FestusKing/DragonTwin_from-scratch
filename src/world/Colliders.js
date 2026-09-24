// Einfache Kollision: Gebäude sind gedrehte Kisten (OBB), Felsen Kugeln.
// Der Drache ist eine Kugel. Wir prüfen: Überschneidet sich die Kugel mit
// einer Kiste? Wenn ja → herausschieben.
import * as THREE from 'three';

export class Colliders {
  constructor() {
    this.list = [];
    this.cell = 100;
    this.grid = new Map();
  }

  /** Kiste: Mittelpunkt, halbe Grössen, Drehung um y (Radiant) */
  addBox(x, y, z, hx, hy, hz, rot = 0) {
    const c = { type: 'box', x, y, z, hx, hy, hz, cos: Math.cos(rot), sin: Math.sin(rot), r: Math.hypot(hx, hy, hz) };
    this._add(c);
    return c;
  }

  addSphere(x, y, z, r) {
    const c = { type: 'sphere', x, y, z, r };
    this._add(c);
    return c;
  }

  _add(c) {
    this.list.push(c);
    const r = c.r;
    const x0 = Math.floor((c.x - r) / this.cell);
    const x1 = Math.floor((c.x + r) / this.cell);
    const z0 = Math.floor((c.z - r) / this.cell);
    const z1 = Math.floor((c.z + r) / this.cell);
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = i * 100000 + j;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    }
  }

  /**
   * Prüft Kugel (pos, radius). Gibt Normalen-Vektor (Schieberichtung) und
   * Eindringtiefe zurück, oder null.
   */
  test(pos, radius, outNormal) {
    const k = Math.floor(pos.x / this.cell) * 100000 + Math.floor(pos.z / this.cell);
    const cands = this.grid.get(k);
    if (!cands) return 0;
    let best = 0;
    for (const c of cands) {
      let nx, ny, nz, depth;
      if (c.type === 'sphere') {
        const dx = pos.x - c.x;
        const dy = pos.y - c.y;
        const dz = pos.z - c.z;
        const d = Math.hypot(dx, dy, dz);
        depth = c.r + radius - d;
        if (depth <= 0) continue;
        nx = dx / (d || 1);
        ny = dy / (d || 1);
        nz = dz / (d || 1);
      } else {
        // in lokale Koordinaten der Kiste drehen
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        const ly = pos.y - c.y;
        // nächster Punkt auf der Kiste
        const px = Math.max(-c.hx, Math.min(c.hx, lx));
        const py = Math.max(-c.hy, Math.min(c.hy, ly));
        const pz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ex = lx - px;
        let ey = ly - py;
        let ez = lz - pz;
        let d = Math.hypot(ex, ey, ez);
        if (d > radius) continue;
        if (d < 1e-4) {
          // Mittelpunkt steckt in der Kiste → kürzester Weg nach draussen
          const ox = c.hx - Math.abs(lx);
          const oy = c.hy - Math.abs(ly);
          const oz = c.hz - Math.abs(lz);
          if (oy < ox && oy < oz) {
            ex = 0; ey = Math.sign(ly) || 1; ez = 0; d = -oy;
          } else if (ox < oz) {
            ex = Math.sign(lx) || 1; ey = 0; ez = 0; d = -ox;
          } else {
            ex = 0; ey = 0; ez = Math.sign(lz) || 1; d = -oz;
          }
        } else {
          ex /= d;
          ey /= d;
          ez /= d;
        }
        depth = radius - d;
        // zurück in Welt-Richtung drehen
        nx = ex * c.cos + ez * c.sin;
        nz = -ex * c.sin + ez * c.cos;
        ny = ey;
      }
      if (depth > best) {
        best = depth;
        outNormal.set(nx, ny, nz);
      }
    }
    return best;
  }
}

export const _tmpN = new THREE.Vector3();
