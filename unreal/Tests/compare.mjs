// Vergleicht die Flugbahnen: Browser-Spiel (JS) gegen C++-Version.
// Grenzen: Position 5 cm, Drehung 0.1°, gleiche Ereignisse (Flügelschlag, Landung …).
import fs from 'node:fs';
import { SCENARIOS } from './scenarios.mjs';

const OUT = new URL('./out/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, OUT), 'utf8').trim().split('\n').map((l) => l.split(' ').map(Number));
const LIM_POS = 0.05; // m
const LIM_ANG = 0.1; // Grad
let ok = true;
console.log('\nFlug             Bilder  max. Abstand   max. Tempo-Diff.  max. Drehung  Ereignisse  Boden/Schweben  Ergebnis');
for (const sc of SCENARIOS) {
  const A = read(`${sc.name}.js.txt`);
  const B = read(`${sc.name}.cpp.txt`);
  let dPos = 0;
  let dVel = 0;
  let dAng = 0;
  let flagDiff = 0;
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const a = A[i];
    const b = B[i];
    dPos = Math.max(dPos, Math.hypot(a[1] - b[1], a[2] - b[2], a[3] - b[3]));
    dVel = Math.max(dVel, Math.hypot(a[4] - b[4], a[5] - b[5], a[6] - b[6]));
    const dot = Math.min(1, Math.abs(a[7] * b[7] + a[8] * b[8] + a[9] * b[9] + a[10] * b[10]));
    dAng = Math.max(dAng, (2 * Math.acos(dot) * 180) / Math.PI);
    if (a[15] !== b[15] || a[16] !== b[16]) flagDiff++;
  }
  const la = A[n - 1];
  const lb = B[n - 1];
  const evA = la.slice(21).join('/');
  const evB = lb.slice(21).join('/');
  const good = A.length === B.length && dPos < LIM_POS && dAng < LIM_ANG && evA === evB && flagDiff === 0;
  if (!good) ok = false;
  console.log(
    `${sc.name.padEnd(16)} ${String(n).padStart(6)}  ${dPos.toExponential(2).padStart(10)} m  ${dVel.toExponential(2).padStart(10)} m/s  ${dAng.toExponential(2).padStart(9)}°  ${(evA === evB ? evA : evA + '≠' + evB).padEnd(10)}  ${String(flagDiff).padStart(6)}          ${good ? 'gleich ✔' : 'ANDERS ✘'}`
  );
}
console.log(ok ? '\nAlle Flüge gleich: Die C++-Version fliegt wie das Browser-Spiel.' : '\nMindestens ein Flug weicht ab!');
process.exit(ok ? 0 : 1);
