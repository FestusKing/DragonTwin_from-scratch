// Kleine Mathe- und Hilfsfunktionen, die überall im Spiel gebraucht werden.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Begrenzt v auf den Bereich [a, b]. */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Lineare Interpolation: t = 0 → a, t = 1 → b. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Weicher Übergang zwischen 0 und 1 (wie GLSL smoothstep). */
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Bildraten-unabhängiges "Nachziehen" eines Wertes.
 * lambda = wie schnell (grösser = schneller). Egal ob 30 oder 144 FPS:
 * das Ergebnis fühlt sich gleich an.
 */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Winkel-Differenz im Bereich [-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Pseudo-Zufallsgenerator mit Startwert (Seed).
 * Gleicher Seed → gleiche Welt bei jedem Start.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zeit in Sekunden → "1:23.45" */
export function formatTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--.--';
  const sign = sec < 0 ? '-' : '';
  sec = Math.abs(sec);
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${sign}${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Wartet auf das nächste Bild (gibt dem Browser Zeit zum Zeichnen). */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Kritisch gedämpfte Feder (wie Unity SmoothDamp) für Vektoren.
 * Perfekt für eine weiche Kamera, die nicht überschwingt.
 */
export function smoothDampVec3(current, target, velocity, smoothTime, dt) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const cx = current.x - target.x;
  const cy = current.y - target.y;
  const cz = current.z - target.z;
  const tx = (velocity.x + omega * cx) * dt;
  const ty = (velocity.y + omega * cy) * dt;
  const tz = (velocity.z + omega * cz) * dt;
  velocity.x = (velocity.x - omega * tx) * exp;
  velocity.y = (velocity.y - omega * ty) * exp;
  velocity.z = (velocity.z - omega * tz) * exp;
  current.x = target.x + (cx + tx) * exp;
  current.y = target.y + (cy + ty) * exp;
  current.z = target.z + (cz + tz) * exp;
  return current;
}

/** Sicheres Lesen/Schreiben im localStorage (kann im Privatmodus fehlen). */
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* egal */
    }
  },
};
