// Test für die Desktop-Version (läuft ohne Electron): node electron/test.mjs
//  1) app://-Adressen → richtige Datei in dist/, nichts ausserhalb (Sicherheit)
//  2) Beim Verpacken kommen nur dist/, electron/ und package.json ins Programm
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fileFor, ignoreForPackage } = require('./paths.cjs');
const ROOT = path.resolve('/projekt');
const DIST = path.join(ROOT, 'dist');
let fails = 0;
const check = (ok, text) => {
  console.log(`${ok ? '  ok  ' : 'FEHLER'} ${text}`);
  if (!ok) fails++;
};

console.log('app:// → Datei');
check(fileFor('app://spiel/index.html', DIST) === path.join(DIST, 'index.html'), 'Startseite');
check(fileFor('app://spiel/', DIST) === path.join(DIST, 'index.html'), 'Ordner → index.html');
check(fileFor('app://spiel/assets/index-abc.js', DIST) === path.join(DIST, 'assets', 'index-abc.js'), 'Spiel-Code');
check(fileFor('app://spiel/models/dragon_scales.glb', DIST) === path.join(DIST, 'models', 'dragon_scales.glb'), 'Drachen-Modell');
check(fileFor('app://spiel/textures/gras%20neu.jpg', DIST) === path.join(DIST, 'textures', 'gras neu.jpg'), 'Leerzeichen im Namen');
// Wichtig ist: NIE eine Datei ausserhalb von dist/ (entweder gesperrt oder innerhalb von dist/)
const safe = (u) => {
  const f = fileFor(u, DIST);
  return f === null || f.startsWith(DIST + path.sep);
};
check(safe('app://spiel/../../geheim.txt'), '../ → nie ausserhalb von dist/');
check(safe('app://spiel/%2e%2e/%2e%2e/geheim.txt'), 'versteckte ../ (%2e%2e) → nie ausserhalb von dist/');
check(fileFor('app://spiel/..%2f..%2fgeheim.txt', DIST) === null, 'versteckte ../ (%2f) → gesperrt');
check(safe('app://spiel/assets/..%2f..%2f..%2fgeheim.txt'), 'gemischt → nie ausserhalb von dist/');
check(safe('app://spiel/%5c..%5c..%5cgeheim.txt'), 'Windows-Trenner (%5c) → nie ausserhalb von dist/');
check(fileFor('app://anders/index.html', DIST) === null, 'fremder Host → gesperrt');
check(fileFor('https://example.com/x.js', DIST) === null, 'Internet-Adresse → gesperrt');
check(fileFor('app://spiel/%E0%A4%A', DIST) === null, 'kaputte Adresse → gesperrt');

console.log('\nVerpacken: was kommt ins Programm?');
const keep = (rel) => !ignoreForPackage(path.join(ROOT, rel), ROOT);
check(keep(''), 'Projektordner selbst');
check(keep('package.json'), 'package.json');
check(keep('dist/index.html') && keep('dist/assets/a.js'), 'dist/ (fertiges Spiel)');
check(keep('electron/main.cjs') && keep('electron/paths.cjs'), 'electron/ (Startprogramm)');
check(!keep('src/main.js'), 'src/ bleibt draussen');
check(!keep('node_modules/three/build/three.module.js'), 'node_modules/ bleibt draussen');
check(!keep('unreal/README.md') && !keep('tools/build_dragon.py') && !keep('docs/UNREAL.md'), 'unreal/, tools/, docs/ bleiben draussen');
check(!keep('README.md') && !keep('CLAUDE.md') && !keep('.git/config'), 'README, CLAUDE.md, .git bleiben draussen');
check(!keep('release/DragonTwin-win32-x64/x.exe'), 'release/ (altes Ergebnis) bleibt draussen');
check(!ignoreForPackage('/dist/index.html', ROOT) && ignoreForPackage('/src/main.js', ROOT), 'auch relative Pfade ("/dist/…")');

console.log(fails ? `\n${fails} Fehler!` : '\nAlles richtig.');
process.exit(fails ? 1 : 0);
