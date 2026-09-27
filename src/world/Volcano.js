// Vulkan "Drachenhort" im Nordosten: Lava-See im Krater, rotes Glühen, Rauchsäule,
// Funken – und im Krater der Hort des Drachen: ein Goldhaufen mit Münzen, Edelsteinen
// und drei Dracheneiern. Wer dort landet, erholt sich (macht Game.js).
// Die Form des Berges selbst kommt aus der Landschaft (Terrain.js: volcanoHeight).
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';
import { PLACES } from './Terrain.js';
import { ParticleSystem } from '../fx/Particles.js';
import { puffTexture } from '../fx/Textures.js';

const HOARD_RADIUS = 32; // so nah am Hort muss man landen (Meter)

/** Lava-Textur: dunkle Krusten-Schollen, dazwischen leuchtende Risse (kachelbar) */
function lavaTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const rnd = mulberry32(3);
  const pts = [];
  for (let i = 0; i < 30; i++) pts.push([rnd() * S, rnd() * S]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let f1 = 1e9;
      let f2 = 1e9;
      for (const [px, py] of pts) {
        // kachelbar: Abstand über den Rand hinweg
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        dx = Math.min(dx, S - dx);
        dy = Math.min(dy, S - dy);
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
      const edge = Math.sqrt(f2) - Math.sqrt(f1); // 0 = Riss
      const crack = Math.max(0, 1 - edge / 7);
      const hot = crack * crack;
      const k = (y * S + x) * 4;
      const crust = 0.12 + 0.1 * Math.sin(x * 0.3 + y * 0.2);
      img.data[k] = 255 * Math.min(1, crust + hot * 1.0);
      img.data[k + 1] = 255 * Math.min(1, crust * 0.35 + hot * 0.55);
      img.data[k + 2] = 255 * Math.min(1, crust * 0.15 + hot * 0.12);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Volcano {
  constructor(scene, terrain) {
    const V = PLACES.volcano;
    this.terrain = terrain;
    this.center = new THREE.Vector3(V.x, V.floorH, V.z);
    this.group = new THREE.Group();
    this.group.name = 'Vulkan';
    scene.add(this.group);
    this.time = 0;

    // --- Lava-See ---
    this.lavaTex = lavaTexture();
    this.lavaTex.repeat.set(3, 3);
    this.lavaMat = new THREE.MeshBasicMaterial({ map: this.lavaTex, color: new THREE.Color(2.4, 2.1, 2.0) });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(V.lavaR + 4, 48).rotateX(-Math.PI / 2), this.lavaMat);
    lake.position.set(V.x, V.floorH + 0.5, V.z);
    this.group.add(lake);

    // --- rotes Glühen im Krater ---
    this.light = new THREE.PointLight(0xff5a1a, 0, 320, 2);
    this.light.position.set(V.x, V.floorH + 30, V.z);
    this.group.add(this.light);

    // --- Hort (Richtung Süden, zwischen Lava-See und Kraterwand) ---
    this.hoard = new THREE.Vector3(V.x - 8, V.floorH, V.z + 60);
    this._buildHoard();

    // Eigene Rauchsäule: steigt hoch über den Kraterrand (der normale Rauch bremst zu stark)
    this.plume = new ParticleSystem(scene, {
      max: 320,
      texture: puffTexture(7),
      colors: [0x5a5048, 0x4a4541, 0x6a655f],
      additive: false,
      alpha: 0.6,
      gravity: 2.2,
      drag: 0.09,
      turbulence: 3,
      windFactor: 0.7,
      renderOrder: 21,
    });
    this.smokeTimer = 0;
    this.emberTimer = 0;
  }

  _buildHoard() {
    const rnd = mulberry32(11);
    const H = this.hoard;
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a332, metalness: 1, roughness: 0.3, emissive: 0x2a1500 });
    // Goldhaufen (flacher Hügel) aus Münzen
    const mound = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    mound.scale.set(1, 0.36, 0.85);
    mound.position.copy(H);
    mound.position.y -= 0.2;
    this.group.add(mound);
    // einzelne Münzen rundherum und obendrauf
    const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 10);
    const coins = new THREE.InstancedMesh(coinGeo, gold, 160);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < coins.count; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 11;
      p.set(H.x + Math.cos(a) * r, 0, H.z + Math.sin(a) * r * 0.85);
      const inMound = (r / 7) ** 2 < 1 ? 2.5 * Math.sqrt(Math.max(0, 1 - (r / 7) ** 2)) : 0;
      p.y = H.y + inMound + 0.05;
      e.set((rnd() - 0.5) * 0.9, rnd() * 6.3, (rnd() - 0.5) * 0.9);
      coins.setMatrixAt(i, m.compose(p, q.setFromEuler(e), one));
    }
    this.group.add(coins);
    // Edelsteine (leuchten leicht)
    const gemGeo = new THREE.OctahedronGeometry(0.45);
    for (const col of [0xff2030, 0x20ff60, 0x3070ff, 0xff2030, 0xffc020, 0x20ff60, 0xa040ff]) {
      const gem = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.2 }));
      const a = rnd() * Math.PI * 2;
      const r = 2 + rnd() * 6;
      gem.position.set(H.x + Math.cos(a) * r, H.y + 0.35 + Math.max(0, 2.2 * (1 - r / 7)), H.z + Math.sin(a) * r * 0.85);
      gem.rotation.set(rnd(), rnd(), rnd());
      gem.scale.y = 1.4;
      this.group.add(gem);
    }
    // Drei Dracheneier (wie Steine mit Schuppen-Glanz)
    const eggGeo = new THREE.SphereGeometry(1, 20, 14);
    const eggs = [
      [0x1c1414, 0x6a1208, -2.2, 0.6],
      [0x173a22, 0x3a2a08, 0.6, -1.4],
      [0xcfb98a, 0x5a3a10, 2.4, 0.8],
    ];
    for (const [col, emi, ox, oz] of eggs) {
      const egg = new THREE.Mesh(eggGeo, new THREE.MeshStandardMaterial({ color: col, emissive: emi, emissiveIntensity: 0.5, metalness: 0.45, roughness: 0.35 }));
      egg.scale.set(1.05, 1.5, 1.05);
      egg.position.set(H.x + ox, H.y + 2.4 + 1.2, H.z + oz);
      egg.rotation.set((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
      egg.castShadow = true;
      this.group.add(egg);
    }
  }

  /** Ist diese Stelle im Hort (zum Landen/Erholen)? */
  inHoard(pos) {
    const dx = pos.x - this.hoard.x;
    const dz = pos.z - this.hoard.z;
    return dx * dx + dz * dz < HOARD_RADIUS * HOARD_RADIUS && pos.y < this.hoard.y + 25;
  }

  /** ctx = { camPos, particles, day (0..1) } */
  update(dt, ctx) {
    const V = PLACES.volcano;
    this.time += dt;
    const t = this.time;
    // Lava bewegt sich langsam, Helligkeit pulsiert
    this.lavaTex.offset.set(t * 0.004, t * 0.0025);
    const pulse = 0.85 + 0.15 * Math.sin(t * 1.7) + 0.06 * Math.sin(t * 5.3);
    this.lavaMat.color.setRGB(2.4 * pulse, 2.1 * pulse, 2.0 * pulse);
    this.light.intensity = 14000 * pulse * (0.6 + 0.4 * (1 - ctx.day));

    const d = ctx.camPos.distanceTo(this.center);
    const P = ctx.particles;
    // Rauchsäule: dicke, graue Wolken steigen aus dem Krater weit nach oben
    const su = P.smoke.uniforms;
    this.plume.setEnvironment(su.uLight.value, su.uFogColor.value, su.uFogDensity.value);
    this.plume.update(dt, ctx.wind);
    this.smokeTimer -= dt;
    while (this.smokeTimer <= 0) {
      this.smokeTimer += 0.14;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * V.lavaR * 0.7;
      // leuchtet unten orange (Lava), oben grau
      const glow = 1.4 + Math.random() * 0.4;
      this.plume.spawn(
        V.x + Math.cos(a) * r, V.floorH + 15, V.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 4, 16 + Math.random() * 8, (Math.random() - 0.5) * 4,
        22 + Math.random() * 8, 40 + Math.random() * 20, 230 + Math.random() * 90,
        glow, glow * 0.85, glow * 0.8
      );
    }
    if (d > 6000) return;
    // Funken und Glut spritzen aus dem Lava-See (nur in der Nähe sichtbar)
    if (d < 1500) {
      this.emberTimer -= dt;
      while (this.emberTimer <= 0) {
        this.emberTimer += 0.05;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * V.lavaR;
        P.sparks.spawn(
          V.x + Math.cos(a) * r, V.floorH + 1, V.z + Math.sin(a) * r,
          (Math.random() - 0.5) * 10, 12 + Math.random() * 22, (Math.random() - 0.5) * 10,
          1.5 + Math.random() * 1.5, 1.4, 0.5, 1, 0.55, 0.2
        );
      }
    }
  }
}
