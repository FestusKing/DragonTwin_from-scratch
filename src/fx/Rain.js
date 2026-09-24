// Regen und Geschwindigkeits-Streifen.
// Beide nutzen denselben Trick: Die Tropfen/Streifen liegen in einer Box um die
// Kamera. Verlässt einer die Box, taucht er auf der anderen Seite wieder auf.
// Die Bewegung rechnet komplett die Grafikkarte → kostet kaum Leistung.
import * as THREE from 'three';

const rainVert = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
attribute float aIdx;
uniform float uTime, uFall, uLen, uIntensity;
uniform vec3 uCam, uBox, uRel;
uniform vec2 uWind;
varying float vAlpha;
void main() {
  vec3 p = aSeed * uBox;
  p.y -= uTime * uFall * (0.85 + aSeed.x * 0.3);
  p.xz += uWind * uTime;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCam + rel;
  vec3 vel = vec3(uWind.x, -uFall, uWind.y) - uRel;
  float sp = length(vel);
  world -= (vel / max(sp, 0.001)) * clamp(sp * uLen, 0.4, 4.5) * aEnd;
  float fade = 1.0 - smoothstep(uBox.x * 0.25, uBox.x * 0.5, length(rel.xz));
  vAlpha = fade * step(aIdx, uIntensity);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const rainFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function streakGeometry(count) {
  const seed = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  const idx = new Float32Array(count * 2);
  const pos = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i++) {
    const s = [Math.random(), Math.random(), Math.random()];
    const id = Math.random();
    for (let k = 0; k < 2; k++) {
      const v = i * 2 + k;
      seed.set(s, v * 3);
      end[v] = k;
      idx[v] = id;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
  return g;
}

export class Rain {
  constructor(scene, count = 6000) {
    this.uniforms = {
      uTime: { value: 0 },
      uFall: { value: 28 },
      uLen: { value: 0.035 },
      uIntensity: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(90, 60, 90) },
      uRel: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(0.75, 0.8, 0.88) },
      uOpacity: { value: 0.4 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(streakGeometry(count), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    scene.add(this.mesh);
  }

  update(dt, camera, camVel, weather, sky) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uIntensity.value = weather.rain;
    this.mesh.visible = weather.rain > 0.01;
    u.uCam.value.copy(camera.position);
    u.uRel.value.copy(camVel);
    u.uWind.value.set(weather.windVec.x, weather.windVec.z);
    const l = 0.25 + sky.day * 0.6;
    u.uColor.value.setRGB(0.75 * l, 0.8 * l, 0.9 * l);
  }
}

// ---------------- Geschwindigkeits-Streifen (Fahrtwind) ----------------

const speedVert = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;
attribute float aIdx;
uniform vec3 uCam, uBox, uVel;
uniform float uLen;
varying float vAlpha;
void main() {
  vec3 p = aSeed * uBox;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCam + rel;
  world -= uVel * uLen * aEnd;
  float d = length(rel);
  vAlpha = (1.0 - smoothstep(uBox.x * 0.2, uBox.x * 0.5, d)) * smoothstep(4.0, 12.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const speedFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SpeedLines {
  constructor(scene, count = 350) {
    this.uniforms = {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(70, 40, 70) },
      uVel: { value: new THREE.Vector3() },
      uLen: { value: 0.05 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: speedVert,
      fragmentShader: speedFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(streakGeometry(count), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 31;
    scene.add(this.mesh);
  }

  update(camera, vel, speed, brightness) {
    const u = this.uniforms;
    u.uCam.value.copy(camera.position);
    u.uVel.value.copy(vel);
    const k = Math.max(0, Math.min(1, (speed - 40) / 60));
    u.uOpacity.value = k * 0.35 * brightness;
    u.uLen.value = 0.04 + k * 0.05;
    this.mesh.visible = k > 0.01;
  }
}
