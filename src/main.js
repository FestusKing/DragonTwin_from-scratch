// Einstiegspunkt: Renderer erstellen, Welt laden, Hauptschleife starten.
import * as THREE from 'three';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import './ui/styles.css';
import { Game } from './core/Game.js';

const $ = (id) => document.getElementById(id);

function showError(msg) {
  $('load-text').textContent = msg;
  $('load-text').style.color = '#ff8a7a';
}

async function start() {
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) {
    showError('WebGL wird nicht unterstützt. Bitte einen aktuellen Browser (Chrome, Edge, Firefox) verwenden.');
    return;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const game = new Game(renderer);
  window.__game = game; // zum Ausprobieren in der Browser-Konsole

  // Tipps auf dem Ladebildschirm
  const tips = [
    'Tipp: Tempo erzeugt Auftrieb – wer zu langsam fliegt, sackt ab.',
    'Tipp: Im Sturzflug wird der Drache richtig schnell.',
    'Tipp: Regen löscht Brände.',
    'Tipp: Irgendwo verstecken sich Ziegen … hör genau hin!',
    'Tipp: Mit gedrückter Maustaste kannst du dich umsehen.',
  ];
  $('load-tip').textContent = tips[Math.floor(Math.random() * tips.length)];

  try {
    await game.init((p, text) => {
      $('load-fill').style.width = `${Math.round(p * 100)}%`;
      if (text) $('load-text').textContent = text;
    });
  } catch (e) {
    console.error(e);
    showError('Fehler beim Laden: ' + e.message);
    return;
  }

  // Start-Knopf (der Browser erlaubt Ton erst nach einem Klick)
  const btn = $('btn-start');
  btn.classList.remove('hidden');
  btn.focus();
  $('load-text').textContent = 'Bereit! Klicke auf „Los geht\'s" (oder Enter).';
  btn.addEventListener('click', () => game.enterMenu(), { once: true });

  window.addEventListener('resize', () => game.resize());
  // Schutz vor versehentlichem Schliessen (z. B. Strg+W) während des Fluges
  window.addEventListener('beforeunload', (e) => {
    if (game.state === 'play' || game.state === 'race') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // Tab im Hintergrund → Pause
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    const dt = Math.min(timer.getDelta(), 0.05);
    try {
      game.update(dt);
    } catch (e) {
      console.error(e);
      renderer.setAnimationLoop(null);
      showError('Laufzeitfehler: ' + e.message);
      document.getElementById('screen-loading').classList.add('active');
    }
  });
}

start();
