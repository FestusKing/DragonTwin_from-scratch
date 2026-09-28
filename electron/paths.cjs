// Welche Datei gehört zu einer app://-Adresse? (eigene Datei, damit man es ohne Electron testen kann)
const path = require('node:path');

/**
 * app://spiel/assets/x.js → <dist>/assets/x.js
 * Gibt null zurück, wenn die Adresse aus dist/ hinausführen würde
 * (z. B. app://spiel/../../geheim.txt) oder zu einem anderen "Host" gehört.
 */
function fileFor(requestUrl, distDir) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'app:' || url.host !== 'spiel') return null;
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(distDir, '.' + rel);
  const inside = path.relative(distDir, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return file;
}

/**
 * Für das Verpacken als Programm (electron/paket.mjs): nur diese Dinge kommen hinein.
 * Alles andere (Quellcode, Werkzeuge, Unreal-Dateien, node_modules …) bleibt draussen.
 */
const KEEP = ['package.json', 'dist', 'electron'];

/** true = diese Datei NICHT ins Programm packen. file = absoluter Pfad (oder relativ mit "/" am Anfang) */
function ignoreForPackage(file, root) {
  const rel = file.startsWith(root) ? path.relative(root, file) : file.replace(/^[\\/]+/, '');
  if (rel === '') return false; // der Projektordner selbst
  const top = rel.split(/[\\/]/)[0];
  return !KEEP.includes(top);
}

module.exports = { fileFor, ignoreForPackage };
