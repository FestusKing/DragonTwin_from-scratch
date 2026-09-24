// Das Drachen-Modell (nur Aussehen + Animation, KEINE Physik).
// Körper = eine "SkinnedMesh": eine Röhre vom Hals bis zur Schwanzspitze,
// die an unsichtbaren Knochen hängt. Drehen wir die Knochen, biegt sich der
// Körper mit (Hals schwingt, Schwanz peitscht).
// Vorne ist -z, oben ist +y, rechts ist +x.
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';
import { dragonSkinNormalTexture, membraneTexture } from '../fx/Textures.js';
import { Noise2D } from '../core/noise.js';
import { taperedTube, bezierPoints, mergeParts } from './geo.js';
import { Wing } from './Wing.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export const MODEL_SCALE = 0.7; // ganzes Modell verkleinern (≈ 21 m lang, 26 m Spannweite)
export const STAND_HEIGHT = 2.3; // Höhe des Mittelpunkts über dem Boden im Stehen

// Querschnitte des Körpers: z-Position, Breite (rx), Höhe (ry), y-Versatz.
// Vorbild: Wyvern aus DragonTwin – langer, schlanker Hals, tiefe Brust
// ("Kiel" wie bei Vögeln, dort sitzen die Flugmuskeln), langer Schwanz.
const STATIONS = [
  [-10.3, 0.36, 0.46, 0.05],
  [-9.3, 0.39, 0.5, 0.03],
  [-8.1, 0.43, 0.56, 0.0],
  [-6.9, 0.5, 0.65, 0.0],
  [-5.7, 0.64, 0.82, -0.02],
  [-4.6, 0.98, 1.18, -0.1],
  [-3.5, 1.32, 1.55, -0.26],
  [-2.3, 1.46, 1.7, -0.36],
  [-1.1, 1.42, 1.62, -0.32],
  [0.1, 1.3, 1.45, -0.22],
  [1.3, 1.15, 1.28, -0.1],
  [2.5, 0.98, 1.08, 0.0],
  [3.7, 0.76, 0.84, 0.02],
  [5.1, 0.58, 0.66, 0.02],
  [6.7, 0.46, 0.52, 0.02],
  [8.3, 0.37, 0.42, 0.0],
  [9.9, 0.29, 0.33, 0.0],
  [11.5, 0.22, 0.26, 0.0],
  [13.1, 0.17, 0.2, 0.0],
  [14.7, 0.12, 0.14, 0.0],
  [16.3, 0.08, 0.09, 0.0],
  [17.9, 0.03, 0.035, 0.0],
];

// Knochen: Name, z-Position (Ruhelage), Eltern-Name
const BONES = [
  ['root', 0, null],
  ['chest', -3, 'root'],
  ['neck0', -4.6, 'chest'],
  ['neck1', -6.1, 'neck0'],
  ['neck2', -7.6, 'neck1'],
  ['neck3', -9.1, 'neck2'],
  ['head', -10.0, 'neck3'],
  ['hip', 3, 'root'],
  ['tail0', 5, 'hip'],
  ['tail1', 7, 'tail0'],
  ['tail2', 9, 'tail1'],
  ['tail3', 11, 'tail2'],
  ['tail4', 13, 'tail3'],
  ['tail5', 15, 'tail4'],
  ['tail6', 17, 'tail5'],
];
const TAILS = 7;
const NECK_REST = [0.36, 0.14, -0.12, -0.3];
const TAIL_REST = [0.07, -0.02, -0.02, -0.02, 0, 0, 0];

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
    if (this.ghost) {
      const gm = new THREE.MeshBasicMaterial({
        color: 0x7fd8ff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.mats = { body: gm, skin: gm, belly: gm, membrane: gm, horn: gm, claw: gm, eye: gm, mouth: gm };
      return;
    }
    // Raue, ledrige Haut: Normal-Map statt glattem "Plastik"
    const skinN = dragonSkinNormalTexture();
    const ns = new THREE.Vector2(1.7, 1.7);
    this.mats = {
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, normalMap: skinN, normalScale: ns }),
      skin: new THREE.MeshStandardMaterial({ color: 0x6b635a, roughness: 0.65, metalness: 0, normalMap: skinN, normalScale: ns }),
      belly: new THREE.MeshStandardMaterial({ color: 0x9a8e7e, roughness: 0.85, metalness: 0, normalMap: skinN, normalScale: new THREE.Vector2(0.6, 0.6) }),
      // Flughaut mit Adern; leichtes Eigenleuchten = Licht scheint durch die dünne Haut
      membrane: new THREE.MeshStandardMaterial({ color: 0x5a4a40, map: membraneTexture(), emissive: 0x5a4a40, emissiveIntensity: 0.18, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
      horn: new THREE.MeshStandardMaterial({ color: 0xb8ab92, roughness: 0.55, metalness: 0 }),
      claw: new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.4, metalness: 0.1 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xff9a22, emissiveIntensity: 2.2 }),
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

    const R = 24; // Punkte pro Ring
    const noise = new Noise2D(404);
    this.shade = [];
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
        let y = y0 + ry * s * (s < 0 ? 0.86 : 1);
        y += ry * 0.2 * Math.pow(Math.max(0, s), 8); // Rückenkante
        // Brust: Kiel nach unten (Flugmuskeln)
        if (z > -4 && z < 1) y -= ry * 0.12 * Math.pow(Math.max(0, -s), 6);
        pos.push(rx * c, y, z);
        uv.push((k / R) * 4, vlen / 1.4);
        // Flecken und dunklerer Rücken für eine natürliche, "gebrauchte" Haut
        const mott = noise.fbm(z * 0.45, phi * 1.3, 3) * 0.5 + noise.noise(z * 2.2, phi * 4) * 0.12;
        this.shade.push(0.86 + mott * 0.55 - Math.max(0, s) * 0.3);
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
    for (let i = 0; i < TAILS; i++) this.bones['tail' + i].rotation.set(TAIL_REST[i], 0, 0);
  }

  // ------------------------------------------------------------ Kopf
  // Langer, kantiger Kopf mit einer Krone aus nach hinten gebogenen Hörnern.
  // Alle festen Teile werden pro Material zu EINEM Mesh verschmolzen.
  _createHead() {
    const m = this.mats;
    const head = new THREE.Group();
    head.scale.setScalar(1.22); // kräftiger Kopf im Verhältnis zum Hals
    this.bones.head.add(head);
    this.head = head;
    const mesh = (parts, mat, parent = head) => {
      const me = new THREE.Mesh(mergeParts(parts), mat);
      parent.add(me);
      return me;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const horn = (p0, p1, p2, r, seg = 10) => {
      const pts = bezierPoints(p0, p1, p2, seg);
      return { geo: taperedTube(pts, pts.map((_, i) => r * Math.pow(1 - i / (seg - 1), 1.2) + 0.012), 8) };
    };
    // Schädel + lange Schnauze
    const snout = new THREE.CylinderGeometry(0.28, 0.46, 2.7, 14).rotateX(-Math.PI / 2);
    const skinParts = [
      { geo: new THREE.SphereGeometry(1, 20, 14), p: [0, 0.2, -0.35], s: [0.6, 0.5, 0.95] },
      { geo: snout, p: [0, 0.08, -2.0], s: [0.95, 0.6, 1] },
      { geo: new THREE.SphereGeometry(0.3, 12, 8), p: [0, 0.06, -3.35], s: [0.95, 0.6, 0.9] },
      // Nasenrücken (Grat)
      { geo: new THREE.BoxGeometry(0.16, 0.12, 2.4), p: [0, 0.34, -1.9], r: [0.1, 0, 0] },
    ];
    const hornParts = [];
    const eyeParts = [];
    const toothGeo = new THREE.ConeGeometry(0.045, 0.22, 4);
    for (let i = 0; i < 9; i++) {
      for (const sd of [-1, 1]) hornParts.push({ geo: toothGeo, p: [sd * (0.24 + i * 0.02), -0.1, -3.2 + i * 0.3], r: [Math.PI, 0, 0] });
    }
    for (const sd of [-1, 1]) {
      // tief liegende Augen unter kräftigen Brauenwülsten
      eyeParts.push({ geo: new THREE.SphereGeometry(0.1, 10, 8), p: [sd * 0.46, 0.36, -0.95] });
      skinParts.push({ geo: new THREE.BoxGeometry(0.3, 0.16, 0.9), p: [sd * 0.42, 0.52, -0.85], r: [0.12, sd * 0.2, sd * -0.3] });
      // Wangenplatten
      skinParts.push({ geo: new THREE.SphereGeometry(1, 10, 8), p: [sd * 0.42, 0.0, -0.75], s: [0.22, 0.32, 0.6] });
      // Hornkrone: 2 grosse, 2 mittlere, mehrere kleine Hörner nach hinten
      hornParts.push(horn(V(sd * 0.28, 0.5, -0.25), V(sd * 0.5, 1.05, 0.9), V(sd * 0.42, 0.85, 2.7), 0.2, 12));
      hornParts.push(horn(V(sd * 0.48, 0.3, -0.1), V(sd * 0.95, 0.5, 0.8), V(sd * 1.1, 0.25, 1.9), 0.13));
      hornParts.push(horn(V(sd * 0.52, 0.05, 0.05), V(sd * 0.95, -0.05, 0.6), V(sd * 1.05, -0.3, 1.25), 0.09, 8));
      for (let i = 0; i < 4; i++) {
        hornParts.push({ geo: new THREE.ConeGeometry(0.06 - i * 0.008, 0.45 - i * 0.06, 5), p: [sd * (0.18 + i * 0.05), 0.55 - i * 0.06, 0.25 + i * 0.28], r: [-1.2, 0, sd * -0.35] });
      }
      // Stacheln am Unterkiefer-Rand
      for (let i = 0; i < 4; i++) {
        hornParts.push({ geo: new THREE.ConeGeometry(0.05, 0.4 - i * 0.06, 4), p: [sd * (0.44 + i * 0.02), -0.25, -0.2 + i * 0.3], r: [Math.PI / 2 + 0.5, 0, sd * -0.9] });
      }
    }
    // kleines Nasenhorn
    hornParts.push({ geo: new THREE.ConeGeometry(0.07, 0.35, 5), p: [0, 0.4, -2.9], r: [-0.5, 0, 0] });
    mesh(skinParts, m.skin);
    mesh(hornParts, m.horn);
    mesh(eyeParts, m.eye);
    // Unterkiefer (klappt beim Feuerspeien auf)
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.12, -0.3);
    head.add(this.jaw);
    const jawGeo = new THREE.CylinderGeometry(0.22, 0.4, 3.0, 12).rotateX(-Math.PI / 2);
    mesh([{ geo: jawGeo, p: [0, -0.16, -1.55], s: [0.92, 0.45, 1] }], m.belly, this.jaw);
    const lower = [];
    for (let i = 0; i < 9; i++) for (const sd of [-1, 1]) lower.push({ geo: toothGeo, p: [sd * (0.2 + i * 0.018), -0.08, -2.9 + i * 0.3] });
    lower.push({ geo: new THREE.ConeGeometry(0.06, 0.3, 4), p: [0, -0.3, -2.2], r: [Math.PI + 0.6, 0, 0] });
    mesh(lower, m.horn, this.jaw);
    // Leuchtender Rachen beim Feuer
    this.mouthGlow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), m.mouth);
    this.mouthGlow.position.set(0, -0.1, -2.6);
    this.mouthGlow.visible = false;
    head.add(this.mouthGlow);
    // Markierungen für Maul (Feuer) und Nüstern (Rauch)
    this.mouth = new THREE.Object3D();
    this.mouth.position.set(0, -0.12, -3.6);
    head.add(this.mouth);
    this.nostril = new THREE.Object3D();
    this.nostril.position.set(0, 0.28, -3.35);
    head.add(this.nostril);
  }

  // ------------------------------------------------------------ Rückenstacheln
  _createSpikes() {
    const geo = new THREE.ConeGeometry(0.16, 1, 5);
    geo.translate(0, 0.5, 0);
    const boneList = BONES.map(([name, z]) => ({ name, z }));
    const perBone = new Map(); // Stacheln pro Knochen sammeln → 1 Mesh pro Knochen
    for (let z = -9.6; z < 17.2; z += 0.72) {
      if (z > -5.3 && z < -1.8) continue; // Platz für Sattel und Reiter
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
      // Stacheln: am Rücken grösser, am Hals und Schwanz kleiner
      const size = 0.22 + ry * 0.4;
      if (!perBone.has(best.name)) perBone.set(best.name, []);
      perBone.get(best.name).push({ geo, p: [0, y0 + ry * 1.12, z - best.z], r: [0.75, 0, 0], s: [size * 0.8, size, size * 0.8] });
    }
    // Stachelbüschel an der Schwanzspitze
    const tip = [];
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      tip.push({ geo, p: [Math.cos(ang) * 0.06, Math.sin(ang) * 0.06, 0.6 + i * 0.12], r: [Math.PI / 2 - 0.5 * Math.sin(ang), 0, -0.5 * Math.cos(ang)], s: [0.35, 0.9 - i * 0.08, 0.35] });
    }
    perBone.set('tail6', [...(perBone.get('tail6') || []), ...tip]);
    this.neckSpikes = [];
    for (const [name, parts] of perBone) {
      const sp = new THREE.Mesh(mergeParts(parts), this.mats.horn);
      this.bones[name].add(sp);
      if (name.startsWith('neck') || name === 'chest') this.neckSpikes.push(sp);
    }
  }

  // ------------------------------------------------------------ Beine
  // Wyvern: nur zwei kräftige Hinterbeine. Die Flügel sind die "Arme".
  _createLegs() {
    const m = this.mats;
    const clawGeo = new THREE.ConeGeometry(0.1, 0.7, 5).rotateX(-Math.PI / 2 - 0.35);
    const footParts = [-1, 0, 1].map((i) => ({ geo: clawGeo, p: [i * 0.2, -0.05, -0.45], r: [0, i * 0.25, 0] }));
    footParts.push({ geo: clawGeo, p: [0, -0.05, 0.25], r: [0, Math.PI, 0], s: 0.7 }); // Afterkralle hinten
    const clawsGeo = mergeParts(footParts);
    const limb = (parent, x, y, z) => {
      const hip = new THREE.Group();
      hip.position.set(x, y, z);
      parent.add(hip);
      // Oberschenkel: muskulös
      const up = [V3(0, 0, 0), V3(0, -0.9, 0.25), V3(0, -1.8, 0.5)];
      hip.add(new THREE.Mesh(taperedTube(up, [0.78, 0.62, 0.36], 10), m.skin));
      const knee = new THREE.Group();
      knee.position.set(0, -1.8, 0.5);
      hip.add(knee);
      const lo = [V3(0, 0, 0), V3(0, -0.8, -0.35), V3(0, -1.5, -0.55)];
      knee.add(new THREE.Mesh(taperedTube(lo, [0.34, 0.26, 0.2], 8), m.skin));
      const foot = new THREE.Group();
      foot.position.set(0, -1.5, -0.55);
      knee.add(foot);
      const toe = [V3(0, 0, 0), V3(0, -0.2, -0.6)];
      foot.add(new THREE.Mesh(taperedTube(toe, [0.2, 0.14], 8), m.skin));
      const claws = new THREE.Mesh(clawsGeo, m.claw);
      claws.position.set(0, -0.2, -0.55);
      foot.add(claws);
      return { hip, knee, foot };
    };
    this.legs = {
      hindL: limb(this.bones.hip, -1.0, -0.4, -0.3),
      hindR: limb(this.bones.hip, 1.0, -0.4, -0.3),
    };
  }

  // ------------------------------------------------------------ Flügel
  _createWings() {
    this.wingR = new Wing(this.mats.membrane, this.mats.skin, this.mats.claw);
    this.wingL = new Wing(this.mats.membrane, this.mats.skin, this.mats.claw);
    this.wingR.group.position.set(1.05, 0.95, 0.1);
    this.wingL.group.position.set(-1.05, 0.95, 0.1);
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
    const add = (parts, mat, parent) => {
      const me = new THREE.Mesh(mergeParts(parts), mat);
      parent.add(me);
      return me;
    };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // Sattel + Beine (rittlings)
    const leatherBase = [{ geo: B(0.8, 0.22, 1.1) }, { geo: B(0.1, 0.25, 0.1), p: [0, 0.2, -0.45] }];
    const clothBase = [];
    for (const sd of [-1, 1]) {
      clothBase.push({ geo: B(0.16, 0.5, 0.18), p: [sd * 0.33, 0.02, 0.05], r: [-0.4, 0, sd * 0.75] });
      leatherBase.push({ geo: B(0.14, 0.5, 0.16), p: [sd * 0.5, -0.3, -0.12], r: [0.3, 0, sd * 0.2] });
    }
    add(leatherBase, leather, r);
    add(clothBase, cloth, r);
    const torso = new THREE.Group();
    torso.position.set(0, 0.2, 0.05);
    torso.rotation.x = -0.25;
    r.add(torso);
    // Rüstung + Arme halten die Zügel
    const steelParts = [{ geo: B(0.44, 0.6, 0.26), p: [0, 0.32, 0] }];
    const leatherParts = [{ geo: B(0.5, 0.12, 0.3), p: [0, 0.05, 0] }];
    for (const sd of [-1, 1]) {
      steelParts.push({ geo: B(0.12, 0.45, 0.12), p: [sd * 0.28, 0.42, -0.15], r: [-1.0, 0, sd * 0.15] });
      leatherParts.push({ geo: B(0.1, 0.1, 0.1), p: [sd * 0.2, 0.25, -0.45] });
    }
    add(steelParts, steel, torso);
    add(leatherParts, leather, torso);
    const head = new THREE.Group();
    head.position.set(0, 0.78, 0);
    torso.add(head);
    this.riderHead = head;
    add([{ geo: new THREE.SphereGeometry(0.12, 10, 8), p: [0, 0, -0.01] }], skinM, head);
    add([
      { geo: new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), p: [0, 0.02, 0], s: [1, 1.1, 1] },
      { geo: B(0.03, 0.14, 0.04), p: [0, -0.03, -0.14] },
    ], steel, head);
    add([{ geo: new THREE.ConeGeometry(0.03, 0.25, 5), p: [0, 0.2, 0.05], r: [-0.5, 0, 0] }], capeM, head);
    // Umhang (weht im Wind)
    const capeGeo = new THREE.PlaneGeometry(0.62, 1.3, 4, 10);
    capeGeo.translate(0, -0.65, 0);
    this.cape = new THREE.Mesh(capeGeo, capeM);
    this.cape.position.set(0, 0.62, 0.16);
    torso.add(this.cape);
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
    this.mats.membrane.emissive.set(skin.membrane);
    this.mats.skin.metalness = this.mats.body.metalness = skin.metal ?? 0;
    this.mats.skin.roughness = this.mats.body.roughness = skin.rough ?? 0.62;
    this.mats.horn.color.set(skin.horn ?? 0xb8ab92);
    this.mats.eye.emissive.set(skin.eye ?? 0xffaa22);
    const col = this.bodyGeo.getAttribute('color');
    const c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      c.copy(body).lerp(belly, this.bellyMask[i]).multiplyScalar(this.shade[i]);
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
        t1: base1 + amp * (Math.cos(ph) * 0.78 + 0.08) + asym - (a.grounded || 0) * 0.55,
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
    for (let i = 0; i < TAILS; i++) {
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
      const side = key.endsWith('L') ? 1 : -1;
      const step = walk * Math.sin(wph + (side > 0 ? 0 : Math.PI)) * 0.45;
      // Im Flug nach hinten angelegt (wie ein Greifvogel), am Boden gebeugt
      leg.hip.rotation.x = lerp(-1.35, 0.35, L) + step;
      leg.knee.rotation.x = lerp(0.9, -0.75, L) + Math.max(0, -step) * 0.4;
      leg.foot.rotation.x = lerp(0.9, 0.4, L);
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
