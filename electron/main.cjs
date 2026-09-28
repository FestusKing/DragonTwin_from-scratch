// Desktop-Version: startet das Spiel in einem eigenen Fenster – ohne Browser (Electron).
//
// So funktioniert es:
//  - "npm run desktop" baut zuerst das Spiel (vite build → Ordner dist/) und startet dann dieses Programm.
//  - Das Spiel wird über ein eigenes Protokoll app://spiel/ geladen (nicht über file://).
//    Grund: Mit file:// dürfte das Spiel keine Dateien nachladen (Drachen-Modell, Texturen).
//  - Speicherstände und Einstellungen bleiben wie im Browser erhalten (localStorage).
//
// Sicherheit: Das Spielfenster hat keinen Zugriff auf Node.js oder Dateien (sandbox),
// es lädt nur Dateien aus dist/. Links ins Internet öffnen sich im normalen Browser.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fileFor } = require('./paths.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const START_URL = 'app://spiel/index.html';

// Laptops mit zwei Grafikkarten: die starke benutzen
app.commandLine.appendSwitch('force_high_performance_gpu');

// app:// muss vor dem Start angemeldet werden. "secure" braucht es z. B. für das Gamepad.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#07080b',
    title: 'DragonTwin: Test Flight',
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // Töne ohne ersten Klick
    },
  });
  win.once('ready-to-show', () => win.show());

  // Das Spiel fragt im Browser vor dem Schliessen nach (Tab aus Versehen zu).
  // Im eigenen Fenster soll das X einfach schliessen.
  win.webContents.on('will-prevent-unload', (event) => event.preventDefault());

  // F11 = Vollbild an/aus
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // Links nach aussen (z. B. Quellen) im normalen Browser öffnen, nie im Spielfenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => {
    if (!event.url.startsWith('app://spiel/')) event.preventDefault();
  });

  win.loadURL(START_URL);
  return win;
}

// Nur ein Spielfenster gleichzeitig
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    // Kein Menü: sonst schliesst Strg+W das Fenster – und W + Strg ist im Spiel "Nase runter + Boost"!
    Menu.setApplicationMenu(null);

    protocol.handle('app', (request) => {
      const file = fileFor(request.url, DIST);
      if (!file) return new Response('Nicht erlaubt', { status: 403 });
      if (!fs.existsSync(file)) return new Response('Nicht gefunden', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
