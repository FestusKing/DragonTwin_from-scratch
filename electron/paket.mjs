// Baut die Desktop-Version als Ordner mit Programm (Windows: DragonTwin.exe).
// Aufruf: npm run desktop:exe   (baut vorher das Spiel mit vite build)
// Ergebnis: release/DragonTwin-<System>-<Prozessor>/  → diesen GANZEN Ordner weitergeben oder auf Steam hochladen.
// Beim ersten Mal lädt der Packager Electron für dein System herunter (offiziell von GitHub, mit Prüfsumme).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { packager } from '@electron/packager';

const require = createRequire(import.meta.url);
const { ignoreForPackage } = require('./paths.cjs');
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const paths = await packager({
  dir: ROOT,
  name: 'DragonTwin',
  out: path.join(ROOT, 'release'),
  overwrite: true,
  asar: true, // Spieldateien in einem Archiv (weniger lose Dateien)
  prune: false, // node_modules wird gar nicht mitgenommen (das Spiel ist schon fertig gebaut in dist/)
  ignore: (file) => ignoreForPackage(file, ROOT),
  win32metadata: {
    ProductName: 'DragonTwin: Test Flight',
    FileDescription: 'DragonTwin: Test Flight',
  },
});
console.log('\nFertig! Programm-Ordner:');
for (const p of paths) console.log('  ' + p);
