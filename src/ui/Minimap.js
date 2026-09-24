// Runde Minikarte unten rechts. Die Karte wird EINMAL aus den Terrain-Höhen
// gemalt (mit Schattierung), danach nur noch gedreht und verschoben.
import { WORLD_SIZE, HALF } from '../world/Terrain.js';

export class Minimap {
  constructor(canvas, terrain, settlement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = terrain;
    this.map = this._render(terrain, settlement);
    this.range = 1400; // sichtbarer Durchmesser in Metern
    this.timer = 0;
  }

  _render(terrain, settlement) {
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const cell = WORLD_SIZE / S;
    const sp = terrain.splatData;
    const spS = terrain.splatSize;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = -HALF + (i + 0.5) * cell;
        const z = -HALF + (j + 0.5) * cell;
        const h = terrain.heightAt(x, z);
        let r, gg, b;
        if (h < 0) {
          const d = Math.min(1, -h / 30);
          r = 30 - d * 20;
          gg = 110 - d * 60;
          b = 140 - d * 40;
        } else {
          if (h < 3.5) [r, gg, b] = [200, 185, 140];
          else if (h < 260) [r, gg, b] = [74 + h * 0.1, 106 - h * 0.05, 48];
          else if (h < 420) [r, gg, b] = [118, 112, 104];
          else [r, gg, b] = [236, 240, 245];
          // Hangschattierung (Licht von Nordwest)
          const hx = terrain.heightAt(x + cell, z) - terrain.heightAt(x - cell, z);
          const hz = terrain.heightAt(x, z + cell) - terrain.heightAt(x, z - cell);
          const shade = Math.max(0.55, Math.min(1.35, 1 - (hx + hz) * 0.035));
          r *= shade;
          gg *= shade;
          b *= shade;
          // Wege und Felder
          if (sp) {
            const si = Math.floor(((z + HALF) / WORLD_SIZE) * spS) * spS + Math.floor(((x + HALF) / WORLD_SIZE) * spS);
            const road = sp[si * 4] / 255;
            const wheat = sp[si * 4 + 1] / 255;
            const crop = sp[si * 4 + 2] / 255;
            r = r * (1 - wheat) + 200 * wheat;
            gg = gg * (1 - wheat) + 170 * wheat;
            b = b * (1 - wheat) + 80 * wheat;
            r = r * (1 - crop) + 90 * crop;
            gg = gg * (1 - crop) + 120 * crop;
            b = b * (1 - crop) + 50 * crop;
            r = r * (1 - road) + 150 * road;
            gg = gg * (1 - road) + 120 * road;
            b = b * (1 - road) + 85 * road;
          }
        }
        const k = (j * S + i) * 4;
        img.data[k] = r;
        img.data[k + 1] = gg;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Gebäude als kleine Punkte
    const toPx = (x, z) => [((x + HALF) / WORLD_SIZE) * S, ((z + HALF) / WORLD_SIZE) * S];
    g.fillStyle = '#3a2a1c';
    for (const e of settlement.exclusions) {
      const [px, pz] = toPx(e.x, e.z);
      g.fillRect(px - 1.5, pz - 1.5, 3, 3);
    }
    this.scale = S / WORLD_SIZE;
    return c;
  }

  /**
   * @param pos Spieler-Position, heading (Radiant, 0 = Norden/-z)
   * @param rings { list, next } optional
   */
  draw(dt, pos, heading, rings) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 20; // 20× pro Sekunde reicht
    const g = this.ctx;
    const W = this.canvas.width;
    const R = W / 2;
    const k = W / this.range; // Pixel pro Meter
    g.save();
    g.clearRect(0, 0, W, W);
    g.beginPath();
    g.arc(R, R, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#0d2a3c';
    g.fillRect(0, 0, W, W);
    g.translate(R, R);
    g.rotate(heading); // Karte dreht sich, Spieler zeigt immer nach oben
    const ms = k / this.scale;
    g.drawImage(this.map, (-(pos.x + HALF) * this.scale) * ms, (-(pos.z + HALF) * this.scale) * ms, this.map.width * ms, this.map.height * ms);

    // Ringe
    if (rings?.list) {
      rings.list.forEach((r, i) => {
        if (i < rings.next) return;
        const x = (r.pos.x - pos.x) * k;
        const z = (r.pos.z - pos.z) * k;
        const isNext = i === rings.next;
        g.beginPath();
        g.arc(x, z, isNext ? 6 : 3.5, 0, Math.PI * 2);
        g.fillStyle = isNext ? '#ffd060' : 'rgba(90,190,255,0.9)';
        g.fill();
        if (isNext) {
          g.lineWidth = 2;
          g.strokeStyle = '#fff3c0';
          g.stroke();
        }
      });
    }
    g.restore();

    // Himmelsrichtung N (dreht mit)
    g.save();
    g.translate(R, R);
    g.rotate(heading);
    g.fillStyle = '#f5d98a';
    g.font = 'bold 14px Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', 0, -R + 12);
    g.restore();

    // Spieler-Pfeil in der Mitte
    g.save();
    g.translate(R, R);
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
    g.restore();
  }
}
