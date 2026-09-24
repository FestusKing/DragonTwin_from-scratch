// Mittelalterliches Dorf: Burg, Kirche, Windmühle, Fachwerkhütten, Marktstände,
// Wachtürme, ein kleines Fischerdorf am See und ein Leuchtturm an der Küste.
// Holzgebäude sind "brennbar" (siehe BurnSystem).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep, clamp } from '../core/utils.js';
import { box, gableRoof, gableEnds, tower, cone, battlements, scaleUV } from './BuildingGeo.js';
import { PLACES, distToPolyline } from './Terrain.js';
import { surfaceMaterial } from '../fx/Textures.js';
import { addAtmosphereUniforms } from '../fx/Atmosphere.js';

const WHITE = new THREE.Color(1, 1, 1);
const CHAR = new THREE.Color(0.07, 0.06, 0.055);
const _c = new THREE.Color();

// Materialien für die Dächer (Foto-Texturen, falls geladen – sonst gemalt).
// avgColor färbt das Foto auf diese mittlere Farbe ein.
const THATCH = ['stroh', { roughness: 0.95, side: THREE.DoubleSide }, { avgColor: 0x8c7856, normalScale: 1.6 }]; // altes, nachgedunkeltes Stroh
const TILES = ['schiefer', { roughness: 0.95, side: THREE.DoubleSide }, { avgColor: 0x7c5446 }]; // rötliche Ziegel

/** Brennendes Material: von der eigenen Grundfarbe (base) Richtung Holzkohle */
function charColor(mat, base, t) {
  mat.color.copy(base).lerp(CHAR, t);
}

function bannerTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#7a1414';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#d8a93a';
  g.fillRect(0, 0, 64, 8);
  // stilisierter Drache (Kreis + Flügel-Dreiecke)
  g.beginPath();
  g.moveTo(32, 30);
  g.lineTo(10, 62);
  g.lineTo(26, 58);
  g.lineTo(32, 90);
  g.lineTo(38, 58);
  g.lineTo(54, 62);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(32, 108);
  g.lineTo(64, 128);
  g.fillStyle = 'rgba(0,0,0,0)';
  g.globalCompositeOperation = 'destination-out';
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Settlement {
  constructor(scene, terrain, colliders) {
    this.scene = scene;
    this.terrain = terrain;
    this.colliders = colliders;
    this.group = new THREE.Group();
    this.group.name = 'Settlement';
    scene.add(this.group);
    this.flammables = [];
    this.exclusions = [];
    this.chimneys = [];
    this.animated = []; // Windmühlen-Flügel, Leuchtturm-Strahl …
    this.poi = {};
    this.rnd = mulberry32(2024);
    this.time = { value: 0 };

    // gemeinsame Materialien
    this.mats = {
      stone: surfaceMaterial('stein', { roughness: 0.92 }, { roughness: 1 }),
      slate: surfaceMaterial('schiefer', { color: 0x8894a8, roughness: 0.8, side: THREE.DoubleSide }, { avgColor: 0x5f646b, roughness: 1 }),
      wood: surfaceMaterial('holz', { roughness: 0.9 }, { roughness: 1 }),
      darkWood: surfaceMaterial('holz', { color: 0x6b5a4a, roughness: 0.9 }, { avgColor: 0x5a4a3e, roughness: 1 }),
      window: new THREE.MeshStandardMaterial({ color: 0x1c1712, emissive: 0xffa94d, emissiveIntensity: 0, roughness: 0.4 }),
      plaster: surfaceMaterial('putz', { color: 0xe8e2d4, roughness: 0.9 }, { avgColor: 0xd9d3c4, roughness: 1 }),
      red: surfaceMaterial('putz', { color: 0xa8302a, roughness: 0.8 }, { avgColor: 0x9a2e26, roughness: 1 }),
    };
    const banner = new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.5 });
    banner.onBeforeCompile = (shader) => {
      addAtmosphereUniforms(shader);
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float fl = (1.0 - uv.y);
transformed.z += sin(uTime * 5.0 + position.y * 0.9 + position.x) * 0.35 * fl;`
        );
    };
    this.mats.banner = banner;
  }

  ground(x, z) {
    return this.terrain.heightAt(x, z);
  }

  /** Alles bauen. landmarks liefert die Küstenposition für den Leuchtturm. */
  build(landmarks) {
    const V = PLACES.village;
    this.center = new THREE.Vector3(V.x, this.ground(V.x, V.z), V.z);
    this.poi.square = this.center.clone();

    this._castle(V.x + 40, V.z - 130);
    this._church(V.x + 105, V.z + 55);
    this._windmill(V.x - 185, V.z + 70);
    this._huts();
    this._market();
    this._watchtowers();
    this._hamlet();
    if (landmarks?.lighthouse) this._lighthouse(landmarks.lighthouse);
    this._paintSplat();
    this.terrain.finishSplat();
    this._hayBales();
    return this;
  }

  // ---------------------------------------------------------------- Burg
  _castle(cx, cz) {
    const base = this.ground(cx, cz) - 1;
    const S = 40; // halbe Kantenlänge
    const wallH = 11;
    const stone = [];
    const roofs = [];
    const add = (g, x, y, z) => {
      g.translate(x, y, z);
      stone.push(g);
    };
    // Mauern (Süden mit Tor-Lücke)
    const wall = (len, x, z, rotY) => {
      const parts = [box(len, wallH + 2, 3, 4).translate(0, (wallH + 2) / 2, 0)];
      for (const b of battlements(len, 3)) parts.push(b.translate(0, wallH + 2, 0));
      const g = mergeGeometries(parts);
      if (rotY) g.rotateY(rotY);
      g.translate(x, base, z);
      stone.push(g);
      const c = rotY ? [1.5, len / 2] : [len / 2, 1.5];
      this.colliders.addBox(x, base + (wallH + 3) / 2, z, c[0], (wallH + 3) / 2, c[1]);
    };
    wall(S * 2, cx, cz - S, 0);
    wall(S * 2, cx - S, cz, Math.PI / 2);
    wall(S * 2, cx + S, cz, Math.PI / 2);
    wall(S - 7, cx - S / 2 - 3.5, cz + S, 0);
    wall(S - 7, cx + S / 2 + 3.5, cz + S, 0);
    // Torbogen
    add(box(14, 4, 4, 4), cx, base + wallH + 1, cz + S);

    // Ecktürme mit Kegeldächern
    this.poi.towerTops = [];
    const towers = [
      [cx - S, cz - S], [cx + S, cz - S], [cx - S, cz + S], [cx + S, cz + S],
    ];
    for (const [tx, tz] of towers) {
      add(tower(5.5, 6.2, 22, 12), tx, base + 11, tz);
      const r = cone(7.2, 10, 12);
      r.translate(tx, base + 27, tz);
      roofs.push(r);
      this.colliders.addBox(tx, base + 16, tz, 6.2, 16, 6.2);
      this.poi.towerTops.push(new THREE.Vector3(tx, base + 32, tz));
      this._banner(tx, base + 32, tz, 2.2, 4);
    }
    // Torturm-Paar
    for (const s of [-1, 1]) {
      add(tower(3.6, 4, 17, 10), cx + s * 8.5, base + 8.5, cz + S);
      const r = cone(4.8, 6, 10);
      r.translate(cx + s * 8.5, base + 20, cz + S);
      roofs.push(r);
      this.colliders.addBox(cx + s * 8.5, base + 11, cz + S, 4, 11, 4);
    }
    this.poi.gate = new THREE.Vector3(cx, base + 7, cz + S + 12);

    // Bergfried (Hauptturm) – oben flach (dort wohnt eine Ziege …)
    const kh = 32;
    const keep = box(22, kh, 22, 4);
    keep.translate(cx, base + kh / 2, cz - 8);
    stone.push(keep);
    for (const [bx, bz, rot] of [[0, 11, 0], [0, -11, 0], [11, 0, Math.PI / 2], [-11, 0, Math.PI / 2]]) {
      for (const b of battlements(22, 1.6)) {
        b.rotateY(rot);
        b.translate(cx + bx, base + kh, cz - 8 + bz);
        stone.push(b);
      }
    }
    this.colliders.addBox(cx, base + kh / 2, cz - 8, 11.5, kh / 2 + 1, 11.5);
    this.poi.keepTop = new THREE.Vector3(cx, base + kh, cz - 8);
    this._banner(cx - 8, base + kh + 8, cz - 16, 3, 6, true);

    // Palas (Wohnhalle)
    const hall = box(26, 10, 12, 4);
    hall.translate(cx + 8, base + 5, cz + 18);
    stone.push(hall);
    const hr = gableRoof(12, 26, 6, 0.8);
    hr.rotateY(Math.PI / 2);
    hr.translate(cx + 8, base + 10, cz + 18);
    roofs.push(hr);
    const he = gableEnds(12, 26, 6);
    he.rotateY(Math.PI / 2);
    he.translate(cx + 8, base + 10, cz + 18);
    stone.push(he);
    this.colliders.addBox(cx + 8, base + 8, cz + 18, 13, 8, 6);

    const stoneMesh = new THREE.Mesh(mergeGeometries(stone), this.mats.stone);
    const roofMesh = new THREE.Mesh(mergeGeometries(roofs), this.mats.slate);
    for (const m of [stoneMesh, roofMesh]) {
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    this.poi.castle = new THREE.Vector3(cx, base, cz);
    this.exclusions.push({ x: cx, z: cz, r: 70 });
  }

  _banner(x, y, z, w, h, big = false) {
    const pole = box(0.25, h + 2, 0.25, 4);
    pole.translate(0, (h + 2) / 2 - h, 0);
    const pm = new THREE.Mesh(pole, this.mats.darkWood);
    pm.position.set(x, y, z);
    this.group.add(pm);
    const g = new THREE.PlaneGeometry(w, h, 6, 8);
    g.translate(w / 2, -h / 2 + 1.5, 0);
    const m = new THREE.Mesh(g, this.mats.banner);
    m.position.set(x, y, z);
    m.rotation.y = big ? 0.5 : this.rnd() * 6;
    m.castShadow = true;
    this.group.add(m);
  }

  // --------------------------------------------------------------- Kirche
  _church(x, z) {
    const rot = 0.35;
    const base = Math.min(this.ground(x, z), this.ground(x + 10, z + 10), this.ground(x - 10, z - 10)) - 1;
    const g = new THREE.Group();
    g.position.set(x, base, z);
    g.rotation.y = rot;
    const nave = box(12, 11, 26, 4);
    nave.translate(0, 5.5, 3);
    const ends = gableEnds(12, 26, 6);
    ends.translate(0, 11, 3);
    const tw = box(8, 30, 8, 4);
    tw.translate(0, 15, -14);
    const stone = new THREE.Mesh(mergeGeometries([nave, ends, tw]), this.mats.stone);
    const roof = gableRoof(12, 26, 6, 0.8);
    roof.translate(0, 11, 3);
    const spire = cone(6.2, 14, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(0, 37, -14);
    const roofMesh = new THREE.Mesh(mergeGeometries([roof, spire]), this.mats.slate);
    // Glockenfenster
    const wins = [];
    for (const [px, pz, ry] of [[0, -9.95, 0], [0, -18.05, Math.PI], [4.05, -14, Math.PI / 2], [-4.05, -14, -Math.PI / 2]]) {
      const w = new THREE.PlaneGeometry(1.8, 3.5).toNonIndexed();
      w.rotateY(ry);
      w.translate(px, 25, pz);
      wins.push(w);
    }
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) {
        const w = new THREE.PlaneGeometry(1.4, 3).toNonIndexed();
        w.rotateY((s * Math.PI) / 2);
        w.translate(s * 6.05, 6, -4 + i * 5.5);
        wins.push(w);
      }
    }
    const winMesh = new THREE.Mesh(mergeGeometries(wins), this.mats.window);
    for (const m of [stone, roofMesh]) {
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    g.add(winMesh);
    this.group.add(g);
    // Kollision (in Weltkoordinaten)
    const off = new THREE.Vector3(0, 0, 3).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.colliders.addBox(x + off.x, base + 8, z + off.z, 6.5, 8.5, 13.5, rot);
    const toff = new THREE.Vector3(0, 0, -14).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.colliders.addBox(x + toff.x, base + 22, z + toff.z, 4.5, 22, 4.5, rot);
    this.poi.church = new THREE.Vector3(x, base, z);
    this.poi.churchTop = new THREE.Vector3(x + toff.x, base + 44, z + toff.z);
    this.exclusions.push({ x, z, r: 26 });
  }

  // ------------------------------------------------------------ Windmühle
  _windmill(x, z) {
    const base = this.ground(x, z) - 0.5;
    const g = new THREE.Group();
    g.position.set(x, base, z);
    g.rotation.y = 0.4;
    const body = new THREE.Mesh(tower(3.3, 4.6, 14, 10, 4), this.mats.plaster);
    body.position.y = 7;
    const capMat = this.mats.wood.clone();
    const cap = new THREE.Mesh(cone(4.3, 5, 10), capMat);
    cap.position.y = 16.5;
    const sails = new THREE.Group();
    sails.position.set(0, 13.5, 4.4);
    const sailMat = this.mats.darkWood.clone();
    const capBase = capMat.color.clone();
    const sailBase = sailMat.color.clone();
    const clothMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.95, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.z = (i / 4) * Math.PI * 2;
      const spar = new THREE.Mesh(box(0.4, 12, 0.35, 4), sailMat);
      spar.position.y = 6;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 9), clothMat);
      cloth.position.set(1.4, 7, 0.05);
      arm.add(spar, cloth);
      sails.add(arm);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), sailMat);
    sails.add(hub);
    g.add(body, cap, sails);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.group.add(g);
    const mill = { sails, speed: 0.6, alive: true };
    this.animated.push((dt, wind) => {
      if (mill.alive) sails.rotation.z += dt * (0.3 + wind * 0.9);
    });
    this.colliders.addBox(x, base + 9, z, 4.8, 9, 4.8);
    this.poi.windmill = new THREE.Vector3(x, base, z);
    this.exclusions.push({ x, z, r: 16 });
    // brennbar: Kappe und Flügel
    this.flammables.push({
      kind: 'windmill',
      x,
      y: base + 14,
      z,
      r: 9,
      h: 10,
      w: 8,
      d: 8,
      fuel: 30,
      onProgress: (t) => {
        charColor(capMat, capBase, smoothstep(0, 0.7, t));
        charColor(sailMat, sailBase, smoothstep(0, 0.7, t));
        clothMat.color.setHex(0xe6dcc0).lerp(CHAR, smoothstep(0, 0.4, t));
        clothMat.opacity = 1;
        if (t > 0.35) mill.alive = false;
        for (const arm of sails.children) if (arm.children[1]) arm.children[1].visible = t < 0.5;
      },
      onReset: () => {
        capMat.color.copy(capBase);
        sailMat.color.copy(sailBase);
        clothMat.color.setHex(0xe6dcc0);
        mill.alive = true;
        for (const arm of sails.children) if (arm.children[1]) arm.children[1].visible = true;
      },
    });
  }

  // --------------------------------------------------------------- Hütten
  _hut(x, z, rot, opts = {}) {
    const rnd = this.rnd;
    const w = opts.w ?? 7 + rnd() * 3;
    const d = opts.d ?? 9 + rnd() * 4;
    const wallH = opts.wallH ?? 4 + rnd() * 1.5;
    const roofH = opts.roofH ?? 3.2 + rnd() * 1.5;
    const tile = opts.tile ?? rnd() < 0.3;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const cornerH = [];
    for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      cornerH.push(this.ground(x + a * cs + b * sn, z - a * sn + b * cs));
    }
    const y0 = Math.min(...cornerH) - 0.6;
    const y1 = Math.max(...cornerH);
    const baseH = y1 - y0 + wallH;

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;

    const wallMat = surfaceMaterial('fachwerk', { roughness: 0.92 }, { roughness: 1 });
    const roofMat = surfaceMaterial(...(tile ? TILES : THATCH));
    const wallBase = wallMat.color.clone();
    const roofBase = roofMat.color.clone();
    const wall = box(w, baseH, d, 4);
    wall.translate(0, y0 + baseH / 2, 0);
    const gable = gableEnds(w, d, roofH);
    gable.translate(0, y1 + wallH, 0);
    const wallMesh = new THREE.Mesh(mergeGeometries([wall, gable]), wallMat);
    const roofGeo = gableRoof(w, d, roofH, 0.8);
    const roofMesh = new THREE.Mesh(roofGeo, roofMat);
    roofMesh.position.y = y1 + wallH;
    const door = new THREE.Mesh(box(1.6, 2.4, 0.3, 4), this.mats.darkWood);
    door.position.set(0, y1 + 1.2, d / 2 + 0.05);
    // Fenster (leuchten nachts)
    const wins = [];
    const wy = y1 + wallH * 0.55;
    for (const s of [-1, 1]) {
      for (const k of [-0.25, 0.25]) {
        const p = new THREE.PlaneGeometry(1.1, 1.1).toNonIndexed();
        p.rotateY((s * Math.PI) / 2);
        p.translate(s * (w / 2 + 0.03), wy, k * d);
        wins.push(p);
      }
    }
    const fw = new THREE.PlaneGeometry(1.1, 1.1).toNonIndexed();
    fw.translate(w * 0.28, wy, d / 2 + 0.03);
    wins.push(fw);
    const winMesh = new THREE.Mesh(mergeGeometries(wins), this.mats.window);
    g.add(wallMesh, roofMesh, door, winMesh);
    let chimney = null;
    if (rnd() < 0.55) {
      chimney = new THREE.Mesh(box(1.2, 3.2, 1.2, 4), this.mats.stone);
      chimney.position.set(w * 0.22, y1 + wallH + roofH * 0.55, -d * 0.2);
      g.add(chimney);
      const cp = new THREE.Vector3(w * 0.22, y1 + wallH + roofH * 0.55 + 1.7, -d * 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      this.chimneys.push({ x: x + cp.x, y: cp.y, z: z + cp.z, alive: true, t: rnd() * 3 });
    }
    const chimneyRef = this.chimneys[this.chimneys.length - 1];
    g.traverse((o) => {
      if (o.isMesh && o !== winMesh) o.castShadow = o.receiveShadow = true;
    });
    this.group.add(g);
    this.colliders.addBox(x, y0 + (baseH + roofH) / 2, z, w / 2 + 0.6, (baseH + roofH) / 2, d / 2 + 0.6, rot);
    this.exclusions.push({ x, z, r: Math.max(w, d) * 0.9 + 3 });

    const hasChimney = !!chimney;
    this.flammables.push({
      kind: 'hut',
      x,
      y: y1 + wallH * 0.6,
      z,
      r: Math.max(w, d) * 0.6 + 3,
      h: wallH + roofH,
      w,
      d,
      rot,
      fuel: 24 + rnd() * 12,
      onProgress: (t) => {
        charColor(wallMat, wallBase, smoothstep(0.05, 0.85, t));
        charColor(roofMat, roofBase, smoothstep(0, 0.5, t));
        winMesh.visible = false;
        const col = smoothstep(0.55, 0.9, t);
        roofMesh.scale.set(1, 1 - col * 0.8, 1);
        roofMesh.position.y = y1 + wallH - col * 1.5;
        if (hasChimney) chimneyRef.alive = false;
      },
      onReset: () => {
        wallMat.color.copy(wallBase);
        roofMat.color.copy(roofBase);
        winMesh.visible = true;
        roofMesh.scale.set(1, 1, 1);
        roofMesh.position.y = y1 + wallH;
        if (hasChimney) chimneyRef.alive = true;
      },
    });
    return { x, z, w, d, rot };
  }

  _huts() {
    const V = this.center;
    const rnd = this.rnd;
    const placed = [];
    this.huts = placed;
    const blocked = (x, z) => {
      for (const e of this.exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r + 6) return true;
      for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < 19) return true;
      return false;
    };
    let tries = 0;
    while (placed.length < 24 && tries < 3000) {
      tries++;
      const a = rnd() * Math.PI * 2;
      const r = 32 + Math.sqrt(rnd()) * 170;
      const x = V.x + Math.cos(a) * r;
      const z = V.z + Math.sin(a) * r;
      if (blocked(x, z)) continue;
      const h = this.ground(x, z);
      if (Math.abs(h - V.y) > 6) continue;
      const rot = Math.atan2(V.x - x, V.z - z) + (rnd() - 0.5) * 0.5;
      placed.push(this._hut(x, z, rot));
    }
  }

  _market() {
    const V = this.center;
    const colors = [0xb03a2e, 0x2e5fa0, 0xd8b04a, 0x3f7a3a];
    // Brunnen
    const well = mergeGeometries([tower(1.8, 1.9, 1.2, 12, 4).translate(0, 0.6, 0)]);
    const wm = new THREE.Mesh(well, this.mats.stone);
    wm.position.copy(V);
    wm.castShadow = true;
    this.group.add(wm);
    const wr = new THREE.Mesh(cone(2.4, 1.6, 6), this.mats.darkWood);
    wr.position.set(V.x, V.y + 3.6, V.z);
    const posts = new THREE.Mesh(mergeGeometries([box(0.2, 3, 0.2).translate(-1.6, 1.5, 0), box(0.2, 3, 0.2).translate(1.6, 1.5, 0)]), this.mats.darkWood);
    posts.position.copy(V);
    this.group.add(wr, posts);
    this.colliders.addSphere(V.x, V.y + 1, V.z, 2.5);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const x = V.x + Math.cos(a) * 13;
      const z = V.z + Math.sin(a) * 13;
      const y = this.ground(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = -a + Math.PI / 2;
      const clothMat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.9, side: THREE.DoubleSide });
      const legs = [];
      for (const [px, pz] of [[-1.8, -1.2], [1.8, -1.2], [-1.8, 1.2], [1.8, 1.2]]) legs.push(box(0.15, 2.6, 0.15).translate(px, 1.3, pz));
      legs.push(box(3.8, 0.15, 2.2).translate(0, 1, 0));
      const lm = new THREE.Mesh(mergeGeometries(legs), this.mats.wood);
      const roof = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3), clothMat);
      roof.rotation.x = -Math.PI / 2 + 0.25;
      roof.position.y = 2.7;
      g.add(lm, roof);
      g.traverse((o) => o.isMesh && (o.castShadow = true));
      this.group.add(g);
      const orig = colors[i];
      this.flammables.push({
        kind: 'stall',
        x,
        y: y + 2,
        z,
        r: 4,
        h: 3,
        w: 4,
        d: 3,
        fuel: 8,
        onProgress: (t) => {
          clothMat.color.setHex(orig).lerp(CHAR, smoothstep(0, 0.5, t));
          roof.visible = t < 0.6;
        },
        onReset: () => {
          clothMat.color.setHex(orig);
          roof.visible = true;
        },
      });
    }
    this.exclusions.push({ x: V.x, z: V.z, r: 22 });
  }

  // ------------------------------------------------------------ Wachtürme
  _watchtower(x, z) {
    const y = this.ground(x, z) - 0.3;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const woodMat = this.mats.wood.clone();
    const roofMat = surfaceMaterial(...THATCH);
    const woodBase = woodMat.color.clone();
    const roofBase = roofMat.color.clone();
    const parts = [];
    for (const [px, pz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) parts.push(box(0.5, 13, 0.5).translate(px, 6.5, pz));
    parts.push(box(6.4, 0.5, 6.4).translate(0, 10, 0));
    for (const [px, pz, w, d] of [[0, 3, 6.4, 0.2], [0, -3, 6.4, 0.2], [3, 0, 0.2, 6.4], [-3, 0, 0.2, 6.4]]) parts.push(box(w, 1, d).translate(px, 11, pz));
    // Streben
    const b1 = box(0.3, 8, 0.3);
    b1.rotateZ(0.6);
    b1.translate(0, 5, 2.5);
    const b2 = box(0.3, 8, 0.3);
    b2.rotateZ(-0.6);
    b2.translate(0, 5, -2.5);
    parts.push(b1, b2);
    const wm = new THREE.Mesh(mergeGeometries(parts), woodMat);
    const rm = new THREE.Mesh(cone(4.8, 3.5, 4).rotateY(Math.PI / 4), roofMat);
    rm.position.y = 14.8;
    g.add(wm, rm);
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
    this.group.add(g);
    this.colliders.addBox(x, y + 8, z, 3.4, 8, 3.4);
    this.exclusions.push({ x, z, r: 8 });
    this.flammables.push({
      kind: 'tower',
      x,
      y: y + 9,
      z,
      r: 6,
      h: 14,
      w: 6,
      d: 6,
      fuel: 22,
      onProgress: (t) => {
        charColor(woodMat, woodBase, smoothstep(0, 0.8, t));
        charColor(roofMat, roofBase, smoothstep(0, 0.5, t));
        rm.visible = t < 0.75;
      },
      onReset: () => {
        woodMat.color.copy(woodBase);
        roofMat.color.copy(roofBase);
        rm.visible = true;
      },
    });
    return new THREE.Vector3(x, y + 10.3, z);
  }

  _watchtowers() {
    // Hügel rund ums Dorf suchen (lokale Hochpunkte)
    const V = this.center;
    const found = [];
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      for (let r = 380; r <= 800; r += 60) {
        const x = V.x + Math.cos(a) * r;
        const z = V.z + Math.sin(a) * r;
        const h = this.ground(x, z);
        if (h < 30 || h > 170) continue;
        let isMax = true;
        for (let k = 0; k < 8 && isMax; k++) {
          const b = (k / 8) * Math.PI * 2;
          if (this.ground(x + Math.cos(b) * 40, z + Math.sin(b) * 40) > h) isMax = false;
        }
        if (isMax && found.every((f) => Math.hypot(f.x - x, f.z - z) > 500)) found.push({ x, z, h });
      }
    }
    found.sort((a, b) => b.h - a.h);
    this.poi.watchtowers = found.slice(0, 3).map((f) => this._watchtower(f.x, f.z));
  }

  // -------------------------------------------------- Fischerdorf am See
  _hamlet() {
    const L = PLACES.lake;
    const V = this.center;
    const dir = new THREE.Vector2(V.x - L.x, V.z - L.z).normalize();
    let sx = L.x;
    let sz = L.z;
    for (let s = 0; s < 800; s += 5) {
      sx = L.x + dir.x * s;
      sz = L.z + dir.y * s;
      if (this.ground(sx, sz) > 2.5) break;
    }
    const hx = sx + dir.x * 38;
    const hz = sz + dir.y * 38;
    this.poi.hamlet = new THREE.Vector3(hx, this.ground(hx, hz), hz);
    const facing = Math.atan2(-dir.x, -dir.y);
    const side = new THREE.Vector2(-dir.y, dir.x);
    const spots = [[-22, 8], [0, 0], [22, 6], [8, 26]];
    for (const [a, b] of spots) {
      const x = hx + side.x * a + dir.x * b;
      const z = hz + side.y * a + dir.y * b;
      this._hut(x, z, facing + (this.rnd() - 0.5) * 0.4, { w: 6.5, d: 8, wallH: 3.6, roofH: 3, tile: false });
    }
    // Steg
    const pierLen = 34;
    const px = sx - dir.x * (pierLen / 2 - 6);
    const pz = sz - dir.y * (pierLen / 2 - 6);
    const parts = [box(3, 0.35, pierLen, 4).translate(0, 1.3, 0)];
    for (let i = 0; i <= 5; i++) {
      for (const s of [-1.3, 1.3]) parts.push(box(0.35, 5, 0.35, 4).translate(s, -1.2, -pierLen / 2 + (i * pierLen) / 5));
    }
    const pier = new THREE.Mesh(mergeGeometries(parts), this.mats.wood);
    pier.position.set(px, 0, pz);
    pier.rotation.y = facing;
    pier.castShadow = pier.receiveShadow = true;
    this.group.add(pier);
    this.poi.pier = new THREE.Vector3(px - dir.x * pierLen * 0.5, 1.5, pz - dir.y * pierLen * 0.5);
    // Boote
    for (let i = 0; i < 3; i++) {
      const hull = new THREE.CylinderGeometry(1.1, 1.1, 5.5, 10, 1, true, Math.PI / 2, Math.PI);
      scaleUV(hull, (Math.PI * 1.1) / 4, 5.5 / 4); // UVs in Metern (4 m pro Einheit)
      hull.rotateX(-Math.PI / 2); // Rundung nach unten, Öffnung nach oben
      hull.scale(1, 0.7, 1);
      const bm = surfaceMaterial('holz', { side: THREE.DoubleSide, roughness: 0.9 }, { roughness: 1 });
      const boat = new THREE.Mesh(hull, bm);
      const off = -pierLen + 6 + i * 9;
      boat.position.set(px + dir.x * off + side.x * (i % 2 ? 4.5 : -4.5), 0.35, pz + dir.y * off + side.y * (i % 2 ? 4.5 : -4.5));
      boat.rotation.y = facing + (this.rnd() - 0.5) * 0.6;
      boat.castShadow = true;
      this.group.add(boat);
      const phase = this.rnd() * 6;
      this.animated.push((dt, wind, t) => {
        boat.position.y = 0.3 + Math.sin(t * 1.3 + phase) * 0.12;
        boat.rotation.z = Math.sin(t * 0.9 + phase) * 0.05;
      });
    }
  }

  // ------------------------------------------------------------ Leuchtturm
  _lighthouse(p) {
    const y = this.ground(p.x, p.z) - 0.5;
    const g = new THREE.Group();
    g.position.set(p.x, y, p.z);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const seg = tower(3.6 - i * 0.25, 3.85 - i * 0.25, 5, 14, 4);
      seg.translate(0, 2.5 + i * 5, 0);
      parts.push({ g: seg, red: i % 2 === 1 });
    }
    const white = new THREE.Mesh(mergeGeometries(parts.filter((q) => !q.red).map((q) => q.g)), this.mats.plaster);
    const red = new THREE.Mesh(mergeGeometries(parts.filter((q) => q.red).map((q) => q.g)), this.mats.red);
    const gallery = new THREE.Mesh(tower(3.4, 3.4, 0.6, 14), this.mats.darkWood);
    gallery.position.y = 25.3;
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0c0, emissiveIntensity: 0 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 10), lampMat);
    lamp.position.y = 27;
    const cap = new THREE.Mesh(cone(2.4, 2.5, 10), this.mats.red);
    cap.position.y = 29.5;
    g.add(white, red, gallery, lamp, cap);
    g.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));

    // Lichtstrahl (additiv, nur nachts sichtbar)
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: `varying float vT; void main(){ vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
      fragmentShader: `uniform float uI; varying float vT; void main(){ float a = pow(vT, 2.2) * uI * 0.35; gl_FragColor = vec4(vec3(1.0,0.92,0.7) * a * 3.0, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beams = new THREE.Group();
    beams.position.y = 27;
    for (const s of [0, Math.PI]) {
      const bg = new THREE.CylinderGeometry(1.2, 22, 220, 16, 1, true);
      bg.translate(0, -110, 0);
      bg.rotateX(Math.PI / 2);
      const b = new THREE.Mesh(bg, beamMat);
      b.rotation.y = s;
      b.rotation.x = -0.04;
      beams.add(b);
    }
    beams.traverse((o) => (o.frustumCulled = false));
    g.add(beams);
    this.group.add(g);
    this.lighthouse = { lampMat, beamMat, beams };
    this.animated.push((dt) => (beams.rotation.y += dt * 0.6));
    this.colliders.addBox(p.x, y + 15, p.z, 4, 15, 4);
    this.poi.lighthouse = new THREE.Vector3(p.x, y + 31, p.z);
    this.exclusions.push({ x: p.x, z: p.z, r: 12 });
  }

  // ------------------------------------------------------ Wege & Felder
  _paintSplat() {
    const t = this.terrain;
    const g = t.splatCtx;
    const pxPerM = t.splatSize / 5000;
    const V = this.center;
    const rnd = mulberry32(77);

    // Felder als gedrehte Streifen rund ums Dorf
    this.fields = [];
    g.save();
    for (let i = 0; i < 70 && this.fields.length < 38; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 250 + rnd() * 330;
      const x = V.x + Math.cos(a) * r;
      const z = V.z + Math.sin(a) * r;
      const len = 60 + rnd() * 70;
      const wid = 16 + rnd() * 14;
      const ang = a + Math.PI / 2 + (rnd() - 0.5) * 0.5;
      let ok = true;
      for (const [u, v] of [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) {
        const px = x + Math.cos(ang) * u * len - Math.sin(ang) * v * wid;
        const pz = z + Math.sin(ang) * u * len + Math.cos(ang) * v * wid;
        const h = this.ground(px, pz);
        if (h < 6 || h > 95) ok = false;
        if (distToPolyline(px, pz, PLACES.river) < 90) ok = false;
      }
      for (const e of this.exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r + len * 0.5) ok = false;
      if (!ok) continue;
      const wheat = rnd() < 0.55;
      this.fields.push({ x, z, len, wid, ang, wheat });
      const [sx, sz] = t.toSplat(x, z);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(sx, sz);
      g.rotate(ang);
      g.fillStyle = wheat ? 'rgb(0,255,0)' : 'rgb(0,0,255)';
      g.fillRect((-len / 2) * pxPerM, (-wid / 2) * pxPerM, len * pxPerM, wid * pxPerM);
      // Furchen (etwas Weg-Farbe dazwischen)
      g.fillStyle = 'rgba(90,0,0,1)';
      g.fillRect((-len / 2) * pxPerM, (-wid / 2) * pxPerM, len * pxPerM, 1);
    }
    g.restore();

    // Wege
    const road = (pts, width = 7, strength = 255) => {
      g.strokeStyle = `rgb(${strength},0,0)`;
      g.lineWidth = width * pxPerM;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      pts.forEach(([x, z], i) => {
        const [sx, sz] = t.toSplat(x, z);
        if (i === 0) g.moveTo(sx, sz);
        else g.lineTo(sx, sz);
      });
      g.stroke();
    };
    const curvy = (a, b, wiggle = 40, steps = 10) => {
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        const off = Math.sin(s * Math.PI) * Math.sin(s * 9 + a.x) * wiggle;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        pts.push([a.x + dx * s - (dz / len) * off, a.z + dz * s + (dx / len) * off]);
      }
      return pts;
    };
    const P = this.poi;
    road(curvy(V, P.gate, 8, 6), 8);
    road(curvy(V, P.church, 8, 6), 6);
    road(curvy(V, P.windmill, 20, 8), 5);
    if (P.hamlet) road(curvy(V, P.hamlet, 70, 18), 6);
    if (P.lighthouse) road(curvy(V, P.lighthouse, 90, 18), 5, 220);
    road(curvy(V, { x: V.x - 1100, z: V.z - 150 }, 60, 16), 5, 220);
    // kleiner, festgetretener Vorplatz vor jeder Tür
    for (const h of this.huts) {
      const fx = h.x + Math.sin(h.rot) * (h.d / 2 + 4);
      const fz = h.z + Math.cos(h.rot) * (h.d / 2 + 4);
      const [sx, sz] = t.toSplat(fx, fz);
      g.fillStyle = 'rgb(150,0,0)';
      g.beginPath();
      g.ellipse(sx, sz, 5 * pxPerM, 4 * pxPerM, -h.rot, 0, Math.PI * 2);
      g.fill();
    }
    // Ringweg ums Dorfzentrum
    const ring = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = 95 + Math.sin(a * 3) * 12;
      ring.push([V.x + Math.cos(a) * r, V.z + Math.sin(a) * r]);
    }
    road(ring, 5, 210);
    // Dorfplatz + Burghof
    g.fillStyle = 'rgb(255,0,0)';
    const [vx, vz] = t.toSplat(V.x, V.z);
    g.beginPath();
    g.arc(vx, vz, 22 * pxPerM, 0, Math.PI * 2);
    g.fill();
    const [cx, cz] = t.toSplat(P.castle.x, P.castle.z);
    g.fillStyle = 'rgb(200,0,0)';
    g.fillRect(cx - 38 * pxPerM, cz - 38 * pxPerM, 76 * pxPerM, 76 * pxPerM);
  }

  // Heuballen auf den Weizenfeldern (brennen schnell und hell)
  _hayBales() {
    const bales = [];
    const rnd = mulberry32(5);
    for (const f of this.fields) {
      if (!f.wheat) continue;
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const u = (rnd() - 0.5) * f.len * 0.8;
        const v = (rnd() - 0.5) * f.wid * 0.6;
        const x = f.x + Math.cos(f.ang) * u - Math.sin(f.ang) * v;
        const z = f.z + Math.sin(f.ang) * u + Math.cos(f.ang) * v;
        bales.push({ x, z, y: this.ground(x, z) + 1.0, r: rnd() * 6 });
      }
    }
    if (!bales.length) return;
    const geo = new THREE.CylinderGeometry(1.1, 1.1, 1.6, 12);
    scaleUV(geo, (Math.PI * 2.2) / 4, 1.6 / 4); // UVs in Metern (4 m pro Einheit)
    geo.rotateZ(Math.PI / 2);
    const mat = surfaceMaterial('stroh', { roughness: 1 }, { avgColor: 0xa08a5e, normalScale: 1.6 });
    const mesh = new THREE.InstancedMesh(geo, mat, bales.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    bales.forEach((b, i) => {
      q.setFromAxisAngle(up, b.r);
      m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, WHITE);
      const orig = m.clone();
      this.flammables.push({
        kind: 'hay',
        x: b.x,
        y: b.y,
        z: b.z,
        r: 2.5,
        h: 2,
        w: 2,
        d: 2,
        fuel: 7,
        onProgress: (t) => {
          mesh.setColorAt(i, _c.copy(WHITE).lerp(CHAR, t));
          mesh.instanceColor.needsUpdate = true;
          if (t > 0.9) {
            mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
            mesh.instanceMatrix.needsUpdate = true;
          }
        },
        onReset: () => {
          mesh.setColorAt(i, WHITE);
          mesh.setMatrixAt(i, orig);
          mesh.instanceColor.needsUpdate = true;
          mesh.instanceMatrix.needsUpdate = true;
        },
      });
    });
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  // ------------------------------------------------------------ Update
  update(dt, night, wind) {
    this.time.value += dt;
    this.mats.window.emissiveIntensity = night * 2.6;
    if (this.lighthouse) {
      this.lighthouse.lampMat.emissiveIntensity = night * 6;
      this.lighthouse.beamMat.uniforms.uI.value = clamp(night * 1.2, 0, 1);
      this.lighthouse.beams.visible = night > 0.02;
    }
    for (const fn of this.animated) fn(dt, wind, this.time.value);
  }
}
