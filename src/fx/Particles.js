// Partikelsysteme: Feuer, Rauch, Funken, Wasser-Gischt, Konfetti …
// Ein Partikel = ein kleines Bild (Sprite) mit Position, Geschwindigkeit
// und Lebensdauer. Die Farbe ändert sich über das Leben (Farbverlauf).
import * as THREE from 'three';
import { softCircleTexture, puffTexture } from './Textures.js';

/** Gemeinsamer Wert: wie viele Pixel ist 1 m in 1 m Entfernung (hängt vom FOV ab) */
export const PARTICLE_SCALE = { value: 800 };
const _light = new THREE.Color();
const _tmp = new THREE.Color();

const vert = /* glsl */ `
attribute vec4 aData;   // x = Alter (0..1), y = Grösse (m), z = Drehung, w = Zufall
attribute vec3 aColor;
uniform float uScale;
varying float vAge;
varying float vRot;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vAge = aData.x;
  vRot = aData.z;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = aData.y * uScale / max(0.5, -mv.z);
  gl_PointSize = (aData.x >= 1.0 || aData.y <= 0.0) ? 0.0 : min(s, 700.0);
  vFogDepth = -mv.z;
}`;

const frag = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uC0, uC1, uC2, uLight, uFogColor;
uniform float uIntensity, uAlpha, uAdditive, uFogDensity, uMid;
varying float vAge;
varying float vRot;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  vec4 t = texture2D(uTex, p);
  vec3 col = vAge < uMid ? mix(uC0, uC1, vAge / uMid) : mix(uC1, uC2, (vAge - uMid) / (1.0 - uMid));
  col *= vColor;
  float a = t.a * smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge)) * uAlpha;
  if (a < 0.003) discard;
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(col * uIntensity * (1.0 - fog), a);
  } else {
    col *= uLight;
    col = mix(col, uFogColor, fog);
    gl_FragColor = vec4(col, a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class ParticleSystem {
  constructor(scene, opts) {
    const max = (this.max = opts.max || 1000);
    this.gravity = opts.gravity ?? 0;
    this.drag = opts.drag ?? 0.5;
    this.turb = opts.turbulence ?? 0;
    this.windFactor = opts.windFactor ?? 0.5;
    this.collide = opts.collide || null; // (p) → Bodenhöhe
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1);
    this.life = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.data = new Float32Array(max * 4);
    this.col = new Float32Array(max * 3).fill(1);
    this.next = 0;
    this.alive = 0;
    this.maxIndex = 0;

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aData', this.aData);
    g.setAttribute('aColor', this.aColor);
    this.geometry = g;

    const additive = opts.additive !== false;
    this.uniforms = {
      uTex: { value: opts.texture || softCircleTexture() },
      uScale: PARTICLE_SCALE,
      uC0: { value: new THREE.Color(opts.colors?.[0] ?? 0xffffff) },
      uC1: { value: new THREE.Color(opts.colors?.[1] ?? 0xffffff) },
      uC2: { value: new THREE.Color(opts.colors?.[2] ?? 0xffffff) },
      uMid: { value: opts.mid ?? 0.35 },
      uLight: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0 },
      uIntensity: { value: opts.intensity ?? 1 },
      uAlpha: { value: opts.alpha ?? 1 },
      uAdditive: { value: additive ? 1 : 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.renderOrder ?? 20;
    scene.add(this.points);
  }

  setColors(c0, c1, c2) {
    this.uniforms.uC0.value.copy(c0);
    this.uniforms.uC1.value.copy(c1);
    this.uniforms.uC2.value.copy(c2);
  }

  /** Ein Partikel erzeugen */
  spawn(x, y, z, vx, vy, vz, life, size0, size1, r = 1, g = 1, b = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (i + 1 > this.maxIndex) this.maxIndex = i + 1;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.rot[i] = Math.random() * 6.283;
    this.rotV[i] = (Math.random() - 0.5) * 2;
    this.col[i3] = r;
    this.col[i3 + 1] = g;
    this.col[i3 + 2] = b;
  }

  update(dt, wind) {
    const { pos, vel, age, life, data } = this;
    const drag = Math.exp(-this.drag * dt);
    const gy = this.gravity * dt;
    const wx = (wind?.x || 0) * this.windFactor;
    const wz = (wind?.z || 0) * this.windFactor;
    const turb = this.turb;
    let alive = 0;
    const n = this.maxIndex;
    for (let i = 0; i < n; i++) {
      const i4 = i * 4;
      if (age[i] >= 1) {
        data[i4] = 1;
        continue;
      }
      alive++;
      const i3 = i * 3;
      age[i] += dt / life[i];
      // Luftwiderstand zieht zur Windgeschwindigkeit hin
      vel[i3] = (vel[i3] - wx) * drag + wx;
      vel[i3 + 1] = vel[i3 + 1] * drag + gy;
      vel[i3 + 2] = (vel[i3 + 2] - wz) * drag + wz;
      if (turb) {
        vel[i3] += (Math.random() - 0.5) * turb * dt;
        vel[i3 + 1] += (Math.random() - 0.5) * turb * dt;
        vel[i3 + 2] += (Math.random() - 0.5) * turb * dt;
      }
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (this.collide) {
        const gh = this.collide(pos[i3], pos[i3 + 2]);
        if (pos[i3 + 1] < gh) {
          pos[i3 + 1] = gh;
          // Am Boden ausbreiten
          vel[i3 + 1] = Math.abs(vel[i3 + 1]) * 0.1;
          vel[i3] *= 1.02;
          vel[i3 + 2] *= 1.02;
        }
      }
      const a = Math.min(age[i], 1);
      this.rot[i] += this.rotV[i] * dt;
      data[i4] = a;
      data[i4 + 1] = this.s0[i] + (this.s1[i] - this.s0[i]) * a;
      data[i4 + 2] = this.rot[i];
    }
    this.alive = alive;
    this.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.aColor.needsUpdate = true;
  }

  clear() {
    this.age.fill(1);
    this.data.fill(0);
    this.maxIndex = 0;
    this.next = 0;
  }

  setEnvironment(light, fogColor, fogDensity) {
    this.uniforms.uLight.value.copy(light);
    this.uniforms.uFogColor.value.copy(fogColor);
    this.uniforms.uFogDensity.value = fogDensity;
  }
}

/** Alle Partikelsysteme des Spiels + praktische "Effekt"-Funktionen */
export class Particles {
  constructor(scene, terrain, quality = 1) {
    this.q = quality;
    this.terrain = terrain;
    const ground = (x, z) => Math.max(terrain.heightAt(x, z), 0) + 0.3;
    this.fire = new ParticleSystem(scene, {
      max: Math.floor(4500 * quality),
      texture: puffTexture(3),
      colors: [0xfff0c0, 0xff8a20, 0x801800],
      mid: 0.28,
      intensity: 1.5,
      gravity: 7,
      drag: 1.6,
      turbulence: 18,
      windFactor: 0.4,
      collide: ground,
      renderOrder: 22,
    });
    this.smoke = new ParticleSystem(scene, {
      max: Math.floor(2500 * quality),
      texture: puffTexture(7),
      colors: [0x2a2724, 0x403c38, 0x5a5652],
      additive: false,
      alpha: 0.5,
      gravity: 3.5,
      drag: 0.7,
      turbulence: 4,
      windFactor: 0.9,
      renderOrder: 21,
    });
    this.sparks = new ParticleSystem(scene, {
      max: Math.floor(2000 * quality),
      colors: [0xffffff, 0xffd070, 0xff6020],
      intensity: 4,
      gravity: -4,
      drag: 1.2,
      renderOrder: 23,
    });
    this.spray = new ParticleSystem(scene, {
      max: Math.floor(1800 * quality),
      texture: puffTexture(11),
      colors: [0xffffff, 0xe8f0f5, 0xd0dde5],
      additive: false,
      alpha: 0.65,
      gravity: -9,
      drag: 1.4,
      windFactor: 0.5,
      renderOrder: 21,
    });
  }

  update(dt, wind, sky, fogDensity) {
    const light = _light.copy(sky.ambient).multiplyScalar(0.5).add(_tmp.copy(sky.lightColor).multiplyScalar(sky.light.intensity * 0.08));
    for (const s of [this.smoke, this.spray]) s.setEnvironment(light, sky.fogColor, fogDensity);
    for (const s of [this.fire, this.sparks]) s.setEnvironment(light, sky.fogColor, fogDensity * 0.6);
    this.fire.update(dt, wind);
    this.smoke.update(dt, wind);
    this.sparks.update(dt, wind);
    this.spray.update(dt, wind);
  }

  /** Funkenring, wenn man durch einen Ring fliegt */
  ringBurst(center, normal, radius, color = null) {
    const n = Math.floor(160 * this.q);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    // zwei Vektoren senkrecht zur Ring-Normalen
    a.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.9) a.set(1, 0, 0);
    a.cross(normal).normalize();
    b.copy(normal).cross(a).normalize();
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const dx = a.x * Math.cos(t) + b.x * Math.sin(t);
      const dy = a.y * Math.cos(t) + b.y * Math.sin(t);
      const dz = a.z * Math.cos(t) + b.z * Math.sin(t);
      const sp = 6 + Math.random() * 10;
      const r = color ? color.r : 1;
      const g = color ? color.g : 1;
      const bl = color ? color.b : 1;
      this.sparks.spawn(
        center.x + dx * radius, center.y + dy * radius, center.z + dz * radius,
        dx * sp + normal.x * 8, dy * sp + normal.y * 8, dz * sp + normal.z * 8,
        0.8 + Math.random() * 0.8, 1.4, 0.2, r, g, bl
      );
    }
  }

  /** Bunte Konfetti (Ziege gefunden!) */
  confetti(p) {
    const cols = [[1, 0.3, 0.3], [0.3, 1, 0.4], [0.3, 0.5, 1], [1, 0.9, 0.2], [1, 0.4, 1]];
    for (let i = 0; i < 140 * this.q; i++) {
      const c = cols[i % cols.length];
      const a = Math.random() * Math.PI * 2;
      const up = 6 + Math.random() * 14;
      const s = 3 + Math.random() * 7;
      this.sparks.spawn(p.x, p.y + 2, p.z, Math.cos(a) * s, up, Math.sin(a) * s, 1.2 + Math.random(), 0.9, 0.5, c[0], c[1], c[2]);
    }
  }

  /** Wasserspritzer */
  splash(p, strength = 1, vel = null) {
    const n = Math.floor((40 + strength * 120) * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (2 + Math.random() * 8) * strength;
      this.spray.spawn(
        p.x + (Math.random() - 0.5) * 6, 0.3, p.z + (Math.random() - 0.5) * 6,
        Math.cos(a) * s + (vel ? vel.x * 0.3 : 0), 4 + Math.random() * 14 * strength, Math.sin(a) * s + (vel ? vel.z * 0.3 : 0),
        0.8 + Math.random() * 1.0, 1.5 + Math.random() * 2, 5 + Math.random() * 6 * strength
      );
    }
  }

  /** Staub beim Landen/Aufprall */
  dust(p, strength = 1) {
    const n = Math.floor(40 * strength * this.q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 10 * strength;
      this.smoke.spawn(p.x, p.y + 0.5, p.z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 1.5 + Math.random() * 1.5, 2, 9, 1.6, 1.4, 1.1);
    }
  }
}
