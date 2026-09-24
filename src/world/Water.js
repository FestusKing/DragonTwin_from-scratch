// Wasser für Meer, See und Fluss (alles auf Höhe 0).
// Tricks für gutes Aussehen ohne teure Echt-Spiegelung:
// - Wellen: zwei verschobene Normalmaps
// - Spiegelung: Himmelsfarbe in Reflexionsrichtung (Fresnel = am Rand stärker)
// - Tiefe: aus der Höhenkarte des Terrains → türkis im Flachen, blau im Tiefen
// - Schaum am Ufer
import * as THREE from 'three';
import { waterNormalTexture } from '../fx/Textures.js';
import { WORLD_SIZE, SEGMENTS } from './Terrain.js';

const vert = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform sampler2D uNormal, uHeight;
uniform float uTime, uSize, uCell, uN, uRain, uWind, uSunI;
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uDeep, uShallow, uAmbient;
varying vec3 vWorld;
#include <fog_pars_fragment>

void main() {
  vec2 p = vWorld.xz;
  vec2 huv = ((p + uSize * 0.5) / uCell + 0.5) / uN;
  float ground = -42.0;
  if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) ground = texture2D(uHeight, huv).r;
  float depth = max(0.0, -ground);

  vec2 uv1 = p * 0.011 + vec2(uTime * 0.013, uTime * 0.008);
  vec2 uv2 = p * 0.029 + vec2(-uTime * 0.021, uTime * 0.016);
  vec2 uv3 = p * 0.0021 + vec2(uTime * 0.0032, -uTime * 0.0021);
  vec2 n1 = texture2D(uNormal, uv1).xy * 2.0 - 1.0;
  vec2 n2 = texture2D(uNormal, uv2).xy * 2.0 - 1.0;
  vec2 n3 = texture2D(uNormal, uv3).xy * 2.0 - 1.0;
  vec2 n4 = texture2D(uNormal, p * 0.35 + vec2(uTime * 0.9, uTime * 0.6)).xy * 2.0 - 1.0;
  float strength = 0.35 + uWind * 0.55;
  vec2 nxy = (n1 * 0.55 + n2 * 0.4 + n3 * 0.7) * strength + n4 * uRain * 0.25;
  float dist = length(cameraPosition - vWorld);
  nxy *= 1.0 - smoothstep(600.0, 5000.0, dist) * 0.75;
  vec3 N = normalize(vec3(nxy.x, 1.0, nxy.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);

  vec3 sky = mix(uHorizon, uZenith, pow(R.y, 0.45));
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

  float dT = 1.0 - exp(-depth * 0.16);
  vec3 light = uAmbient * 0.7 + uSunColor * uSunI * 0.3 * max(uSunDir.y, 0.0);
  vec3 body = mix(uShallow, uDeep, dT) * light;
  vec3 col = mix(body, sky, fres * 0.9);

  float sd = max(dot(R, uSunDir), 0.0);
  col += uSunColor * uSunI * (pow(sd, 380.0) * 14.0 + pow(sd, 40.0) * 0.2);

  // Schaum am Ufer (wandert mit leichten Wellen)
  float fn = texture2D(uNormal, p * 0.06 + uTime * 0.015).x;
  float foam = smoothstep(1.5, 0.0, depth + (fn - 0.5) * 1.6 + sin(uTime * 1.2 + depth * 2.5) * 0.3);
  foam *= step(-38.0, ground);
  col = mix(col, (uAmbient + uSunColor * uSunI * 0.6) * 0.95, foam * 0.7);

  float alpha = mix(0.3, 1.0, smoothstep(0.0, 4.5, depth));
  alpha = max(alpha, fres);
  alpha = max(alpha, foam * 0.85);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Water {
  constructor(scene, terrain) {
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uNormal: { value: null },
        uHeight: { value: null },
        uTime: { value: 0 },
        uSize: { value: WORLD_SIZE },
        uCell: { value: WORLD_SIZE / SEGMENTS },
        uN: { value: SEGMENTS + 1 },
        uRain: { value: 0 },
        uWind: { value: 0.3 },
        uSunI: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uDeep: { value: new THREE.Color(0x0b2330) },
        uShallow: { value: new THREE.Color(0x2f6c68) },
        uAmbient: { value: new THREE.Color(0.5, 0.6, 0.7) },
      },
    ]);
    // Texturen nicht durch merge() klonen lassen
    uniforms.uNormal.value = waterNormalTexture();
    uniforms.uHeight.value = terrain.heightTexture;
    this.uniforms = uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    const geo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(dt, sky, weather, camera) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uRain.value = weather.rain;
    u.uWind.value = weather.wind;
    u.uSunDir.value.copy(sky.lightDir);
    u.uSunColor.value.copy(sky.lightColor);
    u.uSunI.value = Math.min(1.5, sky.light.intensity / 2.2);
    u.uZenith.value.copy(sky.zenith);
    u.uHorizon.value.copy(sky.horizon);
    u.uAmbient.value.copy(sky.ambient);
    // Wasserfläche wandert mit der Kamera mit (auf 100 m gerastet)
    this.mesh.position.x = Math.round(camera.position.x / 100) * 100;
    this.mesh.position.z = Math.round(camera.position.z / 100) * 100;
  }
}
