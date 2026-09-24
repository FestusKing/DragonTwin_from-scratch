// Wetter-System: Klar, Bewölkt, Regen, Nebel, Gewitter.
// Jeder Zustand ist eine Sammlung von Zahlen. Beim Wechsel werden die
// Zahlen langsam angeglichen → weiche Übergänge.
import * as THREE from 'three';
import { damp } from '../core/utils.js';

export const WEATHER_TYPES = {
  clear: { label: 'Klar', overcast: 0.0, cloudCover: 0.38, rain: 0, fog: 0, fogDensity: 0.00011, darkness: 0, wind: 0.2, lightning: 0 },
  cloudy: { label: 'Bewölkt', overcast: 0.55, cloudCover: 0.82, rain: 0, fog: 0.1, fogDensity: 0.0002, darkness: 0.08, wind: 0.45, lightning: 0 },
  rain: { label: 'Regen', overcast: 0.9, cloudCover: 1.0, rain: 0.75, fog: 0.35, fogDensity: 0.00065, darkness: 0.3, wind: 0.6, lightning: 0 },
  fog: { label: 'Nebel', overcast: 0.55, cloudCover: 0.45, rain: 0, fog: 1.0, fogDensity: 0.0032, darkness: 0.08, wind: 0.05, lightning: 0 },
  storm: { label: 'Gewitter', overcast: 1.0, cloudCover: 1.0, rain: 1.0, fog: 0.45, fogDensity: 0.0009, darkness: 0.55, wind: 1.0, lightning: 1 },
};
const KEYS = ['overcast', 'cloudCover', 'rain', 'fog', 'fogDensity', 'darkness', 'wind', 'lightning'];
const AUTO_WEIGHTS = [
  ['clear', 0.42],
  ['cloudy', 0.25],
  ['rain', 0.13],
  ['fog', 0.1],
  ['storm', 0.1],
];

export class Weather {
  constructor() {
    this.name = 'clear';
    this.auto = true;
    this.autoTimer = 180;
    this.transitionRate = 0.12;
    for (const k of KEYS) this[k] = WEATHER_TYPES.clear[k];
    this.wetness = 0;
    this.windAngle = 0.6;
    this.windVec = new THREE.Vector3();
    this.lightningTimer = 8;
    this.onLightning = null; // Callback
    this.gust = 0;
    this._t = 0;
  }

  get label() {
    return WEATHER_TYPES[this.name].label;
  }

  /** Wetter setzen. mode: Name oder 'auto'. */
  set(mode, immediate = false) {
    if (mode === 'auto') {
      this.auto = true;
      this.autoTimer = 120 + Math.random() * 120;
      return;
    }
    this.auto = false;
    this._go(mode, immediate ? 100 : 0.35);
  }

  _go(name, rate) {
    if (!WEATHER_TYPES[name]) return;
    this.name = name;
    this.transitionRate = rate;
    if (rate >= 100) for (const k of KEYS) this[k] = WEATHER_TYPES[name][k];
  }

  update(dt) {
    this._t += dt;
    if (this.auto) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = 150 + Math.random() * 180;
        let r = Math.random();
        let next = 'clear';
        for (const [n, w] of AUTO_WEIGHTS) {
          if (r < w) {
            next = n;
            break;
          }
          r -= w;
        }
        this._go(next, 0.06);
      }
    }
    const target = WEATHER_TYPES[this.name];
    for (const k of KEYS) {
      // Nebeldichte exponentiell angleichen (sonst "springt" sie optisch)
      if (k === 'fogDensity') {
        const lc = Math.log(this[k]);
        const lt = Math.log(target[k]);
        this[k] = Math.exp(damp(lc, lt, this.transitionRate, dt));
      } else this[k] = damp(this[k], target[k], this.transitionRate, dt);
    }

    // Nässe: steigt im Regen, trocknet langsam
    if (this.rain > 0.2) this.wetness = Math.min(1, this.wetness + dt * 0.05 * this.rain);
    else this.wetness = Math.max(0, this.wetness - dt * 0.01);

    // Wind dreht langsam; Böen im Sturm
    this.windAngle += dt * 0.01 * Math.sin(this._t * 0.05);
    this.gust = Math.max(0, Math.sin(this._t * 0.37) * Math.sin(this._t * 0.91 + 1)) * this.wind;
    const speed = (2 + this.wind * 10) * (1 + this.gust * 0.8);
    this.windVec.set(Math.cos(this.windAngle) * speed, 0, Math.sin(this.windAngle) * speed);

    // Blitze
    if (this.lightning > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 4 + Math.random() * 10;
        this.onLightning?.();
      }
    }
  }
}
