// Himmel mit Tag/Nacht-Zyklus: Farbverlauf, Sonne, Mond, Sterne, Milchstrasse.
// Steuert auch das Licht der Szene (Sonne/Mond als gerichtetes Licht mit
// Schatten + Himmelslicht).
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/utils.js';

// Farb-Stützpunkte je nach Sonnenhöhe (y-Komponente der Sonnenrichtung)
const KEYS = [
  { e: -0.4, zen: 0x02040b, hor: 0x080f1f },
  { e: -0.14, zen: 0x0a1230, hor: 0x1e2442 },
  { e: -0.03, zen: 0x1c2a58, hor: 0xb0584a },
  { e: 0.05, zen: 0x35599a, hor: 0xf09a5c },
  { e: 0.18, zen: 0x46729f, hor: 0xc2cfd8 },
  { e: 0.5, zen: 0x3a6899, hor: 0xb8c8d4 },
  { e: 1.0, zen: 0x345f8f, hor: 0xb2c3d0 },
].map((k) => ({ e: k.e, zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor) }));

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _negDir = new THREE.Vector3();
const _inv = new THREE.Matrix4();

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uSunDir, uMoonDir, uSunColor, uFogColor;
uniform float uStars, uTime, uOvercast, uFog, uFlash, uMoonBright, uSunVis;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.2, h));

  // Sonne: Schein + helle Scheibe (HDR-Wert > 1 → leuchtet mit Bloom)
  float sd = max(dot(d, uSunDir), 0.0);
  float clear = 1.0 - uOvercast;
  col += uSunColor * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.5) * (0.3 + 0.7 * clear) * uSunVis;
  col += uSunColor * pow(sd, 3.0) * 0.35 * (1.0 - abs(h)) * smoothstep(0.4, 0.0, uSunDir.y) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 40.0 * clear * clear * uSunVis;

  // Mond mit Krater-Muster
  float md = dot(d, uMoonDir);
  if (md > 0.999) {
    float disk = smoothstep(0.99955, 0.9997, md);
    float crat = vnoise(d * 900.0) * 0.5 + vnoise(d * 2300.0) * 0.5;
    col += vec3(0.9, 0.93, 1.0) * disk * uMoonBright * (1.6 + crat * 1.4) * clear;
  }
  col += vec3(0.45, 0.55, 0.9) * pow(max(md, 0.0), 300.0) * 0.25 * uMoonBright * clear;

  // Sterne (nur nachts und bei klarem Himmel sichtbar)
  if (uStars > 0.01 && h > -0.02) {
    vec3 p = d * 110.0;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    float r = hash13(cell);
    if (r > 0.984) {
      vec3 off = (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5) * 0.5;
      float size = 0.12 + 0.14 * hash13(cell + 7.7);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 40.0) + r * 300.0);
      float star = smoothstep(size, 0.0, length(f - off)) * tw;
      vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash13(cell + 9.1));
      col += tint * star * uStars * 2.2 * clear * smoothstep(-0.02, 0.12, h);
    }
    // Milchstrasse: leuchtendes Band
    vec3 mwN = normalize(vec3(0.35, 0.45, 0.82));
    float band = exp(-pow(dot(d, mwN) / 0.16, 2.0));
    float cloud = vnoise(d * 14.0) * 0.6 + vnoise(d * 40.0) * 0.4;
    col += vec3(0.32, 0.36, 0.52) * band * cloud * 0.16 * uStars * clear * smoothstep(0.0, 0.3, h);
  }

  // Nebel legt sich über den Horizont
  col = mix(col, uFogColor, uFog * (1.0 - smoothstep(-0.05, 0.45 + uFog * 0.4, h)));
  // Blitz
  col += vec3(0.55, 0.6, 0.85) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.zenith = new THREE.Color();
    this.horizon = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.lightColor = new THREE.Color();
    this.ambient = new THREE.Color();
    this.day = 1;
    this.night = 0;
    this.flash = 0;

    this.uniforms = {
      uZenith: { value: this.zenith },
      uHorizon: { value: this.horizon },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: this.sunColor },
      uFogColor: { value: this.fogColor },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uOvercast: { value: 0 },
      uFog: { value: 0 },
      uFlash: { value: 0 },
      uMoonBright: { value: 1 },
      uSunVis: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(20000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    // Hauptlicht (Sonne ODER Mond) mit Schatten
    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    const sc = this.light.shadow.camera;
    sc.left = -200;
    sc.right = 200;
    sc.top = 200;
    sc.bottom = -200;
    sc.near = 10;
    sc.far = 1600;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.6;
    this.light.shadow.radius = 2.5;
    this.light.shadow.mapSize.set(2048, 2048);
    scene.add(this.light);
    scene.add(this.light.target);

    // Himmelslicht: oben Himmelsfarbe, unten Bodenfarbe
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4030, 1);
    scene.add(this.hemi);

    this._snap = new THREE.Vector3();
    this._lightMat = new THREE.Matrix4();
  }

  /**
   * Umgebungslicht (Image Based Lighting): Der Himmel wird alle paar Sekunden
   * in eine kleine "Rundum-Textur" gerendert. Alle Materialien nutzen sie für
   * weiches Licht von allen Seiten und für Spiegelungen (z. B. auf den Hörnern).
   */
  setupEnvironment(renderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
    this.envScene.add(this.envSky);
    this.envTimer = 0;
    this.envTarget = null;
  }

  _updateEnvironment(dt) {
    if (!this.pmrem) return;
    this.envTimer -= dt;
    if (this.envTimer > 0) return;
    this.envTimer = 2.5;
    // Sonnenscheibe im Umgebungsbild abschwächen (sonst zu grelle Reflexe)
    const flash = this.uniforms.uFlash.value;
    this.uniforms.uFlash.value = 0;
    const rt = this.pmrem.fromScene(this.envScene, 0.02, 1, 30000);
    this.uniforms.uFlash.value = flash;
    this.envTarget?.dispose();
    this.envTarget = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
  }

  setShadowQuality(size) {
    if (size <= 0) {
      this.light.castShadow = false;
      return;
    }
    this.light.castShadow = true;
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.mapSize.set(size, size);
      if (this.light.shadow.map) {
        this.light.shadow.map.dispose();
        this.light.shadow.map = null;
      }
    }
  }

  /**
   * @param time Tageszeit in Stunden
   * @param w Wetterzustand { overcast, fog, fogColor(Color), darkness }
   */
  update(dt, time, w, camera, focus) {
    // Sonnenbahn: Aufgang im Osten (+x), mittags im Süden (+z), Untergang im Westen
    const th = ((time - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(th), Math.sin(th) * 0.88, 0.3 + Math.sin(th) * 0.25).normalize();
    this.moonDir.set(-Math.cos(th) * 0.9, -Math.sin(th) * 0.8 + 0.15, -0.35).normalize();
    const e = this.sunDir.y;

    // Himmelsfarben interpolieren
    let k = 0;
    while (k < KEYS.length - 2 && e > KEYS[k + 1].e) k++;
    const a = KEYS[k];
    const b = KEYS[k + 1];
    const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
    this.zenith.copy(a.zen).lerp(b.zen, t);
    this.horizon.copy(a.hor).lerp(b.hor, t);

    this.day = smoothstep(-0.08, 0.2, e);
    this.night = 1 - smoothstep(-0.18, 0.02, e);

    // Wetter: grau und dunkler bei Bewölkung
    const oc = w.overcast;
    const lum = 0.12 + this.day * 0.55;
    _c1.setRGB(lum * 0.92, lum * 0.95, lum);
    this.zenith.lerp(_c1, oc * 0.85);
    _c2.setRGB(lum * 1.05, lum * 1.07, lum * 1.1);
    this.horizon.lerp(_c2, oc * 0.8);
    this.zenith.multiplyScalar(1 - w.darkness * 0.75);
    this.horizon.multiplyScalar(1 - w.darkness * 0.7);

    // Sonnenfarbe: orange am Horizont, weiss am Mittag
    if (e < 0.12) this.sunColor.setRGB(1.0, 0.45 + e * 2.5, 0.2 + e * 1.5);
    else this.sunColor.setRGB(1.0, 0.93, 0.82);
    const sunI = smoothstep(-0.03, 0.14, e);
    const moonI = smoothstep(-0.02, -0.16, e) * smoothstep(-0.05, 0.1, this.moonDir.y);

    // Nebelfarbe = Horizont (so verschmilzt die Ferne mit dem Himmel)
    this.fogColor.copy(this.horizon);
    const fogLum = lum * (1 - w.darkness * 0.8);
    if (w.fog > 0) this.fogColor.lerp(_c1.setRGB(fogLum * 1.1, fogLum * 1.12, fogLum * 1.15), w.fog * 0.7);

    // Hauptlicht: Sonne am Tag, Mond in der Nacht
    const useSun = e > -0.03;
    this.lightDir.copy(useSun ? this.sunDir : this.moonDir);
    if (useSun) {
      this.lightColor.copy(this.sunColor);
      this.light.intensity = sunI * 3.4 * (1 - oc * 0.72) * (1 - w.darkness * 0.5);
    } else {
      this.lightColor.setRGB(0.62, 0.7, 1.0);
      this.light.intensity = moonI * 1.1 * (1 - oc * 0.7);
    }
    this.light.color.copy(this.lightColor);

    // Himmelslicht
    // nachts bläuliches "Mondlicht"-Ambiente, damit man noch etwas sieht
    this.hemi.color.copy(this.zenith).lerp(_c1.setRGB(1, 1, 1), 0.4).lerp(_c2.setRGB(0.32, 0.42, 0.75), this.night * 0.7);
    this.hemi.groundColor.setRGB(0.28, 0.24, 0.17).multiplyScalar(0.35 + this.day * 0.65);
    // Dämmerung: Himmel ist noch hell → mehr Umgebungslicht
    const twilight = Math.max(0, 1 - Math.abs(e + 0.02) / 0.12);
    this.hemi.intensity = (0.6 + this.day * 0.25 + twilight * 0.3 + oc * 0.25 * this.day) * (1 - w.darkness * 0.6) + this.flash * 3;
    this.ambient.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);

    // Schatten-Kamera folgt dem Spieler, auf Texel-Raster eingerastet (kein Flimmern)
    this._placeLight(focus);

    const u = this.uniforms;
    u.uStars.value = this.night * (1 - oc);
    u.uTime.value += dt;
    u.uOvercast.value = oc;
    u.uFog.value = w.fog;
    this.flash = Math.max(0, this.flash - dt * 4);
    u.uFlash.value = this.flash;
    u.uMoonBright.value = 0.5 + this.night * 0.8;
    u.uSunVis.value = smoothstep(-0.12, 0.0, e);
    this.mesh.position.copy(camera.position);
    this._updateEnvironment(dt);
  }

  _placeLight(focus) {
    const L = this.light;
    const dist = 700;
    const size = L.shadow.camera.right - L.shadow.camera.left;
    const texel = size / L.shadow.mapSize.x;
    // Fokus in "Licht-Koordinaten" umrechnen, einrasten, zurückrechnen
    this._lightMat.lookAt(_origin, _negDir.copy(this.lightDir).negate(), _up);
    _inv.copy(this._lightMat).invert();
    const p = this._snap.copy(focus).applyMatrix4(_inv);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this._lightMat);
    L.target.position.copy(p);
    L.position.copy(p).addScaledVector(this.lightDir, dist);
    L.target.updateMatrixWorld();
  }

  triggerFlash(strength = 1) {
    this.flash = Math.max(this.flash, strength);
  }
}

