// Ringrennen (Zeitfahren): Fliege in der richtigen Reihenfolge durch die
// leuchtenden Ringe. Mit Countdown, Zwischenzeiten, Bestzeit und Geist.
import * as THREE from 'three';
import { buildCourse, COURSES } from './Courses.js';
import { GhostRecorder, GhostPlayer, loadRecord, saveRecord } from './GhostReplay.js';
import { Dragon } from '../dragon/Dragon.js';

const ringVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ringFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uGlow, uAlpha;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - abs(dot(normalize(vN), V)), 1.5);
  float band = 0.5 + 0.5 * sin(vUv.x * 6.2831 * 10.0 - uTime * 5.0);
  vec3 col = uColor * (0.5 + band * 0.9 + fres * 1.6) * uGlow;
  gl_FragColor = vec4(col, uAlpha * (0.6 + fres * 0.4));
}`;
const discFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uAlpha;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float swirl = 0.5 + 0.5 * sin(atan(p.y, p.x) * 6.0 + r * 10.0 - uTime * 3.0);
  float a = smoothstep(1.0, 0.6, r) * (0.25 + swirl * 0.35) * uAlpha;
  gl_FragColor = vec4(uColor * 1.5, a);
}`;
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float a = (1.0 - vUv.y) * uAlpha * (0.6 + 0.4 * abs(sin(vUv.x * 12.566)));
  gl_FragColor = vec4(uColor * 2.0, a * 0.5);
}`;

const COL_NEXT = new THREE.Color(1.0, 0.7, 0.22);
const COL_UP = new THREE.Color(0.3, 0.75, 1.0);
const COL_FINISH = new THREE.Color(0.35, 1.0, 0.45);
const _hit = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class RingRace {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.group = new THREE.Group();
    this.group.name = 'Race';
    scene.add(this.group);
    this.state = 'idle';
    this.time = 0;
    this.courseId = null;
    this.events = {}; // countdown(n), go(), ring(i, n, time, delta), finish(result)
    this.recorder = new GhostRecorder();
    this.ghostDragon = new Dragon({ ghost: true });
    this.ghostDragon.root.visible = false;
    scene.add(this.ghostDragon.root);
    this.ghostAnim = {};
    this.uTime = { value: 0 };
  }

  static courses() {
    return COURSES;
  }

  /** Strecke laden und Ringe erzeugen */
  load(courseId, useGhost) {
    this.clear();
    this.courseId = courseId;
    this.course = buildCourse(courseId, this.world);
    this.record = loadRecord(courseId);
    this.ghost = useGhost && this.record?.ghost ? new GhostPlayer(this.record.ghost) : null;
    this.meshes = [];
    for (let i = 0; i < this.course.rings.length; i++) {
      const r = this.course.rings[i];
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: COL_UP.clone() }, uTime: this.uTime, uGlow: { value: 1 }, uAlpha: { value: 0.8 } },
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(r.radius, 0.85, 10, 64), mat);
      torus.position.copy(r.pos);
      torus.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.normal);
      torus.renderOrder = 25;
      const discMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: COL_NEXT.clone() }, uTime: this.uTime, uAlpha: { value: 0 } },
        vertexShader: ringVert,
        fragmentShader: discFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r.radius * 0.97, 48), discMat);
      torus.add(disc);
      this.group.add(torus);
      this.meshes.push({ torus, disc, mat, discMat, fade: 1 });
    }
    // Leuchtsäule über dem nächsten Ring (sieht man von weitem)
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: COL_NEXT.clone() }, uAlpha: { value: 0.6 } },
      vertexShader: ringVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 500, 10, 1, true), beamMat);
    this.beam.geometry.translate(0, 250, 0);
    this.group.add(this.beam);
    this.next = 0;
    this.splits = [];
    this._refreshColors();
  }

  /** Startposition + Countdown */
  begin(physics) {
    const r0 = this.course.rings[0];
    const n = _a.copy(r0.normal).setY(0).normalize();
    const start = r0.pos.clone().addScaledVector(n, -85);
    const ground = this.world.terrain.surfaceAt(start.x, start.z);
    start.y = Math.max(start.y, ground + 20);
    const heading = Math.atan2(-n.x, -n.z);
    physics.reset(start, heading, 0);
    physics.frozen = true;
    this.state = 'countdown';
    this.countdown = 3.2;
    this.lastCount = 4;
    this.time = 0;
    this.next = 0;
    this.splits = [];
    this.recorder.reset();
    for (const m of this.meshes) {
      m.fade = 1;
      m.torus.visible = true;
    }
    this._refreshColors();
    this.ghostDragon.root.visible = !!this.ghost;
    if (this.ghost) {
      this.ghost.sample(0, this.ghostDragon.root.position, this.ghostDragon.root.quaternion, this.ghostAnim);
    }
    this.startPos = start;
    this.startHeading = heading;
  }

  _refreshColors() {
    const N = this.meshes.length;
    this.meshes.forEach((m, i) => {
      const isNext = i === this.next;
      const isFinal = i === N - 1;
      m.mat.uniforms.uColor.value.copy(isNext ? (isFinal ? COL_FINISH : COL_NEXT) : COL_UP);
      m.mat.uniforms.uGlow.value = isNext ? 2.4 : i === this.next + 1 ? 0.9 : 0.55;
      m.mat.uniforms.uAlpha.value = isNext ? 1 : i < this.next ? 0 : i <= this.next + 3 ? 0.75 : 0.35;
      m.discMat.uniforms.uAlpha.value = isNext ? 0.35 : 0;
      m.discMat.uniforms.uColor.value.copy(isFinal ? COL_FINISH : COL_NEXT);
      m.torus.scale.setScalar(1);
    });
    const r = this.course.rings[this.next];
    if (r) {
      this.beam.visible = true;
      this.beam.position.copy(r.pos).add(_b.set(0, r.radius + 2, 0));
      this.beam.material.uniforms.uColor.value.copy(this.next === N - 1 ? COL_FINISH : COL_NEXT);
    } else this.beam.visible = false;
  }

  get nextRing() {
    return this.course?.rings[this.next] || null;
  }

  update(dt, physics, prevPos, particles) {
    if (this.state === 'idle') return;
    this.uTime.value += dt;
    // Ringe pulsieren leicht; durchflogene blenden aus
    this.meshes.forEach((m, i) => {
      if (i === this.next) m.torus.scale.setScalar(1 + Math.sin(this.uTime.value * 4) * 0.03);
      if (i < this.next && m.fade > 0) {
        m.fade = Math.max(0, m.fade - dt * 2);
        m.torus.scale.setScalar(1 + (1 - m.fade) * 0.6);
        m.mat.uniforms.uAlpha.value = m.fade;
        if (m.fade <= 0) m.torus.visible = false;
      }
    });

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c < this.lastCount && c >= 1 && c <= 3) {
        this.lastCount = c;
        this.audio?.playCountdown(false);
        this.events.countdown?.(c);
      }
      if (this.countdown <= 0) {
        this.state = 'running';
        physics.frozen = false;
        physics.reset(this.startPos, this.startHeading, 34);
        physics.flapAmp = 1;
        this.audio?.playCountdown(true);
        this.events.go?.();
      }
      return;
    }

    if (this.state === 'running') {
      this.time += dt;
      this.recorder.record(dt, physics);
      const r = this.course.rings[this.next];
      if (r && this._crossed(prevPos, physics.position, r)) {
        const i = this.next;
        this.splits.push(this.time);
        const bestSplit = this.record?.splits?.[i];
        const delta = bestSplit != null ? this.time - bestSplit : null;
        particles?.ringBurst(r.pos, r.normal, r.radius, i === this.course.rings.length - 1 ? COL_FINISH : COL_NEXT);
        this.audio?.playChime(i);
        this.next++;
        this._refreshColors();
        this.events.ring?.(i, this.course.rings.length, this.time, delta);
        if (this.next >= this.course.rings.length) this._finish();
      }
    }

    // Geist abspielen
    if (this.ghost && (this.state === 'running' || this.state === 'finished')) {
      const g = this.ghostDragon;
      const alive = this.ghost.sample(this.state === 'running' ? this.time : this.ghost.duration + 5, g.root.position, g.root.quaternion, this.ghostAnim);
      g.root.visible = alive && this.state === 'running';
      this.ghostAnim.speed = 50;
      g.update(dt, this.ghostAnim);
    }
  }

  // Hat die Strecke von a nach b die Ringfläche durchstossen?
  _crossed(a, b, r) {
    const d0 = _a.copy(a).sub(r.pos).dot(r.normal);
    const d1 = _b.copy(b).sub(r.pos).dot(r.normal);
    if ((d0 < 0 && d1 >= 0) || (d0 > 0 && d1 <= 0)) {
      const t = d0 / (d0 - d1);
      _hit.copy(a).lerp(b, t);
      return _hit.distanceTo(r.pos) < r.radius * 1.08 + 1.5;
    }
    // sehr nahe am Zentrum zählt auch (falls ein Bild übersprungen wurde)
    return b.distanceTo(r.pos) < r.radius * 0.35;
  }

  _finish() {
    this.state = 'finished';
    this.beam.visible = false;
    const best = this.record?.time ?? null;
    const isRecord = best == null || this.time < best;
    const m = this.course.medals;
    const medal = this.time <= m.gold ? 'gold' : this.time <= m.silver ? 'silver' : this.time <= m.bronze ? 'bronze' : null;
    if (isRecord) {
      this.record = { time: this.time, splits: this.splits.slice(), ghost: this.recorder.data.slice(), date: Date.now() };
      saveRecord(this.courseId, this.record);
    }
    this.audio?.playFinish(isRecord);
    this.events.finish?.({ time: this.time, best, isRecord, medal, medals: m, courseId: this.courseId });
  }

  /** Rennen beenden und Ringe entfernen */
  clear() {
    this.state = 'idle';
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose?.();
      });
    }
    this.meshes = [];
    this.ghostDragon.root.visible = false;
    this.course = null;
  }
}
