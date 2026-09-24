// Nachbearbeitung (Post-Processing) – wie ein Filter über dem fertigen Bild:
//  1) Bloom: helle Stellen (Feuer, Sonne, Augen) leuchten weich nach
//  2) Farbkorrektur + Vignette (dunkle Ecken) + Tempo-Unschärfe + Wolken-Weiss
//  3) Tone Mapping (ACES Filmic): HDR → Bildschirmfarben, wie bei Kinofilmen
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.45 },
    uSat: { value: 0.92 },
    uTint: { value: new THREE.Color(1.03, 1.0, 0.95) },
    uBlur: { value: 0 },
    uWhite: { value: 0 },
    uWhiteColor: { value: new THREE.Color(0.8, 0.82, 0.86) },
    uDamage: { value: 0 },
    uAberration: { value: 0 },
    uContrast: { value: 1.05 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSat, uBlur, uWhite, uDamage, uAberration, uContrast;
    uniform vec3 uTint, uWhiteColor;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      vec3 col;
      if (uBlur > 0.002) {
        // radiale Unschärfe (Geschwindigkeitsgefühl beim Boost)
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float s = 1.0 - float(i) * uBlur * 0.012;
          col += texture2D(tDiffuse, 0.5 + dir * s).rgb;
        }
        col /= 8.0;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      if (uAberration > 0.001) {
        col.r = mix(col.r, texture2D(tDiffuse, 0.5 + dir * (1.0 + uAberration * 0.01)).r, 0.6);
        col.b = mix(col.b, texture2D(tDiffuse, 0.5 + dir * (1.0 - uAberration * 0.01)).b, 0.6);
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col *= uTint;
      // leichter Kontrast um einen mittleren Grauwert
      col = max(vec3(0.0), (col - 0.18) * uContrast + 0.18);
      col = mix(col, uWhiteColor, uWhite);
      float d = length(dir * vec2(1.0, 0.85));
      float v = smoothstep(0.85, 0.25, d);
      col *= mix(1.0, v, uVignette);
      col = mix(col, col * vec3(1.6, 0.35, 0.3), uDamage * smoothstep(0.25, 0.8, d));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.msaa = 4;
    this.bloomEnabled = true;
    this._build();
  }

  _build() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: this.msaa,
    });
    this.composer?.dispose();
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.5, 0.95);
    this.bloom.enabled = this.bloomEnabled;
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    // FXAA glättet Kanten günstig (wenn kein MSAA aktiv ist) – nach dem Tone Mapping
    this.fxaa = new FXAAPass();
    this.fxaa.enabled = this.msaa === 0;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
    this.composer.addPass(this.fxaa);
  }

  setQuality({ bloom, msaa }) {
    this.bloomEnabled = bloom;
    if (msaa !== this.msaa) {
      this.msaa = msaa;
      this._build();
    }
    this.bloom.enabled = bloom;
    this.fxaa.enabled = this.msaa === 0;
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  /** Effekt-Stärken setzen */
  set({ blur = 0, white = 0, damage = 0, aberration = 0, whiteColor = null }) {
    const u = this.grade.uniforms;
    u.uBlur.value = blur;
    u.uWhite.value = white;
    u.uDamage.value = damage;
    u.uAberration.value = aberration;
    if (whiteColor) u.uWhiteColor.value.copy(whiteColor);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
