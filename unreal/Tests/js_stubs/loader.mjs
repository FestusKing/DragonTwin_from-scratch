// Node-Lader NUR für den Test: ersetzt zwei Module des Browser-Spiels durch kleine Stellvertreter.
// Grund: Terrain.js und Dragon.js brauchen Vite/Browser (Texturen, Modelle). Die Flugphysik
// braucht davon nur zwei Zahlen: WATER_LEVEL (0) und STAND_HEIGHT (2.62).
export async function resolve(specifier, context, next) {
  const parent = context.parentURL || '';
  if (parent.endsWith('/dragon/FlightPhysics.js')) {
    if (specifier === '../world/Terrain.js') return { url: new URL('./terrain.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier === './Dragon.js') return { url: new URL('./dragon.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
