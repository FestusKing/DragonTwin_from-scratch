import { defineConfig } from 'vite';

// Vite-Konfiguration: sehr schlank.
// "base: './'" sorgt dafür, dass der fertige Build (npm run build)
// auch aus einem Unterordner oder direkt vom Dateisystem-Server läuft.
export default defineConfig({
  base: './',
  server: { open: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
