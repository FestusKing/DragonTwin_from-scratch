// Vogelschwärme: kreisen über der Landschaft und fliehen vor dem Drachen.
// Die Flügel schlagen im Shader (Grafikkarte) → kostet fast nichts.
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

function birdGeometry() {
  const p = [
    // Körper
    0, 0, 0.45, -0.08, 0, -0.1, 0.08, 0, -0.1,
    0, 0, 0.45, 0.08, 0, -0.1, 0, 0.06, -0.35,
    0, 0, 0.45, 0, 0.06, -0.35, -0.08, 0, -0.1,
    // Flügel
    0.06, 0, 0.15, 0.9, 0.02, -0.12, 0.06, 0, -0.18,
    -0.06, 0, 0.15, -0.06, 0, -0.18, -0.9, 0.02, -0.12,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

export class Birds {
  constructor(scene, flocks) {
    this.time = { value: 0 };
    this.flocks = [];
    const rnd = mulberry32(51);
    let total = 0;
    for (const f of flocks) total += f.count;
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b2826, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.21;
  transformed.y += sin(uTime * 11.0 + ph) * abs(position.x) * 0.55;
#endif`
        );
    };
    this.mesh = new THREE.InstancedMesh(birdGeometry(), mat, total);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    let idx = 0;
    for (const f of flocks) {
      const flock = {
        home: new THREE.Vector3(f.x, f.y, f.z),
        center: new THREE.Vector3(f.x, f.y, f.z),
        target: new THREE.Vector3(f.x, f.y, f.z),
        range: f.range || 400,
        speed: 12,
        flee: 0,
        birds: [],
        white: f.white,
      };
      for (let i = 0; i < f.count; i++) {
        flock.birds.push({
          idx: idx,
          angle: rnd() * Math.PI * 2,
          r: 12 + rnd() * 30,
          h: (rnd() - 0.5) * 12,
          spd: (0.8 + rnd() * 0.4) * (rnd() < 0.5 ? 1 : 1),
          s: 1.4 + rnd() * 0.8,
        });
        this.mesh.setColorAt(idx, new THREE.Color(f.white ? 0xf2f2f0 : 0x2b2826));
        idx++;
      }
      this.flocks.push(flock);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  update(dt, dragonPos, visible) {
    this.mesh.visible = visible > 0.05;
    if (!this.mesh.visible) return;
    this.time.value += dt;
    for (const f of this.flocks) {
      const dd = f.center.distanceTo(dragonPos);
      if (dd < 110 && f.flee <= 0) {
        // Flucht! Weg vom Drachen
        f.flee = 6;
        const away = f.center.clone().sub(dragonPos).setY(0).normalize();
        f.target.copy(f.center).addScaledVector(away, 350);
        f.target.y = f.home.y + 40;
      }
      f.flee -= dt;
      if (f.center.distanceTo(f.target) < 30) {
        f.target.set(
          f.home.x + (Math.random() - 0.5) * f.range * 2,
          f.home.y + (Math.random() - 0.5) * 30,
          f.home.z + (Math.random() - 0.5) * f.range * 2
        );
      }
      const sp = f.flee > 0 ? 34 : f.speed;
      const dir = this._p.copy(f.target).sub(f.center);
      const len = dir.length();
      if (len > 0.01) f.center.addScaledVector(dir, Math.min(1, (sp * dt) / len));
      for (const b of f.birds) {
        b.angle += ((b.spd * (f.flee > 0 ? 2 : 1) * 14) / b.r) * dt;
        const x = f.center.x + Math.cos(b.angle) * b.r;
        const z = f.center.z + Math.sin(b.angle) * b.r;
        const y = f.center.y + b.h + Math.sin(this.time.value * 0.8 + b.angle * 2) * 3;
        // Flugrichtung = Tangente an den Kreis
        const yaw = Math.atan2(-Math.sin(b.angle), Math.cos(b.angle));
        this._e.set(0, yaw, -0.35);
        this._q.setFromEuler(this._e);
        this._s.setScalar(b.s);
        this._m.compose(this._p.set(x, y, z), this._q, this._s);
        this.mesh.setMatrixAt(b.idx, this._m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
