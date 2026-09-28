// Nachbearbeitung (Post-Processing) – wie ein Filter über dem fertigen Bild:
//  1) Bloom: helle Stellen (Feuer, Sonne, Augen) leuchten weich nach
//  2) Sonnenstrahlen (God Rays) + Linsen-Reflexe, wenn man in die Sonne schaut
//  3) Farbkorrektur + Vignette (dunkle Ecken) + Tempo-Unschärfe + Wolken-Weiss
//  4) Tone Mapping (ACES Filmic): HDR → Bildschirmfarben, wie bei Kinofilmen
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Sonnenstrahlen ("God Rays") in halber Auflösung – spart Leistung, und die Strahlen
 * sind sowieso weich. Für jeden Pixel: Richtung Sonne gehen und zählen, wie viel
 * freier Himmel rund um die Sonne auf dem Weg liegt. Berge, Bäume, Wolken und
 * Drachenflügel davor verdecken ihn → dunkle Streifen, dazwischen helle Lichtbahnen.
 * "Freier Himmel" erkennt man an der Tiefe: dort wurde nichts gezeichnet (Tiefe = 1).
 */
class SunRaysPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false; // schreibt in ein eigenes Bild, das Hauptbild bleibt
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 16 / 9 },
        uSkyRef: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tDepth;
        uniform vec2 uSunPos;
        uniform float uAspect, uSkyRef;
        varying vec2 vUv;

        // Lichtquelle: freier Himmel nahe der Sonne. Wolken vor der Sonne sind dunkler
        // als klarer Himmel (uSkyRef) → sie halten einen Teil des Lichts zurück.
        float source(vec2 p) {
          float sky = step(0.9999999, texture2D(tDepth, p).x);
          float l = dot(texture2D(tDiffuse, p).rgb, vec3(0.2126, 0.7152, 0.0722));
          vec2 q = (p - uSunPos) * vec2(uAspect, 1.0);
          return sky * smoothstep(0.35, 1.0, l / uSkyRef) * exp(-dot(q, q) * 22.0);
        }

        void main() {
          vec2 toPix = vUv - uSunPos;
          float dist = length(toPix * vec2(uAspect, 1.0));
          // nur das Stück nahe der Sonne abtasten (weiter weg liegt kein Licht mehr)
          vec2 seg = toPix * min(1.0, 0.45 / max(dist, 1e-4));
          // zufälliger Start pro Pixel: weiches Rauschen statt harter Stufen
          float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float sum = 0.0;
          for (int i = 0; i < 32; i++) sum += source(uSunPos + seg * ((float(i) + jit) / 32.0));
          gl_FragColor = vec4(vec3(sum / 32.0 * exp(-dist * 1.4)), 1.0);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
    this.active = false;
  }

  setSize(w, h) {
    this.target.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.active) return;
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.55 },
    uSat: { value: 0.92 },
    uTint: { value: new THREE.Color(1.03, 1.0, 0.95) },
    uBlur: { value: 0 },
    uWhite: { value: 0 },
    uWhiteColor: { value: new THREE.Color(0.8, 0.82, 0.86) },
    uDamage: { value: 0 },
    uAberration: { value: 0 },
    uContrast: { value: 1.14 },
    uSplit: { value: 0.8 },
    uFade: { value: 0 }, // 1 = ganz schwarz (Absturz-Szene)
    // Sonne auf dem Bildschirm (0..1), ihre Farbe, Stärke der Strahlen und Reflexe
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
    tRays: { value: null },
    uRays: { value: 0 },
    uFlare: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tRays;
    uniform float uVignette, uSat, uBlur, uWhite, uDamage, uAberration, uContrast, uSplit, uFade;
    uniform vec3 uTint, uWhiteColor;
    uniform vec2 uSunPos;
    uniform vec3 uSunCol;
    uniform float uRays, uFlare, uAspect;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // Ist die Sonnenscheibe frei? (1 = frei, 0 = hinter Berg, Wolke oder Drache)
    float sunVisible() {
      vec2 o = vec2(0.007 / uAspect, 0.007);
      float v = smoothstep(2.0, 6.0, luma(texture2D(tDiffuse, uSunPos).rgb));
      v += smoothstep(2.0, 6.0, luma(texture2D(tDiffuse, uSunPos + vec2(o.x, 0.0)).rgb));
      v += smoothstep(2.0, 6.0, luma(texture2D(tDiffuse, uSunPos - vec2(o.x, 0.0)).rgb));
      v += smoothstep(2.0, 6.0, luma(texture2D(tDiffuse, uSunPos + vec2(0.0, o.y)).rgb));
      v += smoothstep(2.0, 6.0, luma(texture2D(tDiffuse, uSunPos - vec2(0.0, o.y)).rgb));
      return v / 5.0;
    }

    // Ein Linsen-Reflex: heller Kreis mit etwas hellerem Rand, auf der Linie Sonne → Bildmitte
    float ghost(vec2 uv, float t, float r) {
      vec2 c = uSunPos + (vec2(0.5) - uSunPos) * t;
      float d = length((uv - c) * vec2(uAspect, 1.0));
      return smoothstep(r, r * 0.6, d) * (0.5 + 0.5 * smoothstep(r * 0.3, r * 0.95, d));
    }

    // Linsen-Reflexe wie bei einer echten Kamera, die in die Sonne filmt
    vec3 lensFlare(vec2 uv) {
      vec3 f = vec3(0.0);
      f += vec3(1.0, 0.7, 0.4) * ghost(uv, 0.42, 0.028) * 0.22;
      f += vec3(0.4, 0.65, 1.0) * ghost(uv, 1.18, 0.075) * 0.08;
      f += vec3(0.55, 1.0, 0.65) * ghost(uv, 1.42, 0.022) * 0.2;
      f += vec3(0.8, 0.5, 1.0) * ghost(uv, 1.75, 0.13) * 0.045;
      f += vec3(1.0, 0.85, 0.55) * ghost(uv, 2.1, 0.042) * 0.12;
      vec2 q = (uv - uSunPos) * vec2(uAspect, 1.0);
      float d = length(q);
      // Ring um die Sonne (schwach, leicht bunt)
      f += vec3(0.45, 0.7, 1.0) * smoothstep(0.025, 0.0, abs(d - 0.36)) * 0.035;
      // Strahlenkranz direkt an der Sonne (6 Zacken)
      float star = pow(abs(cos(atan(q.y, q.x) * 3.0)), 80.0);
      f += star * exp(-d * 11.0) * 0.9;
      // waagrechter Streifen (wie bei Kino-Objektiven)
      f += exp(-abs(q.y) * 170.0) * exp(-abs(q.x) * 2.8) * 0.3;
      return f * uSunCol;
    }

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
      if (uRays > 0.001) col += uSunCol * (texture2D(tRays, uv).r * uRays);
      if (uFlare > 0.001) col += lensFlare(uv) * (uFlare * sunVisible());
      float l = luma(col);
      col = mix(vec3(l), col, uSat);
      col *= uTint;
      // Split-Toning (Kino-Look): Schatten leicht blaugrün, helle Stellen leicht warm
      vec3 split = mix(vec3(0.93, 1.0, 1.07), vec3(1.05, 1.0, 0.93), smoothstep(0.04, 0.55, l));
      col *= mix(vec3(1.0), split, uSplit);
      // leichter Kontrast um einen mittleren Grauwert
      col = max(vec3(0.0), (col - 0.18) * uContrast + 0.18);
      col = mix(col, uWhiteColor, uWhite);
      float d = length(dir * vec2(1.0, 0.85));
      float v = smoothstep(0.85, 0.25, d);
      col *= mix(1.0, v, uVignette);
      col = mix(col, col * vec3(1.6, 0.35, 0.3), uDamage * smoothstep(0.25, 0.8, d));
      col *= 1.0 - uFade;
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
      // Tiefe als Textur: die Sonnenstrahlen erkennen daran den freien Himmel
      depthTexture: new THREE.DepthTexture(size.x * pr, size.y * pr),
    });
    this.composer?.dispose();
    this.rays?.dispose();
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.5, 0.95);
    this.bloom.enabled = this.bloomEnabled;
    this.rays = new SunRaysPass();
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.tRays.value = this.rays.target.texture;
    this.output = new OutputPass();
    // FXAA glättet Kanten günstig (wenn kein MSAA aktiv ist) – nach dem Tone Mapping
    this.fxaa = new FXAAPass();
    this.fxaa.enabled = this.msaa === 0;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.rays);
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
  set({ blur = 0, white = 0, damage = 0, aberration = 0, whiteColor = null, night = 0, fade = 0 }) {
    const u = this.grade.uniforms;
    u.uFade.value = fade;
    // Tag: kräftige Farben. Nachts: weniger Farbe, kühler Blauton (wie Mondlicht)
    u.uSat.value = 1.04 - night * 0.34;
    u.uTint.value.setRGB(1.02 - night * 0.2, 1.0 - night * 0.06, 0.97 + night * 0.2);
    u.uSplit.value = 0.8 - night * 0.4;
    u.uBlur.value = blur;
    u.uWhite.value = white;
    u.uDamage.value = damage;
    u.uAberration.value = aberration;
    if (whiteColor) u.uWhiteColor.value.copy(whiteColor);
  }

  /**
   * Sonne für Strahlen und Linsen-Reflexe.
   * x, y = Bildschirm (0..1), color = Sonnenfarbe, rays/flare = Stärke (0 = aus)
   */
  setSun(x, y, color, rays, flare, aspect, skyRef = 1) {
    const u = this.grade.uniforms;
    u.uSunPos.value.set(x, y);
    u.uSunCol.value.copy(color);
    // Strahlen kosten Leistung: bei "Niedrig" (ohne Bloom) aus
    u.uRays.value = this.bloomEnabled ? rays : 0;
    u.uFlare.value = flare;
    u.uAspect.value = aspect;
    const r = this.rays;
    r.active = u.uRays.value > 0.001;
    r.material.uniforms.uSunPos.value.set(x, y);
    r.material.uniforms.uAspect.value = aspect;
    r.material.uniforms.uSkyRef.value = skyRef;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
