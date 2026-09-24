// Das Drachen-Modell (nur Aussehen + Animation, KEINE Physik).
// Körper = eine "SkinnedMesh": eine Röhre vom Hals bis zur Schwanzspitze,
// die an unsichtbaren Knochen hängt. Drehen wir die Knochen, biegt sich der
// Körper mit (Hals schwingt, Schwanz peitscht).
// Vorne ist -z, oben ist +y, rechts ist +x.
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';
import { scaleBumpTexture } from '../fx/Textures.js';
import { taperedTube, bezierPoints } from './geo.js';
import { Wing } from './Wing.js';

export const MODEL_SCALE = 0.7; // ganzes Modell verkleinern (≈ 21 m lang, 26 m Spannweite)
export const STAND_HEIGHT = 2.3; // Höhe des Mittelpunkts über dem Boden im Stehen

// Querschnitte des Körpers: z-Position, Breite (rx), Höhe (ry), y-Versatz
const STATIONS = [
  [-9.6, 0.52, 0.58, 0.0],
  [-8.6, 0.6, 0.66, 0.0],
  [-7.2, 0.7, 0.78, 0.0],
  [-5.7, 0.85, 0.95, 0.0],
  [-4.4, 1.12, 1.22, -0.08],
  [-3.1, 1.5, 1.55, -0.18],
  [-1.6, 1.62, 1.68, -0.25],
  [0.0, 1.55, 1.6, -0.2],
  [1.5, 1.35, 1.4, -0.1],
  [3.0, 1.05, 1.1, 0.0],
  [4.5, 0.8, 0.82, 0.02],
  [6.5, 0.6, 0.6, 0.02],
  [8.5, 0.45, 0.45, 0.0],
  [10.5, 0.33, 0.33, 0.0],
  [12.5, 0.23, 0.22, 0.0],
  [14.5, 0.14, 0.13, 0.0],
  [16.4, 0.04, 0.04, 0.0],
];

// Knochen: Name, z-Position (Ruhelage), Eltern-Name
const BONES = [
  ['root', 0, null],
  ['chest', -3, 'root'],
  ['neck0', -4.5, 'chest'],
  ['neck1', -6, 'neck0'],
  ['neck2', -7.5, 'neck1'],
  ['neck3', -9, 'neck2'],
  ['head', -9.8, 'neck3'],
  ['hip', 3, 'root'],
  ['tail0', 5, 'hip'],
  ['tail1', 7, 'tail0'],
  ['tail2', 9, 'tail1'],
  ['tail3', 11, 'tail2'],
  ['tail4', 13, 'tail3'],
  ['tail5', 15, 'tail4'],
];
const NECK_REST = [0.34, 0.12, -0.13, -0.26];
const TAIL_REST = [0.07, -0.02, -0.02, -0.02, 0, 0];

export class Dragon {
  constructor({ ghost = false } = {}) {
    this.ghost = ghost;
    this.root = new THREE.Group(); // wird von der Physik bewegt
    this.model = new THREE.Group(); // für Wackeln/Anim.
    this.model.scale.setScalar(MODEL_SCALE);
    this.root.add(this.model);
    this.time = Math.random() * 10;

    this._createMaterials();
    this._createBody();
    this._createHead();
    this._createSpikes();
    this._createLegs();
    this._createWings();
    if (!ghost) this._createRider();

    // geglättete Animationswerte
    this.s = { fold: 0, amp: 0, legs: 0, jaw: 0, neckYaw: 0, neckPitch: 0, tailYaw: 0, tailPitch: 0, hover: 0, bank: 0 };

    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !ghost;
        o.receiveShadow = !ghost && o !== this.body;
        o.frustumCulled = false;
      }
    });
    this.body.receiveShadow = !ghost;
    this.update(0, { flapPhase: 0, flapAmp: 0, fold: 0 });
  }

  _createMaterials() {
    const bump = scaleBumpTexture();
    if (this.ghost) {
      const gm = new THREE.MeshBasicMaterial({
        color: 0x66ccff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.mats = { body: gm, skin: gm, belly: gm, membrane: gm, horn: gm, claw: gm, eye: gm, mouth: gm };
      return;
    }
    this.mats = {
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, bumpMap: bump, bumpScale: 2.5 }),
      skin: new THREE.MeshStandardMaterial({ color: 0x224a8a, roughness: 0.55, metalness: 0.15, bumpMap: bump, bumpScale: 2 }),
      belly: new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.6, metalness: 0.05 }),
      membrane: new THREE.MeshStandardMaterial({ color: 0x1b3560, roughness: 0.75, metalness: 0, side: THREE.DoubleSide }),
      horn: new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.45, metalness: 0.05 }),
      claw: new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.35, metalness: 0.2 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xffaa22, emissiveIntensity: 5 }),
      mouth: new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 3, 0.6), transparent: true, opacity: 0.9 }),
    };
  }

  // ------------------------------------------------------------ Körper
  _createBody() {
    // Knochen erzeugen
    this.bones = {};
    const list = [];
    for (const [name, z, parent] of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      const pz = parent ? BONES.find((x) => x[0] === parent)[1] : 0;
      b.position.set(0, 0, z - pz);
      if (parent) this.bones[parent].add(b);
      this.bones[name] = b;
      list.push(b);
    }
    // Knochenkette sortiert nach z (für die Gewichte)
    const chain = BONES.map(([name, z]) => ({ name, z, i: BONES.findIndex((x) => x[0] === name) })).sort((a, b) => a.z - b.z);

    const R = 16; // Punkte pro Ring
    const pos = [];
    const uv = [];
    const skinIndex = [];
    const skinWeight = [];
    this.bellyMask = [];
    let vlen = 0;
    for (let si = 0; si < STATIONS.length; si++) {
      const [z, rx, ry, y0] = STATIONS[si];
      if (si > 0) vlen += Math.abs(z - STATIONS[si - 1][0]);
      // Gewichte: zwischen welchen zwei Knochen liegt dieser Ring?
      let a = chain[0];
      let b = chain[0];
      let t = 0;
      if (z <= chain[0].z) {
        a = b = chain[0];
      } else if (z >= chain[chain.length - 1].z) {
        a = b = chain[chain.length - 1];
      } else {
        for (let k = 0; k < chain.length - 1; k++) {
          if (z >= chain[k].z && z <= chain[k + 1].z) {
            a = chain[k];
            b = chain[k + 1];
            t = (z - a.z) / (b.z - a.z);
            break;
          }
        }
      }
      for (let k = 0; k <= R; k++) {
        const phi = -Math.PI / 2 + (k / R) * Math.PI * 2; // Naht unten am Bauch
        const s = Math.sin(phi);
        const c = Math.cos(phi);
        let y = y0 + ry * s * (s < 0 ? 0.88 : 1);
        y += ry * 0.14 * Math.pow(Math.max(0, s), 10); // Rückenkamm
        pos.push(rx * c, y, z);
        uv.push((k / R) * 5, vlen / 1.6);
        skinIndex.push(a.i, b.i, 0, 0);
        skinWeight.push(1 - t, t, 0, 0);
        this.bellyMask.push(clamp((-s - 0.25) / 0.5, 0, 1));
      }
    }
    const idx = [];
    for (let si = 0; si < STATIONS.length - 1; si++) {
      for (let k = 0; k < R; k++) {
        const a = si * (R + 1) + k;
        const b = a + R + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 3).fill(1), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.bodyGeo = g;

    const mesh = new THREE.SkinnedMesh(g, this.mats.body);
    mesh.add(this.bones.root);
    this.model.add(mesh);
    mesh.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(list);
    mesh.bind(this.skeleton);
    this.body = mesh;
    // Ruhepose (Hals S-förmig nach oben)
    this._applyRest();
  }

  _applyRest() {
    for (let i = 0; i < 4; i++) this.bones['neck' + i].rotation.set(NECK_REST[i], 0, 0);
    for (let i = 0; i < 6; i++) this.bones['tail' + i].rotation.set(TAIL_REST[i], 0, 0);
  }

  // ------------------------------------------------------------ Kopf
  _createHead() {
    const m = this.mats;
    const head = new THREE.Group();
    this.bones.head.add(head);
    this.head = head;
    const add = (geo, mat, x = 0, y = 0, z = 0, parent = head) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const skull = add(new THREE.SphereGeometry(1, 18, 12), m.skin, 0, 0.22, -0.5);
    skull.scale.set(0.74, 0.6, 1.05);
    const snoutGeo = new THREE.CylinderGeometry(0.36, 0.56, 2.0, 12);
    snoutGeo.rotateX(-Math.PI / 2);
    const snout = add(snoutGeo, m.skin, 0, 0.12, -1.75);
    snout.scale.set(1.05, 0.7, 1);
    const tip = add(new THREE.SphereGeometry(0.38, 12, 8), m.skin, 0, 0.12, -2.7);
    tip.scale.set(1.05, 0.72, 0.9);
    // Kiefer (klappt beim Feuerspeien auf)
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.12, -0.35);
    head.add(this.jaw);
    const jawGeo = new THREE.CylinderGeometry(0.3, 0.46, 2.3, 10);
    jawGeo.rotateX(-Math.PI / 2);
    const jaw = add(jawGeo, m.belly, 0, -0.18, -1.2, this.jaw);
    jaw.scale.set(1, 0.5, 1);
    // Zähne
    const toothGeo = new THREE.ConeGeometry(0.06, 0.24, 4);
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) {
        const t = add(toothGeo, m.horn, s * (0.24 + i * 0.022), -0.1, -2.2 + i * 0.28, this.jaw);
        t.rotation.x = 0;
        const u = add(toothGeo, m.horn, s * (0.3 + i * 0.03), -0.08, -2.5 + i * 0.3);
        u.rotation.x = Math.PI;
      }
    }
    // Leuchtender Rachen beim Feuer
    this.mouthGlow = add(new THREE.SphereGeometry(0.32, 10, 8), m.mouth, 0, -0.1, -2.1);
    this.mouthGlow.visible = false;
    // Augen (leuchten → Bloom)
    for (const s of [-1, 1]) {
      add(new THREE.SphereGeometry(0.15, 10, 8), m.eye, s * 0.56, 0.45, -0.95);
      const brow = add(new THREE.BoxGeometry(0.34, 0.13, 0.7), m.skin, s * 0.47, 0.6, -0.8);
      brow.rotation.set(0.1, s * 0.25, s * -0.35);
      // Hörner
      const h1 = bezierPoints(
        new THREE.Vector3(s * 0.38, 0.55, -0.25),
        new THREE.Vector3(s * 0.8, 1.35, 0.8),
        new THREE.Vector3(s * 0.62, 1.15, 2.3),
        10
      );
      add(taperedTube(h1, h1.map((_, i) => 0.24 * (1 - i / 9) + 0.015), 8), m.horn);
      const h2 = bezierPoints(
        new THREE.Vector3(s * 0.62, 0.15, -0.15),
        new THREE.Vector3(s * 1.15, 0.35, 0.55),
        new THREE.Vector3(s * 1.28, 0.05, 1.35),
        8
      );
      add(taperedTube(h2, h2.map((_, i) => 0.13 * (1 - i / 7) + 0.01), 6), m.horn);
      // Wangen-Stacheln
      for (let i = 0; i < 3; i++) {
        const sp = add(new THREE.ConeGeometry(0.07, 0.5 - i * 0.1, 4), m.horn, s * (0.55 + i * 0.05), -0.2, -0.5 + i * 0.35);
        sp.rotation.set(Math.PI / 2 + 0.3, 0, s * -0.8);
      }
      // kleine Nackenfächer
      const fin = new THREE.BufferGeometry();
      fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s * 0.9, 0.5, 0.9, 0, 0.1, 1.2], 3));
      fin.computeVertexNormals();
      add(fin, m.membrane, s * 0.45, 0.3, 0.0);
    }
    // Markierungen für Maul (Feuer) und Nüstern (Rauch)
    this.mouth = new THREE.Object3D();
    this.mouth.position.set(0, -0.12, -3.0);
    head.add(this.mouth);
    this.nostril = new THREE.Object3D();
    this.nostril.position.set(0, 0.35, -2.8);
    head.add(this.nostril);
  }

  // ------------------------------------------------------------ Rückenstacheln
  _createSpikes() {
    const geo = new THREE.ConeGeometry(0.2, 1, 5);
    geo.translate(0, 0.5, 0);
    const boneList = BONES.map(([name, z]) => ({ name, z }));
    for (let z = -8.8; z < 15.8; z += 1.05) {
      if (z > -5.2 && z < -1.9) continue; // Platz für Sattel und Reiter
      // Radius an dieser Stelle interpolieren
      let k = 0;
      while (k < STATIONS.length - 2 && STATIONS[k + 1][0] < z) k++;
      const a = STATIONS[k];
      const b = STATIONS[k + 1];
      const t = clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
      const ry = lerp(a[2], b[2], t);
      const y0 = lerp(a[3], b[3], t);
      let best = boneList[0];
      for (const bn of boneList) if (Math.abs(bn.z - z) < Math.abs(best.z - z)) best = bn;
      if (best.name === 'head') best = boneList.find((x) => x.name === 'neck3');
      const size = 0.35 + ry * 0.55;
      const sp = new THREE.Mesh(geo, this.mats.horn);
      if (best.name.startsWith('neck') || z < -1.9) (this.neckSpikes || (this.neckSpikes = [])).push(sp);
      sp.scale.set(size * 0.9, size, size * 0.9);
      sp.position.set(0, y0 + ry * 1.08, z - best.z);
      sp.rotation.x = 0.55; // nach hinten geneigt
      this.bones[best.name].add(sp);
    }
    // Schwanz-Spitze: Spaten-Form
    const fin = new THREE.BufferGeometry();
    fin.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1.0, 0, 1.0, 0, 0, 2.8, 0, 0, 0, 0, 0, 2.8, -1.0, 0, 1.0], 3)
    );
    fin.computeVertexNormals();
    const fm = new THREE.Mesh(fin, this.mats.membrane);
    fm.position.set(0, 0, 0.6);
    this.bones.tail5.add(fm);
  }

  // ------------------------------------------------------------ Beine
  _createLegs() {
    const m = this.mats;
    const limb = (parent, x, y, z, upper, lower, r1, r2, r3) => {
      const hip = new THREE.Group();
      hip.position.set(x, y, z);
      parent.add(hip);
      const up = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -upper * 0.5, upper * 0.12), new THREE.Vector3(0, -upper, upper * 0.3)];
      hip.add(new THREE.Mesh(taperedTube(up, [r1, r1 * 0.85, r2], 8), m.skin));
      const knee = new THREE.Group();
      knee.position.set(0, -upper, upper * 0.3);
      hip.add(knee);
      const lo = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -lower, -lower * 0.25)];
      knee.add(new THREE.Mesh(taperedTube(lo, [r2, r3], 8), m.skin));
      const foot = new THREE.Group();
      foot.position.set(0, -lower, -lower * 0.25);
      knee.add(foot);
      const clawGeo = new THREE.ConeGeometry(0.1, 0.55, 5);
      clawGeo.rotateX(-Math.PI / 2 - 0.3);
      for (let i = -1; i <= 1; i++) {
        const c = new THREE.Mesh(clawGeo, m.claw);
        c.position.set(i * 0.16, -0.05, -0.3);
        c.rotation.y = i * 0.2;
        foot.add(c);
      }
      return { hip, knee };
    };
    this.legs = {
      hindL: limb(this.bones.hip, -1.0, -0.45, 0.1, 1.5, 1.4, 0.55, 0.34, 0.2),
      hindR: limb(this.bones.hip, 1.0, -0.45, 0.1, 1.5, 1.4, 0.55, 0.34, 0.2),
      frontL: limb(this.bones.chest, -0.85, -0.95, -0.4, 1.1, 1.0, 0.36, 0.25, 0.16),
      frontR: limb(this.bones.chest, 0.85, -0.95, -0.4, 1.1, 1.0, 0.36, 0.25, 0.16),
    };
  }

  // ------------------------------------------------------------ Flügel
  _createWings() {
    this.wingR = new Wing(this.mats.membrane, this.mats.skin, this.mats.claw);
    this.wingL = new Wing(this.mats.membrane, this.mats.skin, this.mats.claw);
    this.wingR.group.position.set(1.2, 0.85, 0.2);
    this.wingL.group.position.set(-1.2, 0.85, 0.2);
    this.wingL.group.scale.x = -1; // gespiegelt
    this.bones.chest.add(this.wingR.group, this.wingL.group);
  }

  // ------------------------------------------------------------ Reiter
  _createRider() {
    const r = new THREE.Group();
    // Der Reiter wird in echten Metern gebaut → Modell-Skalierung ausgleichen
    r.scale.setScalar(1 / MODEL_SCALE);
    r.position.set(0, 1.6, -0.9);
    this.bones.chest.add(r);
    this.rider = r;
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
    const skinM = new THREE.MeshStandardMaterial({ color: 0xd9a582, roughness: 0.7 });
    const capeM = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.85, side: THREE.DoubleSide });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = r) => {
      const mm = new THREE.Mesh(geo, mat);
      mm.position.set(x, y, z);
      mm.rotation.set(rx, ry, rz);
      parent.add(mm);
      return mm;
    };
    add(new THREE.BoxGeometry(0.8, 0.22, 1.1), leather, 0, 0, 0);
    add(new THREE.BoxGeometry(0.1, 0.25, 0.1), leather, 0, 0.2, -0.45);
    // Beine (rittlings)
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.16, 0.5, 0.18), cloth, s * 0.33, 0.02, 0.05, -0.4, 0, s * 0.75);
      add(new THREE.BoxGeometry(0.14, 0.5, 0.16), leather, s * 0.5, -0.3, -0.12, 0.3, 0, s * 0.2);
    }
    const torso = new THREE.Group();
    torso.position.set(0, 0.2, 0.05);
    torso.rotation.x = -0.25;
    r.add(torso);
    add(new THREE.BoxGeometry(0.44, 0.6, 0.26), steel, 0, 0.32, 0, 0, 0, 0, torso);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.3), leather, 0, 0.05, 0, 0, 0, 0, torso);
    // Arme halten die Zügel
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12, 0.45, 0.12), steel, s * 0.28, 0.42, -0.15, -1.0, 0, s * 0.15, torso);
      add(new THREE.BoxGeometry(0.1, 0.1, 0.1), leather, s * 0.2, 0.25, -0.45, 0, 0, 0, torso);
    }
    const head = new THREE.Group();
    head.position.set(0, 0.78, 0);
    torso.add(head);
    this.riderHead = head;
    add(new THREE.SphereGeometry(0.12, 10, 8), skinM, 0, 0, -0.01, 0, 0, 0, head);
    const helm = add(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), steel, 0, 0.02, 0, 0, 0, 0, head);
    helm.scale.y = 1.1;
    add(new THREE.BoxGeometry(0.03, 0.14, 0.04), steel, 0, -0.03, -0.14, 0, 0, 0, head);
    add(new THREE.ConeGeometry(0.03, 0.25, 5), capeM, 0, 0.2, 0.05, -0.5, 0, 0, head);
    // Umhang (weht im Wind)
    const capeGeo = new THREE.PlaneGeometry(0.62, 1.3, 4, 10);
    capeGeo.translate(0, -0.65, 0);
    this.cape = add(capeGeo, capeM, 0, 0.62, 0.16, 0, 0, 0, torso);
    this.capeBase = capeGeo.getAttribute('position').array.slice();
  }

  // ------------------------------------------------------------ Aussehen ändern
  setSkin(skin) {
    if (this.ghost) return;
    const body = new THREE.Color(skin.body);
    const belly = new THREE.Color(skin.belly);
    this.mats.skin.color.copy(body);
    this.mats.belly.color.copy(belly);
    this.mats.membrane.color.set(skin.membrane);
    this.mats.skin.metalness = this.mats.body.metalness = skin.metal ?? 0.15;
    this.mats.skin.roughness = this.mats.body.roughness = skin.rough ?? 0.55;
    this.mats.horn.color.set(skin.horn ?? 0xd9ccb0);
    this.mats.eye.emissive.set(skin.eye ?? 0xffaa22);
    const col = this.bodyGeo.getAttribute('color');
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      c.copy(body).lerp(belly, this.bellyMask[i]);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  setFireColor(color) {
    if (this.ghost) return;
    this.mats.mouth.color.copy(color).multiplyScalar(6);
  }

  setRider(visible) {
    if (this.rider) this.rider.visible = visible;
  }

  setRiderHeadVisible(v) {
    if (this.riderHead) this.riderHead.visible = v;
    // In der Reiter-Sicht würden die Halsstacheln die Sicht versperren
    for (const s of this.neckSpikes || []) s.visible = v;
  }

  // ------------------------------------------------------------ Positionen für andere Systeme
  getMouth(outPos, outDir) {
    this.mouth.getWorldPosition(outPos);
    if (outDir) {
      // Richtung, in die der Kopf schaut (-z des Kopfes)
      const q = this.head.getWorldQuaternion(this._q || (this._q = new THREE.Quaternion()));
      outDir.set(0, -0.18, -1).applyQuaternion(q).normalize();
    }
    return outPos;
  }

  getNostril(out) {
    return this.nostril.getWorldPosition(out);
  }

  getRiderEye(out) {
    if (!this.riderHead) return this.root.getWorldPosition(out);
    return this.riderHead.localToWorld(out.set(0, 0.05, -0.1));
  }

  // ------------------------------------------------------------ Animation
  /**
   * a = Animations-Zustand aus der Physik:
   *  flapPhase 0..1, flapAmp 0..1, fold 0..1, bank, pitchRate, yawRate,
   *  roll (Eingabe), speed, hover 0..1, grounded 0..1, walk, fire 0..1, roar 0..1
   */
  update(dt, a) {
    this.time += dt;
    const s = this.s;
    const t = this.time;
    s.fold = damp(s.fold, a.fold || 0, 6, dt);
    s.amp = damp(s.amp, a.flapAmp || 0, 5, dt);
    s.hover = damp(s.hover, a.hover || 0, 3, dt);
    s.legs = damp(s.legs, Math.max(a.grounded || 0, (a.hover || 0) * 0.5), 3, dt);
    s.jaw = damp(s.jaw, Math.max(a.fire || 0, a.roar || 0), 10, dt);
    s.bank = damp(s.bank, a.bank || 0, 4, dt);
    const yawRate = a.yawRate || 0;
    const pitchRate = a.pitchRate || 0;
    s.neckYaw = damp(s.neckYaw, clamp(-yawRate * 0.35, -0.5, 0.5), 3, dt);
    s.neckPitch = damp(s.neckPitch, clamp(-pitchRate * 0.12, -0.25, 0.25), 3, dt);
    s.tailYaw = damp(s.tailYaw, clamp(yawRate * 0.25, -0.35, 0.35), 2.5, dt);
    s.tailPitch = damp(s.tailPitch, clamp(pitchRate * 0.08, -0.2, 0.2) + s.hover * 0.12, 2.5, dt);

    // --- Flügel ---
    const ph = (a.flapPhase || 0) * Math.PI * 2;
    const amp = s.amp;
    const glide = 1 - amp;
    const breathe = Math.sin(t * 1.3) * 0.03;
    const upFold = amp * Math.max(0, -Math.sin(ph)) * 0.4; // beim Hochschlag Flügel etwas anwinkeln
    const fold = clamp(s.fold + upFold + (a.grounded || 0) * 0.9, 0, 1);
    const roll = a.roll || 0;
    const base1 = 0.1 * glide + breathe + s.fold * 0.35;
    for (const side of [1, -1]) {
      const w = side === 1 ? this.wingR : this.wingL;
      // Kurveninnenseite etwas tiefer, Aussenseite höher
      const asym = -roll * side * 0.12 - s.bank * side * 0.04;
      w.pose({
        fold: clamp(fold + (side * roll > 0 ? Math.abs(roll) * 0.08 : 0), 0, 1),
        t1: base1 + amp * (Math.cos(ph) * 0.78 + 0.08) + asym,
        t2: amp * Math.cos(ph - 0.9) * 0.38 - glide * 0.04,
        t3: amp * Math.cos(ph - 1.7) * 0.32 + glide * 0.05,
        sweep: s.fold * 0.2 + (a.boost ? 0.05 : 0),
      });
    }

    // --- Körper-Wippen (nur optisch) ---
    this.model.position.y = -amp * Math.sin(ph) * 0.35 * MODEL_SCALE;

    // --- Hals: gleicht das Wippen aus, schaut in die Kurve ---
    const neckBob = amp * Math.sin(ph) * 0.05;
    for (let i = 0; i < 4; i++) {
      const b = this.bones['neck' + i];
      b.rotation.x = NECK_REST[i] + neckBob * (i < 2 ? 1 : -1) + s.neckPitch * 0.25 + s.hover * (i === 0 ? 0.15 : -0.05) + Math.sin(t * 0.9 + i) * 0.015;
      b.rotation.y = s.neckYaw * 0.25 + Math.sin(t * 0.6 + i * 0.5) * 0.02;
    }
    this.bones.head.rotation.x = -neckBob * 0.5 - s.jaw * 0.15;
    this.jaw.rotation.x = -s.jaw * 0.55 - 0.03 - Math.max(0, Math.sin(t * 0.4)) * 0.02;
    if (this.mouthGlow) this.mouthGlow.visible = (a.fire || 0) > 0.05;

    // --- Schwanz: Welle + folgt den Kurven ---
    const speedK = clamp((a.speed || 0) / 60, 0, 1);
    for (let i = 0; i < 6; i++) {
      const b = this.bones['tail' + i];
      const wave = Math.sin(t * (2.2 - speedK) - i * 0.7) * (0.06 + (1 - speedK) * 0.05);
      b.rotation.y = wave + s.tailYaw * (0.4 + i * 0.12);
      b.rotation.x = TAIL_REST[i] + Math.sin(t * 1.4 - i * 0.6) * 0.025 + s.tailPitch * 0.3 + amp * Math.sin(ph - i * 0.5) * 0.03;
    }

    // --- Beine: im Flug angezogen, am Boden ausgestreckt ---
    const L = s.legs;
    const walk = a.walk || 0;
    const wph = t * 5;
    for (const [key, leg] of Object.entries(this.legs)) {
      const front = key.startsWith('front');
      const side = key.endsWith('L') ? 1 : -1;
      const step = walk * Math.sin(wph + (front ? 0 : Math.PI) + (side > 0 ? 0 : Math.PI)) * 0.45;
      if (front) {
        leg.hip.rotation.x = lerp(-1.0, 0.05, L) + step;
        leg.knee.rotation.x = lerp(1.7, -0.1, L) - Math.max(0, step) * 0.5;
      } else {
        leg.hip.rotation.x = lerp(-1.25, 0.1, L) + step;
        leg.knee.rotation.x = lerp(1.1, -0.15, L) + Math.max(0, -step) * 0.4;
      }
    }

    // --- Umhang des Reiters flattert ---
    if (this.cape && this.cape.visible) {
      const p = this.cape.geometry.getAttribute('position');
      const base = this.capeBase;
      const flutter = 0.3 + speedK * 1.2;
      for (let i = 0; i < p.count; i++) {
        const y = base[i * 3 + 1];
        const x = base[i * 3];
        const k = -y; // 0 oben … 1.3 unten
        const lift = k * (0.35 + speedK * 0.6);
        p.setXYZ(
          i,
          x,
          y + lift * 0.55,
          base[i * 3 + 2] + lift * 0.9 + Math.sin(t * 9 * flutter + k * 4 + x * 3) * 0.06 * k * flutter
        );
      }
      p.needsUpdate = true;
      this.cape.geometry.computeVertexNormals();
    }
  }
}
