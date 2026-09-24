// Luft-Perspektive ("Atmosphäre") für ALLE Materialien mit Nebel:
//  1) Höhen-Dunst: Die Luft ist unten dichter als oben. Täler sind dunstig,
//     hohe Gipfel bleiben klar. Bei Wetter "Nebel" liegt der Nebel am Boden.
//  2) Sonne im Dunst: In Richtung Sonne leuchtet der Dunst warm auf
//     (wie in echt am Morgen und am Abend).
// Dazu werden die Nebel-Bausteine (ShaderChunks) von three.js ersetzt.
// Ohne die zusätzlichen Uniforms verhält sich der Nebel wie vorher.
import * as THREE from 'three';

export const ATMOSPHERE = {
  uAtmSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uAtmSunColor: { value: new THREE.Color(0, 0, 0) },
  uAtmFalloff: { value: 0 }, // 1 / Höhe, auf der der Dunst auf ~37 % abnimmt (0 = überall gleich dicht)
};

/** Uniforms in einen Shader einhängen (für Materialien mit eigenem onBeforeCompile). */
export function addAtmosphereUniforms(shader) {
  if (shader.uniforms && shader.uniforms.fogColor) Object.assign(shader.uniforms, ATMOSPHERE);
}

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // Welt-Position aus der Kamera-Position (die Kamera-Matrix ist nur gedreht + verschoben)
  vFogWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition;
#endif
`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  uniform vec3 uAtmSunDir;
  uniform vec3 uAtmSunColor;
  uniform float uAtmFalloff;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 fogRay = vFogWorld - cameraPosition;
  float fogDist = max(length(fogRay), 0.001);
  #ifdef FOG_EXP2
    // Mittlere Luftdichte entlang des Blicks (exakte Lösung für exponentiell abnehmende Dichte)
    // Dichte ~ exp(-k * Höhe); Mittelwert zwischen Kamera-Höhe h0 und Punkt-Höhe h1
    float fogK = uAtmFalloff;
    float fogHf = 1.0;
    if (fogK > 0.0) {
      float h0 = max(cameraPosition.y, 0.0);
      float h1 = max(vFogWorld.y, 0.0);
      float e0 = exp(-fogK * h0);
      fogHf = abs(h1 - h0) < 1.0 ? e0 : (e0 - exp(-fogK * h1)) / (fogK * (h1 - h0));
    }
    float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth * fogHf);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  // Sonnenlicht wird im Dunst gestreut → heller Schein in Richtung Sonne
  float fogMu = max(dot(fogRay / fogDist, uAtmSunDir), 0.0);
  vec3 fogCol = fogColor + uAtmSunColor * (0.3 * pow(fogMu, 5.0) + 0.55 * pow(fogMu, 36.0));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFactor);
#endif
`;

// Alle Materialien ohne eigenes onBeforeCompile bekommen die Uniforms automatisch.
THREE.Material.prototype.onBeforeCompile = function (shader) {
  addAtmosphereUniforms(shader);
};
