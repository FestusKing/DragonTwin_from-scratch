// Blitze bei Gewitter: gezackter Leuchtstreifen + Himmelsblitz + Donner.
import * as THREE from 'three';

export class Lightning {
  constructor(scene) {
    this.scene = scene;
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 10), side: THREE.DoubleSide, fog: false, transparent: true });
    this.bolts = [];
  }

  /** Blitz von oben (Wolke) nach unten (Boden) erzeugen */
  strike(from, to, camera) {
    const pts = [];
    const segs = 22;
    const dir = to.clone().sub(from);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = from.clone().addScaledVector(dir, t);
      if (i > 0 && i < segs) {
        const j = 28 * Math.sin(t * Math.PI);
        p.x += (Math.random() - 0.5) * j;
        p.z += (Math.random() - 0.5) * j;
      }
      pts.push(p);
    }
    const geos = [this._ribbon(pts, 2.2, camera)];
    // Verzweigungen
    for (let b = 0; b < 3; b++) {
      const start = pts[4 + Math.floor(Math.random() * 10)];
      const bp = [start.clone()];
      const d = new THREE.Vector3((Math.random() - 0.5) * 2, -1.2, (Math.random() - 0.5) * 2).normalize();
      for (let i = 1; i < 7; i++) {
        const p = bp[i - 1].clone().addScaledVector(d, 14 + Math.random() * 10);
        p.x += (Math.random() - 0.5) * 12;
        p.z += (Math.random() - 0.5) * 12;
        bp.push(p);
      }
      geos.push(this._ribbon(bp, 1.0, camera));
    }
    const group = new THREE.Group();
    for (const g of geos) {
      const m = new THREE.Mesh(g, this.mat);
      m.frustumCulled = false;
      group.add(m);
    }
    this.scene.add(group);
    this.bolts.push({ group, t: 0.35 });
  }

  _ribbon(pts, width, camera) {
    const pos = [];
    const view = new THREE.Vector3();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      view.copy(camera.position).sub(a).normalize();
      const side = b.clone().sub(a).cross(view).normalize().multiplyScalar(width);
      const w2 = width * (1 - i / pts.length) + 0.3;
      side.setLength(w2);
      pos.push(
        a.x - side.x, a.y - side.y, a.z - side.z,
        a.x + side.x, a.y + side.y, a.z + side.z,
        b.x + side.x, b.y + side.y, b.z + side.z,
        a.x - side.x, a.y - side.y, a.z - side.z,
        b.x + side.x, b.y + side.y, b.z + side.z,
        b.x - side.x, b.y - side.y, b.z - side.z
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }

  update(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t -= dt;
      // Flackern
      b.group.visible = b.t > 0 && Math.random() > 0.25;
      if (b.t <= 0) {
        this.scene.remove(b.group);
        b.group.traverse((o) => o.geometry?.dispose());
        this.bolts.splice(i, 1);
      }
    }
  }
}
