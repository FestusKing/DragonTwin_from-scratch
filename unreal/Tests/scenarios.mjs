// Test-Flüge: gleiche Eingaben für das Browser-Spiel (JS) und die C++-Version.
// Jeder Flug: Startpunkt, Gelände, Wind, Hindernis und Eingaben pro Bild (60 Bilder/s).
const on = (t, a, b) => t >= a && t < b;
const none = () => ({ pitch: 0, move: 0, roll: 0, flap: false, flapPressed: false, dive: false, boost: false, hover: false, land: false });

export const FPS = 60;

export const SCENARIOS = [
  {
    name: 'gleiten',
    text: 'Gleiten ohne Eingabe (Flughilfe an)',
    seconds: 20,
    terrain: 'wellig',
    start: { pos: [0, 300, 0], heading: 0, speed: 35 },
    input: () => none(),
  },
  {
    name: 'kurven',
    text: 'Kurven und Nicken (Flughilfe an)',
    seconds: 30,
    terrain: 'wellig',
    start: { pos: [0, 300, 0], heading: 0.4, speed: 40 },
    input: (t) => ({ ...none(), roll: Math.sin(t * 0.7), pitch: 0.4 * Math.sin(t * 0.45) }),
  },
  {
    name: 'flattern_boost',
    text: 'Flattern, Boost bis erschöpft, Sturzflug',
    seconds: 30,
    terrain: 'wellig',
    start: { pos: [0, 200, 0], heading: 0, speed: 30 },
    input: (t) => ({ ...none(), flap: on(t, 2, 8), boost: on(t, 10, 16), dive: on(t, 18, 24) }),
  },
  {
    name: 'kunstflug',
    text: 'Ohne Flughilfe: Looping, Fassrolle, Flattern',
    seconds: 20,
    terrain: 'wellig',
    assist: false,
    start: { pos: [0, 500, 0], heading: 0, speed: 45 },
    input: (t) => ({
      ...none(),
      pitch: on(t, 1, 4) ? 1 : on(t, 9, 12) ? -0.6 : 0,
      roll: on(t, 6, 7.2) ? 1 : on(t, 9, 12) ? -0.4 : 0,
      flap: on(t, 13, 16),
    }),
  },
  {
    name: 'schweben',
    text: 'Schweben: vor, drehen, hoch, runter, loslassen',
    seconds: 20,
    terrain: 'wellig',
    start: { pos: [0, 150, 0], heading: 0, speed: 30 },
    input: (t) => ({
      ...none(),
      hover: on(t, 1, 12),
      move: on(t, 4, 6) ? 1 : 0,
      roll: on(t, 6, 8) ? 1 : 0,
      flap: on(t, 8, 9),
      dive: on(t, 9, 10),
    }),
  },
  {
    name: 'landen_laufen',
    text: 'Landen (schweben + sinken), laufen, drehen, abheben',
    seconds: 22,
    terrain: 'wellig',
    start: { pos: [0, 45, 0], heading: 0.3, speed: 25 },
    input: (t, frame) => ({
      ...none(),
      hover: t < 9,
      dive: on(t, 3, 9),
      move: on(t, 9, 14) ? 1 : 0,
      roll: on(t, 11, 13) ? 0.6 : 0,
      flapPressed: frame === 14 * FPS,
      flap: on(t, 14, 22),
    }),
  },
  {
    name: 'landetaste',
    text: 'Lande-Taste aus schnellem Flug, dann rennen (Boost), drehen, rückwärts',
    seconds: 24,
    terrain: 'wellig',
    start: { pos: [0, 90, 0], heading: 0.2, speed: 45 },
    input: (t) => ({
      ...none(),
      land: on(t, 1, 12),
      move: on(t, 13, 18) ? 1 : on(t, 20, 22) ? -1 : 0,
      boost: on(t, 15, 18),
      roll: on(t, 16, 19) ? -0.8 : 0,
    }),
  },
  {
    name: 'langsam_steigen',
    text: 'Langsam fliegen und hochziehen (Flughilfe flattert mit), dann Nase runter',
    seconds: 14,
    terrain: 'wellig',
    start: { pos: [0, 200, 0], heading: 0, speed: 22 },
    input: (t) => ({ ...none(), pitch: on(t, 1, 6) ? 1 : on(t, 8, 10) ? -1 : 0 }),
  },
  {
    name: 'wind',
    text: 'Seitenwind und Kurven',
    seconds: 20,
    terrain: 'wellig',
    wind: [6, 0, -4],
    start: { pos: [0, 300, 0], heading: 0, speed: 35 },
    input: (t) => ({ ...none(), roll: 0.6 * Math.sin(t * 0.5) }),
  },
  {
    name: 'hindernis',
    text: 'Gegen ein Gebäude (Kiste) fliegen',
    seconds: 10,
    terrain: 'flach',
    flatH: 20,
    box: { x: 0, y: 30, z: -120, hx: 8, hy: 15, hz: 8, rot: 0.3 },
    start: { pos: [0, 32, 0], heading: 0, speed: 45 },
    input: () => none(),
  },
  {
    name: 'wasser',
    text: 'Auf dem Wasser aufsetzen',
    seconds: 15,
    terrain: 'wasser',
    start: { pos: [0, 40, 0], heading: 0, speed: 30 },
    input: (t) => ({ ...none(), pitch: t < 6 ? -0.5 : 0, hover: on(t, 8, 11) }),
  },
  {
    name: 'rand',
    text: 'Über den Kartenrand hinaus (Zurücklenken)',
    seconds: 30,
    terrain: 'wellig',
    start: { pos: [2700, 400, 0], heading: -Math.PI / 2, speed: 40 },
    input: () => none(),
  },
];

/** Gelände: Höhe und Normale (gleiche Formeln in flight_test.cpp) */
export function terrainFor(sc) {
  if (sc.terrain === 'flach') return { h: () => sc.flatH, n: () => [0, 1, 0] };
  if (sc.terrain === 'wasser') return { h: () => -5, n: () => [0, 1, 0] };
  // wellig
  return {
    h: (x, z) => 20 + 8 * Math.sin(0.01 * x) * Math.cos(0.013 * z),
    n: (x, z) => {
      const dx = 8 * 0.01 * Math.cos(0.01 * x) * Math.cos(0.013 * z);
      const dz = -8 * 0.013 * Math.sin(0.01 * x) * Math.sin(0.013 * z);
      const l = Math.sqrt(dx * dx + 1 + dz * dz);
      return [-dx / l, 1 / l, -dz / l];
    },
  };
}
