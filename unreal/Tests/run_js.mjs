// Führt die ORIGINAL-Flugphysik des Browser-Spiels (src/dragon/FlightPhysics.js) mit den
// Test-Flügen aus und schreibt für jeden Flug drei Dateien nach out/:
//   <name>.env  – Startpunkt, Gelände, Wind, Hindernis (für die C++-Version)
//   <name>.in   – Eingaben pro Bild
//   <name>.js.txt – Ergebnis pro Bild (Position, Tempo, Drehung, Zustand, Ereignisse)
// Start: node --import ./js_stubs/register.mjs run_js.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { FlightPhysics } from '../../src/dragon/FlightPhysics.js';
import { Colliders } from '../../src/world/Colliders.js';
import { SCENARIOS, FPS, terrainFor } from './scenarios.mjs';

const OUT = new URL('./out/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function stateLine(t, P, ev) {
  const p = P.position;
  const v = P.velocity;
  const q = P.quaternion;
  return [
    t, p.x, p.y, p.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w,
    P.stamina, P.flapPhase, P.flapAmp, P.fold, num(P.grounded), num(P.hovering), P.walkSpeed, P.bank, P.yawRate, P.agl,
    ev.flap, ev.impact, ev.land, ev.takeoff, ev.splash,
  ].join(' ');
}

for (const sc of SCENARIOS) {
  const T = terrainFor(sc);
  const terrain = {
    heightAt: (x, z) => T.h(x, z),
    normalAt: (x, z, out) => out.set(...T.n(x, z)),
  };
  let colliders = null;
  if (sc.box) {
    colliders = new Colliders();
    const b = sc.box;
    colliders.addBox(b.x, b.y, b.z, b.hx, b.hy, b.hz, b.rot);
  }
  const wind = new THREE.Vector3(...(sc.wind || [0, 0, 0]));
  const assist = sc.assist !== false;
  const env = { terrain, colliders, wind, assist, turbulence: 0 };

  const P = new FlightPhysics();
  const ev = { flap: 0, impact: 0, land: 0, takeoff: 0, splash: 0 };
  P.events = {
    flap: () => ev.flap++,
    impact: () => ev.impact++,
    land: () => ev.land++,
    takeoff: () => ev.takeoff++,
    splash: () => ev.splash++,
  };
  const s = sc.start;
  P.reset(new THREE.Vector3(...s.pos), s.heading, s.speed);

  const b = sc.box;
  const envLines = [
    `seconds ${sc.seconds}`,
    `terrain ${sc.terrain}`,
    `flatH ${sc.flatH ?? 0}`,
    `start ${s.pos.join(' ')} ${s.heading} ${s.speed}`,
    `assist ${assist ? 1 : 0}`,
    `wind ${wind.x} ${wind.y} ${wind.z}`,
    `box ${b ? `1 ${b.x} ${b.y} ${b.z} ${b.hx} ${b.hy} ${b.hz} ${b.rot}` : '0 0 0 0 0 0 0 0'}`,
  ];
  const inLines = [];
  const outLines = [];
  const frames = sc.seconds * FPS;
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    const inp = sc.input(t, f);
    inLines.push([inp.pitch, inp.roll, num(inp.flap), num(inp.flapPressed), num(inp.dive), num(inp.boost), num(inp.hover)].join(' '));
    P.update(1 / FPS, inp, env);
    outLines.push(stateLine(t + 1 / FPS, P, ev));
  }
  fs.writeFileSync(new URL(`${sc.name}.env`, OUT), envLines.join('\n') + '\n');
  fs.writeFileSync(new URL(`${sc.name}.in`, OUT), inLines.join('\n') + '\n');
  fs.writeFileSync(new URL(`${sc.name}.js.txt`, OUT), outLines.join('\n') + '\n');
  console.log(`JS  ${sc.name.padEnd(15)} ${frames} Bilder`);
}
