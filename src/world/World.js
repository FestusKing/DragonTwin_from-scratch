// Die Welt: baut Landschaft, Himmel, Wetter, Dorf, Bäume, Ziegen … zusammen
// und aktualisiert alles jedes Bild.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/utils.js';
import { settings } from '../core/Settings.js';
import { Terrain, PLACES } from './Terrain.js';
import { Sky } from './Sky.js';
import { Weather } from './Weather.js';
import { Clouds } from './Clouds.js';
import { Water } from './Water.js';
import { Vegetation } from './Vegetation.js';
import { Settlement } from './Settlement.js';
import { Landmarks } from './Landmarks.js';
import { Colliders } from './Colliders.js';
import { Goats } from './Goats.js';
import { Birds } from './Birds.js';
import { Particles } from '../fx/Particles.js';
import { Rain, SpeedLines } from '../fx/Rain.js';
import { Lightning } from '../fx/Lightning.js';
import { BurnSystem } from '../gameplay/BurnSystem.js';

const _white = new THREE.Color(0.85, 0.87, 0.9);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality; // { particles, trees, clouds, rain }
    this.time = settings.get('timeOfDay');
    this.audio = null;
  }

  async build(progress) {
    const scene = this.scene;
    const q = this.q;
    progress(0.02, 'Landschaft formen …');
    this.terrain = new Terrain(1337);
    await this.terrain.generate((p) => progress(0.03 + p * 0.37, 'Landschaft formen …'));
    this.terrain.createSplat();
    this.colliders = new Colliders();

    progress(0.42, 'Dorf und Burg bauen …');
    await tick();
    this.landmarks = new Landmarks(scene, this.terrain, this.colliders).plan();
    this.settlement = new Settlement(scene, this.terrain, this.colliders).build(this.landmarks);
    this.terrain.buildMesh();
    scene.add(this.terrain.group);
    this.landmarks.build();

    progress(0.55, 'Himmel und Wasser …');
    await tick();
    this.sky = new Sky(scene);
    this.weather = new Weather();
    this.water = new Water(scene, this.terrain);
    this.clouds = new Clouds(scene, q.clouds);
    scene.fog = new THREE.FogExp2(0xa6c5e4, 0.00012);

    progress(0.62, 'Wälder pflanzen …');
    await tick();
    const excl = [...this.settlement.exclusions];
    if (this.landmarks.stoneCircle) excl.push({ x: this.landmarks.stoneCircle.x, z: this.landmarks.stoneCircle.z, r: 26 });
    excl.push({ x: PLACES.island.x, z: PLACES.island.z, r: 12 });
    this.vegetation = new Vegetation(scene, this.terrain, excl, q.trees);

    progress(0.78, 'Feuer und Effekte …');
    await tick();
    this.particles = new Particles(scene, this.terrain, q.particles);
    this.rain = new Rain(scene, q.rain);
    this.speedLines = new SpeedLines(scene);
    this.lightning = new Lightning(scene);
    this.burn = new BurnSystem(scene, this.particles, this.terrain, this.vegetation, this.settlement, q.particles);

    progress(0.86, 'Ziegen verstecken …');
    await tick();
    this.goats = new Goats(scene, this._goatSpots());
    this.birds = new Birds(scene, [
      { x: PLACES.village.x + 150, y: 90, z: PLACES.village.z - 50, count: 18, range: 350 },
      { x: PLACES.lake.x, y: 70, z: PLACES.lake.z, count: 16, range: 300 },
      { x: this.landmarks.arch.x, y: 55, z: this.landmarks.arch.z - 100, count: 14, range: 400, white: true },
      { x: -900, y: 160, z: -700, count: 12, range: 500 },
    ]);

    // Blitze
    this.weather.onLightning = () => this._lightningStrike();
    this.weather.set(settings.get('weather'), true);
    this.inCloud = 0;
    this.fogDensity = 0.00012;
    progress(0.95, 'Fast fertig …');
  }

  /** Verstecke für die Ziegen */
  _goatSpots() {
    const t = this.terrain;
    const S = this.settlement.poi;
    const L = this.landmarks;
    const spots = [];
    const add = (id, name, p, onGround = true) => {
      if (!p) return;
      const y = onGround ? t.heightAt(p.x, p.z) : p.y;
      spots.push({ id, name, x: p.x, y, z: p.z });
    };
    add('peak', 'Gipfel des Drachenhorns', t.peak);
    add('peak2', 'Zweiter Gipfel', t.peak2);
    add('island', 'Insel im See', { x: PLACES.island.x, z: PLACES.island.z });
    add('keep', 'Dach des Bergfrieds', S.keepTop, false);
    add('church', 'Kirchturmspitze', S.churchTop, false);
    add('arch', 'Oben auf dem Felsbogen', L.archTop, false);
    add('wreck', 'Schiffswrack', L.wreckTop, false);
    add('islet', 'Felseninsel', L.isletTop, false);
    add('stones', 'Steinkreis', L.stoneAltar, false);
    if (S.watchtowers?.[0]) add('tower', 'Wachturm', S.watchtowers[0], false);
    if (S.pier) add('pier', 'Bootssteg', S.pier, false);
    if (S.lighthouse) add('lighthouse', 'Leuchtturm', { x: S.lighthouse.x + 3.1, y: S.lighthouse.y - 5.4, z: S.lighthouse.z }, false);
    return spots;
  }

  _lightningStrike() {
    const cam = this.cameraRef;
    if (!cam) return;
    const a = Math.random() * Math.PI * 2;
    const d = 500 + Math.random() * 2200;
    const x = cam.position.x + Math.cos(a) * d;
    const z = cam.position.z + Math.sin(a) * d;
    const gy = Math.max(0, this.terrain.heightAt(x, z));
    this.lightning.strike(_v.set(x, 520, z), _v2.set(x + (Math.random() - 0.5) * 60, gy, z + (Math.random() - 0.5) * 60), cam);
    this.sky.triggerFlash(clamp(1.4 - d / 3000, 0.3, 1.3));
    this.audio?.playThunder(d / 343, clamp(1.3 - d / 3500, 0.3, 1.2));
    if (Math.random() < 0.5) this.burn.igniteNear(_v2, 40);
  }

  /** Neustart: Brände löschen, Wetter bleibt */
  reset() {
    this.burn.reset();
    this.particles.fire.clear();
    this.particles.smoke.clear();
    this.particles.sparks.clear();
  }

  /**
   * @param ctx { camera, focus (Vector3), camVel, dragonPos, dragonSpeed, paused, fireColor }
   */
  update(dt, ctx) {
    const worldDt = ctx.paused ? 0 : dt;
    this.cameraRef = ctx.camera;
    // Tageszeit
    if (settings.get('timeRunning') && !ctx.paused) {
      this.time = (this.time + (worldDt * 24) / (settings.get('dayLengthMin') * 60)) % 24;
    }
    this.weather.update(worldDt);
    const w = this.weather;
    this.sky.update(dt, this.time, w, ctx.camera, ctx.focus);

    // Nebel: Wetter + in der Wolke
    this.clouds.update(worldDt, ctx.camera, this.sky, w, this.fogDensity);
    this.inCloud = lerp(this.inCloud, this.clouds.inCloud, 1 - Math.exp(-dt * 4));
    const fog = this.scene.fog;
    this.fogDensity = w.fogDensity + this.inCloud * 0.014;
    fog.density = this.fogDensity;
    fog.color.copy(this.sky.fogColor).lerp(_white.setRGB(0.8, 0.83, 0.87).multiplyScalar(0.25 + this.sky.day * 0.75), this.inCloud * 0.9);

    this.water.update(worldDt, this.sky, w, ctx.camera);
    this.terrain.update(dt, w.wetness);
    this.vegetation.update(worldDt, w.wind);
    this.settlement.update(worldDt, smoothstep(0.35, 0.9, this.sky.night), w.wind);
    this.rain.update(worldDt, ctx.camera, ctx.camVel, w, this.sky);
    this.speedLines.update(ctx.camera, ctx.camVel, ctx.dragonSpeed || 0, 0.4 + this.sky.day * 0.6);
    this.lightning.update(dt);
    this.birds.update(worldDt, ctx.dragonPos, this.sky.day * (1 - w.rain));
    if (!ctx.paused) {
      this.burn.update(worldDt, ctx.camera.position, w.rain, w.wind, ctx.fireColor);
      this._chimneys(worldDt, ctx.camera.position);
    }
    this.particles.update(worldDt, w.windVec, this.sky, this.fogDensity);
  }

  _chimneys(dt, cam) {
    const smoke = this.particles.smoke;
    for (const c of this.settlement.chimneys) {
      if (!c.alive) continue;
      const d = Math.hypot(cam.x - c.x, cam.z - c.z);
      if (d > 900) continue;
      c.t -= dt;
      if (c.t <= 0) {
        c.t = 0.35 + Math.random() * 0.3;
        smoke.spawn(c.x, c.y, c.z, (Math.random() - 0.5) * 0.5, 2.2, (Math.random() - 0.5) * 0.5, 6 + Math.random() * 3, 1.2, 7, 1.9, 1.9, 2.0);
      }
    }
  }
}

function tick() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
