// 2D-Simplex-Rauschen (Noise) – damit erzeugen wir Hügel, Berge, Wälder usw.
// Rauschen = "zufällig, aber weich". Gleicher Input → gleicher Output.
import { mulberry32 } from './utils.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class Noise2D {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Mischen (Fisher-Yates)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Liefert einen Wert zwischen ungefähr -1 und 1. */
  noise(xin, yin) {
    const perm = this.perm;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = GRAD[perm[ii + perm[jj]] & 7];
      t0 *= t0;
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7];
      t1 *= t1;
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7];
      t2 *= t2;
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /**
   * "Fractal Brownian Motion": mehrere Rausch-Schichten übereinander.
   * Grobe Schicht = grosse Hügel, feine Schichten = kleine Details.
   */
  fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * "Erodiertes" Grat-Rauschen (0..1): Wo der Hang schon steil ist, werden die
   * feineren Schichten gedämpft – wie bei echten Bergen, die Wasser und Wetter
   * abgetragen haben. Ergebnis: scharfe Hauptgrate, glatte Flanken, keine
   * "Haifischzähne". Die Steigung wird aus Nachbarwerten geschätzt.
   */
  erodedRidged(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5, erosion = 0.35) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let prev = 1;
    let norm = 0;
    let dx = 0;
    let dy = 0;
    const e = 0.01;
    for (let o = 0; o < octaves; o++) {
      const fx = x * freq;
      const fy = y * freq;
      const n = this.noise(fx, fy);
      const nx = (this.noise(fx + e, fy) - n) / e;
      const ny = (this.noise(fx, fy + e) - n) / e;
      const a = 1 - Math.abs(n);
      const r = a * a;
      const sg = n >= 0 ? 1 : -1;
      // Gedämpft wird mit der Steigung der gröberen Schichten (die grösste bleibt ungedämpft)
      sum += (r * amp * prev) / (1 + erosion * (dx * dx + dy * dy));
      // Steigung dieser Schicht (in Einheiten der Grund-Frequenz) aufsummieren
      dx += -2 * a * sg * nx * freq * amp * prev;
      dy += -2 * a * sg * ny * freq * amp * prev;
      norm += amp;
      prev = r;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Grat-Rauschen: ergibt scharfe Bergkämme (0..1). */
  ridged(x, y, octaves = 5, lacunarity = 2.1, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let prev = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise(x * freq, y * freq));
      n *= n;
      sum += n * amp * prev;
      norm += amp;
      prev = n;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
