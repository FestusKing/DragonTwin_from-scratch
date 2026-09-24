// Das Drachen-Modell (nur Aussehen + Animation, KEINE Physik).
// Das Modell kommt aus public/models/dragon_scales.glb. Es wurde komplett per
// Skript in Blender gebaut (tools/build_dragon.py) und hat ein Skelett:
// Drehen wir die Knochen, bewegt sich die Haut mit (Flügel, Hals, Schwanz …).
// Vorne ist -z, oben ist +y, rechts ist +x. Einheit: Meter.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp, damp, lerp, smoothstep } from '../core/utils.js';
import { mergeParts } from './geo.js';
import { addAtmosphereUniforms } from '../fx/Atmosphere.js';

const MODEL_URL = `${import.meta.env.BASE_URL}models/dragon_scales.glb`;

export const STAND_HEIGHT = 2.62; // Höhe des Mittelpunkts über dem Boden im Stehen (Füsse im Modell bei y = -2.66)

let template = null; // geladenes Modell, jeder Drache bekommt eine Kopie

/** Modell einmal laden (vor dem ersten `new Dragon()`). */
export async function loadDragonModel() {
  if (template) return;
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  template = gltf.scene;
}

const NECK = ['neck_01', 'neck_02', 'neck_03', 'neck_04', 'neck_05'];
// Im Modell steht der Hals in S-Form hoch (wie am Boden). Im Flug wird er nach vorne gestreckt:
// Halsansatz tiefer, oberer Hals und Kopf wieder hoch (Nicken in Radiant, + = hoch).
const NECK_FLIGHT = [-0.45, -0.15, 0.05, 0.2, 0.2];
const HEAD_FLIGHT = 0.25;
const TAIL = ['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06', 'tail_07', 'tail_08'];
// Flügel anlegen: Drehung in der Draufsicht (Radiant) für Oberarm, Unterarm, Finger 1–4.
// Im Modell sind die Flügel gespreizt; angelegt zeigt der Oberarm nach hinten,
// der Unterarm klappt nach vorne (wie ein Scharnier), die Finger liegen hinten am Körper.
// Passend zu den Winkeln im Modell (tools/build_dragon.py: ARM_ANG, FINGER_ANG).
const FOLD_UPPER = 1.55;
const FOLD_FORE = -3.0;
const FOLD_FINGERS = [2.7, 2.15, 1.65, 1.15];

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Dragon {
  constructor({ ghost = false } = {}) {
    if (!template) throw new Error('Drachen-Modell ist nicht geladen (loadDragonModel fehlt)');
    this.ghost = ghost;
    this.root = new THREE.Group(); // wird von der Physik bewegt
    this.model = new THREE.Group(); // für Wackeln/Anim.
    this.root.add(this.model);
    this.time = Math.random() * 10;

    this.scene = SkeletonUtils.clone(template);
    this.model.add(this.scene);
    this._collect();
    this._setupMaterials();
    this._createMouthGlow();
    if (!ghost) this._createRider();

    // geglättete Animationswerte
    this.s = { fold: 0, amp: 0, legs: 0, jaw: 0, neckYaw: 0, neckPitch: 0, tailYaw: 0, tailPitch: 0, hover: 0, bank: 0 };
    this.update(0, { flapPhase: 0, flapAmp: 0, fold: 0 });
  }

  // ------------------------------------------------------------ Aufbau
  /** Knochen, Anker und Meshes finden; Ruhe-Drehungen merken. */
  _collect() {
    this.bones = {};
    this.rest = {};
    this.meshes = [];
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      if (o.isBone) {
        this.bones[o.name] = o;
        const model = o.getWorldQuaternion(new THREE.Quaternion()); // Modell steht hier noch im Ursprung
        this.rest[o.name] = { local: o.quaternion.clone(), model, modelInv: model.clone().invert() };
      } else if (o.isMesh) {
        this.meshes.push(o);
        o.frustumCulled = false;
        o.castShadow = !this.ghost;
        o.receiveShadow = !this.ghost;
      }
    });
    this.anchor = {
      mouth: this.scene.getObjectByName('Anker_Maul'),
      nostril: this.scene.getObjectByName('Anker_Nuestern'),
      saddle: this.scene.getObjectByName('Anker_Sattel'),
    };
    for (const [k, v] of Object.entries(this.anchor)) {
      if (!v) throw new Error(`Anker "${k}" fehlt im Drachen-Modell`);
    }
  }

  _setupMaterials() {
    this.mats = {};
    if (this.ghost) {
      const gm = new THREE.MeshBasicMaterial({
        color: 0x7fd8ff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      for (const m of this.meshes) m.material = gm;
      this.mats.mouth = gm;
      return;
    }
    // Jede Kopie bekommt eigene Materialien (Farben lassen sich einzeln ändern)
    for (const m of this.meshes) {
      m.material = m.material.clone();
      this.mats[m.material.name] = m.material;
    }
    const M = this.mats;
    // Flughaut: dünn → Licht scheint durch. Steht die Sonne hinter dem Flügel,
    // leuchtet die Haut warm auf und die Adern (dunkler in der Textur) werden sichtbar.
    if (M.Flughaut) {
      M.Flughaut.side = THREE.DoubleSide;
      M.Flughaut.emissiveMap = M.Flughaut.map;
      M.Flughaut.emissiveIntensity = 0.12;
      M.Flughaut.onBeforeCompile = (shader) => {
        addAtmosphereUniforms(shader);
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  float through = max(0.0, dot(geometryViewDir, -directionalLights[0].direction));
  vec3 tint = diffuseColor.rgb * vec3(1.7, 0.85, 0.6); // Licht wird im Gewebe rötlich
  reflectedLight.directDiffuse += directionalLights[0].color * tint * (pow(through, 2.5) * 0.4 + 0.05);
#endif`
        );
      };
    }
    // Schuppen etwas deutlicher (Normal-Map)
    if (M.Haut) M.Haut.normalScale.setScalar(1.35);
    this.mats.mouth = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 3, 0.6), transparent: true, opacity: 0.9 });
  }

  _createMouthGlow() {
    // Leuchtender Rachen beim Feuer (sitzt zwischen den Kiefern)
    this.mouthGlow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.mats.mouth);
    this.mouthGlow.position.set(0, 0, 0.9);
    this.mouthGlow.visible = false;
    this.anchor.mouth.add(this.mouthGlow);
  }

  // ------------------------------------------------------------ Reiter
  _createRider() {
    const r = new THREE.Group();
    r.position.set(0, 0.1, 0);
    this.anchor.saddle.add(r);
    this.rider = r;
    const leather = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
    const skinM = new THREE.MeshStandardMaterial({ color: 0xd9a582, roughness: 0.7 });
    const capeM = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.85, side: THREE.DoubleSide });
    const add = (parts, mat, parent) => {
      const me = new THREE.Mesh(mergeParts(parts), mat);
      me.castShadow = true;
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
    this.cape.castShadow = true;
    this.cape.position.set(0, 0.62, 0.16);
    torso.add(this.cape);
    this.capeBase = capeGeo.getAttribute('position').array.slice();
  }

  // ------------------------------------------------------------ Aussehen ändern
  setSkin(skin) {
    if (this.ghost) return;
    const M = this.mats;
    M.Haut?.color.set(skin.body);
    M.Bauch?.color.set(skin.belly);
    if (M.Flughaut) {
      M.Flughaut.color.set(skin.membrane);
      M.Flughaut.emissive.set(skin.membrane);
    }
    for (const m of [M.Haut, M.Bauch]) {
      if (!m) continue;
      m.metalness = skin.metal ?? 0;
      m.roughness = (skin.rough ?? 0.62) + (m === M.Bauch ? 0.15 : 0);
    }
    M.Horn?.color.set(skin.horn ?? 0xb8ab92);
    M.Stachel?.color.set(skin.spike ?? skin.horn ?? 0xb8ab92);
    M.Auge?.emissive.set(skin.eye ?? 0xffaa22);
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
  }

  // ------------------------------------------------------------ Positionen für andere Systeme
  getMouth(outPos, outDir) {
    this.anchor.mouth.getWorldPosition(outPos);
    // Richtung, in die der Kopf schaut (im Modell: nach vorne-unten, der Kopf ist in Ruhe gesenkt)
    if (outDir) this._boneDir('head', outDir.set(0, -0.25, -1));
    return outPos;
  }

  getNostril(out) {
    return this.anchor.nostril.getWorldPosition(out);
  }

  getRiderEye(out) {
    if (!this.riderHead) return this.root.getWorldPosition(out);
    return this.riderHead.localToWorld(out.set(0, 0.05, -0.1));
  }

  /** Richtung (im Modell in Ruhepose angegeben) so drehen, wie der Knochen jetzt in der Welt steht. */
  _boneDir(name, v) {
    this.bones[name].getWorldQuaternion(_q);
    return v.applyQuaternion(this.rest[name].modelInv).applyQuaternion(_q).normalize();
  }

  /**
   * Knochen drehen: Winkel um die Achsen des Modells (x = nicken, y = drehen, z = rollen),
   * immer relativ zur Ruhepose. Die Achsen "wandern" mit den Eltern-Knochen mit.
   */
  _pose(name, x, y, z, order = 'YXZ') {
    const r = this.rest[name];
    _e.set(x, y, z, order);
    _qd.setFromEuler(_e);
    _q.copy(r.modelInv).multiply(_qd).multiply(r.model);
    this.bones[name].quaternion.copy(r.local).multiply(_q);
  }

  /** Einen Flügel stellen. side: 'R' oder 'L'. Winkel wie beim alten Code-Drachen. */
  _wing(side, { fold, t1, t2, t3, sweep }) {
    const sg = side === 'R' ? 1 : -1; // links = gespiegelt
    const f = smoothstep(0, 1, fold);
    // Draufsicht-Drehung (y): negativ = nach hinten (rechts). Hochklappen (z): positiv = hoch (rechts).
    this._pose(`upperarm_${side}`, 0, -sg * (f * FOLD_UPPER + sweep), sg * t1, 'ZYX');
    this._pose(`forearm_${side}`, 0, -sg * f * FOLD_FORE, sg * t2, 'ZYX');
    this._pose(`hand_${side}`, 0, 0, sg * t3, 'ZYX');
    for (let k = 0; k < 4; k++) {
      this._pose(`finger${k + 1}_1_${side}`, 0, -sg * f * FOLD_FINGERS[k], sg * t3 * 0.3 * (k / 3), 'ZYX');
      // äussere Fingerglieder biegen sich im Schlag etwas nach (wirkt weicher)
      this._pose(`finger${k + 1}_2_${side}`, 0, 0, sg * t3 * 0.4, 'ZYX');
    }
    // Daumen klappt beim Anlegen mit
    this._pose(`thumb_${side}`, 0, sg * f * 0.6, 0, 'ZYX');
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
    const grounded = a.grounded || 0;

    // --- Flügel ---
    const ph = (a.flapPhase || 0) * Math.PI * 2;
    const amp = s.amp;
    const glide = 1 - amp;
    const breathe = Math.sin(t * 1.3) * 0.03;
    const upFold = amp * Math.max(0, -Math.sin(ph)) * 0.4; // beim Hochschlag Flügel etwas anwinkeln
    const fold = clamp(s.fold + upFold + grounded * 0.9, 0, 1);
    const roll = a.roll || 0;
    const base1 = 0.02 * glide + breathe + s.fold * 0.35;
    for (const side of ['R', 'L']) {
      const sg = side === 'R' ? 1 : -1;
      // Kurveninnenseite etwas tiefer, Aussenseite höher
      const asym = -roll * sg * 0.12 - s.bank * sg * 0.04;
      this._wing(side, {
        fold: clamp(fold + (sg * roll > 0 ? Math.abs(roll) * 0.08 : 0), 0, 1),
        t1: base1 + amp * (Math.cos(ph) * 0.78 + 0.08) + asym - grounded * 0.55,
        t2: amp * Math.cos(ph - 0.9) * 0.38 - glide * 0.04,
        t3: amp * Math.cos(ph - 1.7) * 0.32 + glide * 0.05,
        sweep: s.fold * 0.2 + (a.boost ? 0.05 : 0),
      });
    }

    // --- Körper-Wippen (nur optisch) ---
    this.model.position.y = -amp * Math.sin(ph) * 0.25;
    this._pose('chest', -amp * Math.sin(ph) * 0.03, 0, 0);

    // --- Hals: im Flug gestreckt, am Boden in S-Form; gleicht das Wippen aus, schaut in die Kurve ---
    const neckBob = amp * Math.sin(ph) * 0.04;
    const stretch = 1 - s.legs; // 1 = fliegt, 0 = steht, beim Schweben halb
    for (let i = 0; i < NECK.length; i++) {
      const x = NECK_FLIGHT[i] * stretch + neckBob * (i < 2 ? 1 : -1) + s.neckPitch * 0.2 + s.hover * (i === 0 ? 0.12 : -0.04) + Math.sin(t * 0.9 + i) * 0.012;
      const y = s.neckYaw * 0.2 + Math.sin(t * 0.6 + i * 0.5) * 0.016;
      this._pose(NECK[i], x, y, 0);
    }
    this._pose('head', HEAD_FLIGHT * stretch - neckBob * 0.5 - s.jaw * 0.15, 0, 0);
    this._pose('jaw', -s.jaw * 0.5 - Math.max(0, Math.sin(t * 0.4)) * 0.015, 0, 0);
    if (this.mouthGlow) this.mouthGlow.visible = (a.fire || 0) > 0.05;

    // --- Schwanz: Welle + folgt den Kurven ---
    const speedK = clamp((a.speed || 0) / 60, 0, 1);
    for (let i = 0; i < TAIL.length; i++) {
      const wave = Math.sin(t * (2.2 - speedK) - i * 0.6) * (0.05 + (1 - speedK) * 0.04);
      const y = wave + s.tailYaw * (0.35 + i * 0.1);
      const x = Math.sin(t * 1.4 - i * 0.55) * 0.02 + s.tailPitch * 0.26 + amp * Math.sin(ph - i * 0.45) * 0.025;
      this._pose(TAIL[i], x, y, 0);
    }

    // --- Beine: im Flug nach hinten angelegt (wie ein Greifvogel), am Boden stehend ---
    const L = s.legs;
    const walk = a.walk || 0;
    const wph = t * 5;
    for (const side of ['R', 'L']) {
      const step = walk * Math.sin(wph + (side === 'L' ? 0 : Math.PI)) * 0.45;
      this._pose(`thigh_${side}`, lerp(-1.25, 0, L) + step, 0, 0);
      this._pose(`shin_${side}`, lerp(1.0, 0, L) + Math.max(0, -step) * 0.5, 0, 0);
      this._pose(`foot_${side}`, lerp(0.9, 0, L) - Math.max(0, -step) * 0.3, 0, 0);
      this._pose(`toes_${side}`, lerp(0.6, 0, L), 0, 0);
    }

    // --- Umhang des Reiters flattert ---
    if (this.cape && this.cape.visible && this.rider?.visible) {
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
