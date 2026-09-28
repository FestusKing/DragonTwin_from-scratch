// Gras: Grashalme rund um die Kamera, die sich im Wind wiegen.
//
// So funktioniert es:
//  - Ein Büschel = 3 "Gras-Karten" (senkrechte Flächen mit einem Bild voller Halme).
//    So wirkt die Wiese dicht, und die Grafikkarte hat trotzdem wenig zu tun.
//  - Ein Stück Wiese (Kachel, z. B. 110 × 110 m) mit vielen Grasbüscheln wird immer
//    um die Kamera herum gezeichnet. Fliegt man weiter, "springen" Büschel vom hinteren
//    Rand nach vorne – dort sind sie aber unsichtbar klein. Für das Auge steht jedes
//    Büschel fest an seinem Platz.
//  - Alles Weitere rechnet die Grafikkarte (im Vertex-Shader):
//    Höhe des Bodens, wo Gras wächst (nicht auf Fels, Sand, Wegen, Asche, Schnee),
//    Farbe wie der Boden darunter, Wind, Luftstoss der Drachenflügel, verbranntes Gras.
//  - Weizenfelder bekommen goldene, höhere Halme.
// Bei Qualität "Niedrig" gibt es kein Gras (spart Leistung).
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';
import { HALF, WORLD_SIZE } from './Terrain.js';
import { addAtmosphereUniforms } from '../fx/Atmosphere.js';

const CARDS = 3; // Gras-Karten pro Büschel (verstreut, zufällige Richtung)
const ROWS = 3; // Punkte-Reihen pro Karte (unten, Mitte, oben) → biegt sich weich
const CARD_W = 1.3; // Breite einer Karte (m)

/**
 * Bild mit vielen Halmen (hell/dunkel, ohne Farbe – die Farbe kommt vom Boden darunter).
 * Als DataTexture: So bekommen durchsichtige Pixel eine Grasfarbe statt Schwarz
 * → keine dunklen Ränder, wenn das Bild aus der Ferne verkleinert wird.
 */
function grassTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(5);
  for (let i = 0; i < 52; i++) {
    const x0 = 10 + rnd() * (S - 20);
    const h = S * (0.4 + rnd() * 0.58);
    const w = 2.5 + rnd() * 3.5;
    const lean = (rnd() - 0.5) * 0.55 * h;
    const tipX = x0 + lean;
    const tipY = S - h;
    const midX = x0 + lean * 0.35;
    const l0 = 0.42 + rnd() * 0.12;
    const l1 = 0.88 + rnd() * 0.12;
    const grad = g.createLinearGradient(0, S, 0, tipY);
    grad.addColorStop(0, `rgb(${255 * l0 * 0.92},${255 * l0},${255 * l0 * 0.85})`);
    grad.addColorStop(1, `rgb(${255 * l1},${255 * l1},${255 * l1 * 0.86})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, S);
    g.quadraticCurveTo(midX - w * 0.55, S - h * 0.5, tipX, tipY);
    g.quadraticCurveTo(midX + w * 0.55, S - h * 0.5, x0 + w, S);
    g.closePath();
    g.fill();
  }
  const img = g.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(img.length);
  for (let k = 0; k < img.length; k += 4) {
    const a = img[k + 3];
    // durchsichtige Pixel: mittleres Grau statt Schwarz (für saubere Mipmaps)
    data[k] = a ? img[k] : 170;
    data[k + 1] = a ? img[k + 1] : 180;
    data[k + 2] = a ? img[k + 2] : 150;
    data[k + 3] = a;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Ein Büschel: 3 senkrechte Gras-Karten, verstreut (y = 0 unten … 1 oben) */
function makeTuftGeometry() {
  const rnd = mulberry32(21);
  const pos = [];
  const nor = [];
  const uv = [];
  const shape = [];
  const idx = [];
  for (let q = 0; q < CARDS; q++) {
    // Karten NICHT sternförmig kreuzen (sähe von oben aus wie ✳), sondern
    // verstreut und in zufälliger Richtung → von oben wirken sie wie einzelne Halme
    const a = (q / CARDS) * Math.PI + rnd() * 1.1;
    const fx = Math.cos(a);
    const fz = Math.sin(a);
    const oa = (q / CARDS) * Math.PI * 2 + rnd() * 1.5;
    const or = 0.35 + rnd() * 0.45;
    const ox = Math.cos(oa) * or;
    const oz = Math.sin(oa) * or;
    const w = CARD_W * (0.8 + rnd() * 0.4) * 0.5;
    const hf = 0.75 + rnd() * 0.25; // Höhe der Karte (relativ)
    const la = rnd() * Math.PI * 2; // Richtung, in die sich die Halme neigen
    const lean = 0.05 + rnd() * 0.15;
    const flip = rnd() < 0.5; // Bild gespiegelt → weniger Wiederholung
    const base = pos.length / 3;
    for (let r = 0; r < ROWS; r++) {
      const t = r / (ROWS - 1);
      for (const side of [-1, 1]) {
        pos.push(ox + fx * w * side, t, oz + fz * w * side);
        nor.push(-fz, 0, fx);
        uv.push(flip ? (1 - side) / 2 : (1 + side) / 2, 1 - t); // DataTexture: Zeile 0 = oben im Bild
        shape.push(Math.cos(la) * lean, Math.sin(la) * lean, hf);
      }
    }
    for (let r = 0; r < ROWS - 1; r++) {
      const i0 = base + r * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 3));
  g.setIndex(idx);
  return g;
}

// ----- Shader-Teile (werden in das normale three.js-Material eingesetzt) -----

const GRASS_PARS = /* glsl */ `
uniform sampler2D uHeight;   // Bodenhöhe (Float, ein Wert pro Gitterpunkt)
uniform sampler2D uSplat, uRegion, uScorch, uForest, uDetail;
uniform vec3 cGrassA, cGrassB, cForest, cWheat, cCrop;
uniform float uSize, uHalf, uCell, uTile, uRadius, uTime, uWindStr;
uniform vec3 uCam;           // Kamera (Welt)
uniform vec2 uWindDir;       // Windrichtung (Länge 1)
uniform vec4 uPush;          // Luftstoss der Flügel: x, z, Radius, Stärke
attribute vec4 aTuft;        // Platz in der Kachel (x, z) + zwei Zufallszahlen
attribute vec3 aShape;       // Neigung der Karte (x, z) + Höhe
attribute vec2 aUv;          // Stelle im Gras-Bild
varying vec3 vGrassCol;
varying vec2 vGrassUv;

// Bodenhöhe genau wie das Boden-Gitter (zwei Dreiecke pro Zelle) + Normale
float grassGround(vec2 xz, out vec3 n) {
  vec2 g = (xz + uHalf) / uCell;
  int last = int(uSize / uCell) - 1;
  ivec2 i = clamp(ivec2(floor(g)), ivec2(0), ivec2(last));
  vec2 f = clamp(g - vec2(i), 0.0, 1.0);
  float a = texelFetch(uHeight, i, 0).r;
  float b = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeight, i + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  float hx;
  float hz;
  float h;
  if (f.x + f.y <= 1.0) {
    hx = b - a; hz = c - a; h = a + hx * f.x + hz * f.y;
  } else {
    hx = d - c; hz = d - b; h = d - hx * (1.0 - f.x) - hz * (1.0 - f.y);
  }
  n = normalize(vec3(-hx / uCell, 1.0, -hz / uCell));
  return h;
}
vec2 grassRot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;

// Läuft vor allem anderen im Vertex-Shader: alles, was für das ganze Büschel gilt
const GRASS_TUFT = /* glsl */ `
// Platz in der Welt: Kachel um die Kamera, jedes Büschel bleibt an seinem Ort
vec2 gHalf = vec2(uTile * 0.5);
vec2 gXZ = uCam.xz - gHalf + mod(aTuft.xy - (uCam.xz - gHalf), uTile);
vec3 gN = vec3(0.0, 1.0, 0.0);
float gY = 0.0;
float gH = 0.0;
float gFade = 0.0;
float gKeep = 0.0;
float gFar = 1.0;
float gBurnt = 0.0;
vec2 gBend = vec2(0.0);
vec3 gTint = vec3(0.0);
float gRotA = aTuft.w * 6.2832;
// Büschel ausserhalb der Sichtweite: gar nichts rechnen (spart viel Arbeit)
if (length(gXZ - uCam.xz) < uRadius) {
  gY = grassGround(gXZ, gN);
  float gDist = length(vec3(gXZ.x, gY, gXZ.y) - uCam);
  gFade = smoothstep(uRadius, uRadius * 0.55, gDist);

  // Wo wächst Gras? (gleiche Regeln wie der Boden-Shader)
  vec2 gSuv = vec2(gXZ.x / uSize + 0.5, 0.5 - gXZ.y / uSize);
  vec2 gRuv = vec2(gXZ.x / uSize + 0.5, gXZ.y / uSize + 0.5);
  vec4 gSplat = textureLod(uSplat, gSuv, 0.0);
  vec4 gRegion = textureLod(uRegion, gRuv, 0.0);
  float gScorch = textureLod(uScorch, gRuv, 0.0).r;
  float gForest = min(1.0, textureLod(uForest, gSuv, 0.0).r);
  float gN1 = textureLod(uDetail, gXZ * 0.0045, 0.0).r * 2.0 - 1.0;
  float gN2 = textureLod(uDetail, gXZ * 0.0009, 0.0).r * 2.0 - 1.0;
  float gGrow = 1.0 - smoothstep(0.1, 0.22, 1.0 - gN.y + gN1 * 0.06); // Fels
  gGrow *= smoothstep(3.5, 6.5, gY + gN1 * 2.0);                       // Strand
  gGrow *= 1.0 - smoothstep(170.0, 290.0, gY + gN1 * 70.0);            // hoch oben karg
  gGrow *= (1.0 - gRegion.r) * (1.0 - gRegion.b) * (1.0 - gRegion.g * 0.8); // Asche, Lava, Schlucht
  gGrow *= 1.0 - smoothstep(0.08, 0.4, gSplat.r);                      // Wege
  gGrow *= 1.0 - gForest * 0.4;                                        // Waldboden: weniger
  // weiter weg: weniger Büschel, dafür etwas grössere
  gFar = smoothstep(uRadius * 0.2, uRadius, gDist);
  gKeep = step(aTuft.z, gGrow * mix(1.0, 0.35, gFar));

  // Höhe: Weizen hoch, Gemüsefelder niedrig, verbrannt = kurze schwarze Stoppeln
  float gWheat = gSplat.g;
  float gCrop = gSplat.b;
  gBurnt = smoothstep(0.12, 0.45, gScorch);
  gH = mix(0.7, 1.1, aTuft.w) * mix(1.0, 1.45, gWheat) * mix(1.0, 0.65, gCrop);
  gH *= mix(1.0, 1.5, gFar) * (1.0 - gBurnt * 0.8) * gFade * gKeep;

  // Wind: Böen laufen als Wellen über die Wiese, dazu leichtes Flattern
  float gGust = 0.5 + 0.5 * sin(dot(gXZ, uWindDir) * 0.11 - uTime * (1.7 + uWindStr * 2.0) + gN2 * 5.0);
  gBend = uWindDir * (0.08 + uWindStr * 0.55) * (0.3 + 0.7 * gGust);
  gBend += vec2(-uWindDir.y, uWindDir.x) * sin(uTime * 3.3 + aTuft.z * 40.0) * (0.03 + uWindStr * 0.05);
  // Luftstoss der Drachenflügel: Gras legt sich vom Drachen weg
  vec2 gPd = gXZ - uPush.xy;
  float gPl = length(gPd);
  float gPush = uPush.w * smoothstep(uPush.z, uPush.z * 0.1, gPl);
  gBend += gPd / max(gPl, 0.5) * gPush * (1.0 + 0.3 * sin(uTime * 13.0 - gPl * 0.6));
  float gBl = length(gBend);
  if (gBl > 1.2) gBend *= 1.2 / gBl;

  // Farbe wie der Boden darunter
  gTint = mix(cGrassA, cGrassB, smoothstep(-0.25, 0.55, gN1 + gN2 * 0.6));
  gTint = mix(gTint, cForest, smoothstep(0.1, 0.6, -gN2) * 0.7);
  gTint = mix(gTint, cWheat * 1.15, gWheat);
  gTint = mix(gTint, cCrop, gCrop);
  gTint *= 1.0 - gForest * 0.45;
  gTint = mix(gTint, gTint * vec3(1.12, 0.95, 0.72), gRegion.g * 0.6);
  gTint *= 0.85 + 0.3 * fract(aTuft.z * 17.3 + aTuft.w * 5.1);
}

// Normale: fast wie der Boden darunter → Gras ist gleich hell wie der Boden
// (senkrechte Karten würden bei tiefer Sonne sonst weiss aufleuchten)
vec3 objectNormal = vec3(0.0, 0.0, 0.0);
objectNormal.xz = grassRot(normal.xz, gRotA) * 0.15;
objectNormal = normalize(objectNormal + gN * 0.85);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

// Form jedes einzelnen Punktes einer Gras-Karte
const GRASS_VERTEX = /* glsl */ `
float gT = position.y;
float gBlade = gH * aShape.z;
vec2 gLean = grassRot(aShape.xy, gRotA) + gBend;
float gDroop = 1.0 - 0.38 * min(dot(gLean, gLean), 1.0); // gebogene Halme werden kürzer
vec3 transformed = vec3(gXZ.x, gY - 0.08, gXZ.y);
transformed.xz += grassRot(position.xz, gRotA) * (gFade * gKeep) * mix(1.0, 1.4, gFar);
transformed.xz += gLean * gBlade * gT * gT;
transformed.y += gT * gBlade * gDroop;
// Farbe: Das Bild ist unten dunkel und oben hell; hier nur Boden-Farbe + etwas Schatten unten
vec3 gCol = gTint * 1.25 * mix(0.8, 1.0, gT);
gCol = mix(gCol, gCol * vec3(1.1, 1.06, 0.8), gT * gT * 0.4);
vGrassCol = mix(gCol, vec3(0.03, 0.025, 0.02), gBurnt);
vGrassUv = aUv;
`;

// Bild der Halme lesen, Rand ausstanzen
const GRASS_FRAGMENT = /* glsl */ `
vec4 gTex = texture2D(uGrassTex, vGrassUv);
// aus der Ferne (kleinere Mipmap) werden die Halme durchsichtiger → Deckkraft anheben
vec2 gTx = vGrassUv * 256.0;
float gLod = 0.5 * log2(max(dot(dFdx(gTx), dFdx(gTx)), dot(dFdy(gTx), dFdy(gTx))));
if (gTex.a * (1.0 + max(gLod, 0.0) * 0.35) < 0.5) discard;
diffuseColor.rgb = vGrassCol * gTex.rgb;
`;

export class Grass {
  /**
   * @param terrain   Terrain (nach buildMesh und setForestMap)
   * @param maxCount  so viele Büschel höchstens (Qualität "Hoch")
   * @param maxRadius so weit höchstens sichtbar (Meter)
   */
  constructor(scene, terrain, maxCount = 24000, maxRadius = 55) {
    this.terrain = terrain;
    this.maxCount = maxCount;
    this.radius = maxRadius;
    this.count = maxCount;

    const tile = maxRadius * 2;
    const geo = makeTuftGeometry();
    // Büschel gleichmässig verteilt (Raster mit Zufall), dazu zwei Zufallszahlen.
    // Die Reihenfolge wird gemischt: So ist jede "erste Teilmenge" (weniger Gras bei
    // tieferer Qualität) trotzdem gleichmässig verteilt.
    const side = Math.ceil(Math.sqrt(maxCount));
    const cell = tile / side;
    const n = side * side;
    const rnd = mulberry32(77);
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const data = new Float32Array(n * 4);
    for (let c = 0; c < n; c++) {
      const k = order[c] * 4;
      data[k] = ((c % side) + rnd()) * cell;
      data[k + 1] = (Math.floor(c / side) + rnd()) * cell;
      data[k + 2] = rnd();
      data[k + 3] = rnd();
    }
    geo.setAttribute('aTuft', new THREE.InstancedBufferAttribute(data, 4));
    geo.instanceCount = n;
    this.geometry = geo;

    // Bodenhöhe als Float-Textur (genau wie das Boden-Gitter)
    const N = terrain.N;
    this.heightTex = new THREE.DataTexture(terrain.heights, N, N, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;

    const tu = terrain.uniforms;
    this.uniforms = {
      uHeight: { value: this.heightTex },
      uSplat: tu.uSplat,
      uRegion: tu.uRegion,
      uScorch: tu.uScorch,
      uForest: tu.uForest,
      uDetail: tu.uDetail,
      cGrassA: tu.cGrassA,
      cGrassB: tu.cGrassB,
      cForest: tu.cForest,
      cWheat: tu.cWheat,
      cCrop: tu.cCrop,
      uSize: { value: WORLD_SIZE },
      uHalf: { value: HALF },
      uCell: { value: terrain.cell },
      uTile: { value: tile },
      uRadius: { value: maxRadius },
      uTime: { value: 0 },
      uWindStr: { value: 0.3 },
      uCam: { value: new THREE.Vector3() },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uPush: { value: new THREE.Vector4(0, 0, 1, 0) },
      uGrassTex: { value: grassTexture() },
    };

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      addAtmosphereUniforms(shader);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_PARS}`)
        .replace('#include <beginnormal_vertex>', GRASS_TUFT)
        .replace('#include <begin_vertex>', GRASS_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uGrassTex;\nvarying vec3 vGrassCol;\nvarying vec2 vGrassUv;')
        .replace('#include <color_fragment>', GRASS_FRAGMENT)
        // beide Seiten eines Halms gleich beleuchten
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        // Gegenlicht: die Sonne scheint durch die Halme (leuchten golden am Abend)
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
  float gBack = max(0.0, dot(geometryViewDir, -directionalLights[0].direction));
  reflectedLight.directDiffuse += directionalLights[0].color * diffuseColor.rgb * pow(gBack, 6.0) * 0.18 * vec3(0.9, 1.0, 0.6);
#endif`
        );
    };
    this.material = mat;

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'Gras';
    this.mesh.frustumCulled = false; // Position rechnet erst die Grafikkarte
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  /** Qualität: count = Anzahl Büschel (0 = kein Gras), radius = Sichtweite (m) */
  setQuality(count, radius) {
    const total = this.geometry.attributes.aTuft.count;
    this.count = Math.max(0, Math.min(count, total));
    this.geometry.instanceCount = Math.max(1, this.count);
    this.radius = Math.min(radius, this.uniforms.uTile.value / 2);
    this.uniforms.uRadius.value = this.radius;
  }

  /**
   * @param ctx { camera, windDir (Vector3, Länge egal), wind (0..1),
   *              pushPos (Vector3|null), push (0..1), pushRadius (m) }
   */
  update(dt, ctx) {
    const cam = ctx.camera.position;
    const agl = cam.y - this.terrain.surfaceAt(cam.x, cam.z);
    // hoch oben sieht man keine Halme mehr → gar nicht zeichnen
    this.mesh.visible = this.count > 0 && agl < this.radius;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(cam);
    const wl = Math.hypot(ctx.windDir.x, ctx.windDir.z);
    if (wl > 1e-4) u.uWindDir.value.set(ctx.windDir.x / wl, ctx.windDir.z / wl);
    u.uWindStr.value = ctx.wind;
    if (ctx.pushPos && ctx.push > 0.001) u.uPush.value.set(ctx.pushPos.x, ctx.pushPos.z, ctx.pushRadius, ctx.push);
    else u.uPush.value.w = 0;
  }
}
