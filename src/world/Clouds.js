// Wolken aus vielen weichen "Billboards" (Bildern, die immer zur Kamera zeigen).
// Man kann durchfliegen: Ist die Kamera in einer Wolke, wird alles weiss/neblig.
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';
import { cloudAtlasTexture } from '../fx/Textures.js';

const AREA = 14000; // Wolken-Gebiet (Meter), wiederholt sich an den Rändern
const HALF_AREA = AREA / 2;

const vert = /* glsl */ `
attribute vec3 iOffset;
attribute vec4 iData;   // x=Grösse, y=Drehung, z=Variante, w=Höhe in der Wolke (0 unten … 1 oben)
attribute vec4 iLocal;  // xyz=Richtung vom Wolkenzentrum, w=Schwelle (Bewölkung)
uniform float uCover;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec2 vQuad;     // Lage im Bausch (-1 … 1), für die "Kugel"-Beleuchtung
varying float vAlpha;
varying float vHeight;
varying float vSide;    // liegt der Bausch auf der Sonnenseite der Wolke?
varying vec3 vSunView;  // Sonnenrichtung in Kamera-Koordinaten
varying float vFogDepth;
void main() {
  float size = iData.x * (0.75 + uCover * 0.45);
  vec4 mv = viewMatrix * vec4(iOffset, 1.0);
  float c = cos(iData.y), s = sin(iData.y);
  vec2 p = position.xy;
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  mv.xy += q * size;
  gl_Position = projectionMatrix * mv;
  vQuad = q * 2.0;
  float v = iData.z;
  vUv = (uv + vec2(mod(v, 2.0), floor(v / 2.0))) * 0.5;
  float cover = smoothstep(iLocal.w - 0.07, iLocal.w + 0.07, uCover);
  float dist = length(iOffset - uCamPos);
  float nearF = smoothstep(size * 0.25, size * 1.1, dist);
  float farF = 1.0 - smoothstep(6000.0, 7200.0, dist);
  vAlpha = cover * nearF * farF;
  vHeight = iData.w;
  vSide = dot(normalize(iLocal.xyz + vec3(0.0, 0.001, 0.0)), uSunDir) * 0.5 + 0.5;
  vSunView = normalize(mat3(viewMatrix) * uSunDir);
  vFogDepth = -mv.z;
}`;

const frag = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uSunColor, uAmbient, uFogColor;
uniform float uDark, uFogDensity, uOpacity, uSunI, uNight;
varying vec2 vUv;
varying vec2 vQuad;
varying float vAlpha;
varying float vHeight;
varying float vSide;
varying vec3 vSunView;
varying float vFogDepth;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vAlpha * uOpacity;
  if (a < 0.004) discard;
  // Jeder Bausch wird wie eine Kugel beleuchtet (Normale aus der Lage im Bild),
  // das Rauschen der Textur macht die Oberfläche unregelmässig (Blumenkohl).
  vec2 q = vQuad + (t.g - 0.5) * 0.7;
  vec3 N = normalize(vec3(q, sqrt(max(0.0, 1.0 - dot(q, q))) + 0.25));
  float sphere = clamp(dot(N, vSunView) * 0.5 + 0.5, 0.0, 1.0);
  // Licht hauptsächlich nach der Lage in der ganzen Wolke, die Kugel nur als Feinheit
  float diff = mix(vSide, sphere, 0.35);
  // unten und auf der Schattenseite der Wolke dunkler (Selbstschatten)
  float occl = mix(0.5, 1.0, vHeight) * (0.8 + 0.2 * t.r);
  vec3 amb = uAmbient * mix(0.62, 0.95, vHeight);
  vec3 col = amb + uSunColor * uSunI * diff * occl * 0.72;
  // Silberrand: dünne Ränder leuchten, wenn die Sonne hinter der Wolke steht
  float behind = max(0.0, -vSunView.z);
  col += uSunColor * uSunI * pow(behind, 3.0) * (1.0 - t.a) * 0.55;
  col *= 1.0 - uDark * 0.6;
  col *= mix(1.0, 0.3, uNight);
  col = min(col, vec3(1.05));
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0) * 0.9);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Clouds {
  constructor(scene, clusterCount = 90) {
    const rnd = mulberry32(4242);
    this.clusters = [];
    this.puffs = [];
    for (let c = 0; c < clusterCount; c++) {
      const cl = {
        x: (rnd() - 0.5) * AREA,
        z: (rnd() - 0.5) * AREA,
        y: 480 + rnd() * 220,
        rx: 260 + rnd() * 340,
        ry: 70 + rnd() * 70,
        rz: 220 + rnd() * 280,
        thresh: rnd(),
        wx: 0,
        wz: 0,
      };
      this.clusters.push(cl);
      // Haufenwolke: flacher Boden, in der Mitte höher (Türme), oben kleinere Bäusche
      const n = 18 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd());
        const lx = Math.cos(a) * r * cl.rx * 0.8;
        const lz = Math.sin(a) * r * cl.rz * 0.8;
        const h = Math.pow(rnd(), 1.4) * (1 - r * 0.65);
        const ly = -cl.ry * 0.35 + h * cl.ry * 1.5;
        this.puffs.push({
          cl,
          lx,
          ly,
          lz,
          size: (200 + rnd() * 220) * (1 - h * 0.2),
          rot: (rnd() - 0.5) * 0.5, // kaum gedreht → flache Unterseite bleibt unten
          variant: Math.floor(rnd() * 4),
          shade: Math.min(1, h * 1.2 + 0.05),
          dist: 0,
        });
      }
    }
    const count = this.puffs.length;
    this.count = count;

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aOffset.setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.aLocal = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    geo.setAttribute('iOffset', this.aOffset);
    geo.setAttribute('iData', this.aData);
    geo.setAttribute('iLocal', this.aLocal);
    geo.instanceCount = count;

    this.uniforms = {
      uTex: { value: cloudAtlasTexture() },
      uCover: { value: 0.4 },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.6, 0.7, 0.8) },
      uFogColor: { value: new THREE.Color() },
      uDark: { value: 0 },
      uFogDensity: { value: 0.0001 },
      uOpacity: { value: 0.7 },
      uSunI: { value: 1 },
      uNight: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);

    this.order = this.puffs.map((_, i) => i);
    this.frame = 0;
    this.inCloud = 0;
    this._writeStatic();
  }

  _writeStatic() {
    const d = this.aData.array;
    const l = this.aLocal.array;
    for (let k = 0; k < this.count; k++) {
      const p = this.puffs[this.order[k]];
      d[k * 4] = p.size;
      d[k * 4 + 1] = p.rot;
      d[k * 4 + 2] = p.variant;
      d[k * 4 + 3] = p.shade;
      const len = Math.hypot(p.lx, p.ly * 2, p.lz) || 1;
      l[k * 4] = p.lx / len;
      l[k * 4 + 1] = (p.ly * 2) / len;
      l[k * 4 + 2] = p.lz / len;
      l[k * 4 + 3] = p.cl.thresh;
    }
    this.aData.needsUpdate = true;
    this.aLocal.needsUpdate = true;
  }

  /**
   * @param sky  Sky-Objekt (für Farben)
   * @param weather Wetter (Bewölkung, Wind)
   */
  update(dt, camera, sky, weather, fogDensity) {
    const cam = camera.position;
    // Wind verschiebt die Wolken, am Rand tauchen sie gegenüber wieder auf
    for (const cl of this.clusters) {
      cl.x += weather.windVec.x * dt * 1.5;
      cl.z += weather.windVec.z * dt * 1.5;
      cl.wx = ((((cl.x - cam.x + HALF_AREA) % AREA) + AREA) % AREA) - HALF_AREA + cam.x;
      cl.wz = ((((cl.z - cam.z + HALF_AREA) % AREA) + AREA) % AREA) - HALF_AREA + cam.z;
    }

    // Bin ich in einer Wolke?
    const cover = weather.cloudCover;
    let inside = 0;
    for (const cl of this.clusters) {
      const vis = Math.min(1, Math.max(0, (cover - cl.thresh + 0.07) / 0.14));
      if (vis <= 0) continue;
      const s = 0.75 + cover * 0.45;
      const dx = (cam.x - cl.wx) / (cl.rx * s);
      const dy = (cam.y - (cl.y + cl.ry * 0.3)) / (cl.ry * s * 1.2); // Wolkenmitte liegt über dem flachen Boden
      const dz = (cam.z - cl.wz) / (cl.rz * s);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < 1) inside = Math.max(inside, (1 - d) * vis);
    }
    this.inCloud = inside;

    // Hinten → vorne sortieren (damit die Transparenz richtig aussieht)
    this.frame++;
    if (this.frame % 12 === 0) {
      for (const p of this.puffs) {
        const x = p.cl.wx + p.lx - cam.x;
        const y = p.cl.y + p.ly - cam.y;
        const z = p.cl.wz + p.lz - cam.z;
        p.dist = x * x + y * y + z * z;
      }
      this.order.sort((a, b) => this.puffs[b].dist - this.puffs[a].dist);
      this._writeStatic();
    }
    const o = this.aOffset.array;
    for (let k = 0; k < this.count; k++) {
      const p = this.puffs[this.order[k]];
      o[k * 3] = p.cl.wx + p.lx;
      o[k * 3 + 1] = p.cl.y + p.ly;
      o[k * 3 + 2] = p.cl.wz + p.lz;
    }
    this.aOffset.needsUpdate = true;

    const u = this.uniforms;
    u.uCover.value = cover;
    u.uCamPos.value.copy(cam);
    u.uSunDir.value.copy(sky.lightDir);
    u.uSunColor.value.copy(sky.lightColor);
    u.uSunI.value = Math.min(1.2, sky.light.intensity / 2.5);
    u.uAmbient.value.copy(sky.horizon).lerp(sky.zenith, 0.3).multiplyScalar(0.9 + sky.day * 0.4);
    u.uFogColor.value.copy(sky.fogColor);
    u.uDark.value = weather.darkness + weather.overcast * 0.15;
    u.uFogDensity.value = fogDensity * 0.35;
    u.uNight.value = sky.night;
  }
}
