// Game = der "Dirigent". Hält alle Systeme zusammen und steuert den Ablauf:
//   loading → menu ↔ customize
//   menu → play (Freiflug, optional Tutorial) / race (Ringrennen)
//   play/race ↔ paused, race → results
import * as THREE from 'three';
import { settings } from './Settings.js';
import { Input, PAD } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { CameraRig } from './CameraRig.js';
import { clamp, damp, lerp, formatTime } from './utils.js';
import { World } from '../world/World.js';
import { PLACES } from '../world/Terrain.js';
import { Dragon, loadDragonModel } from '../dragon/Dragon.js';
import { FlightPhysics } from '../dragon/FlightPhysics.js';
import { FireBreath } from '../dragon/FireBreath.js';
import { Customization } from '../dragon/Customization.js';
import { RingRace } from '../gameplay/RingRace.js';
import { Tutorial } from '../gameplay/Tutorial.js';
import { PostProcessing } from '../fx/PostProcessing.js';
import { SpeedFx } from '../fx/SpeedFx.js';
import { PARTICLE_SCALE } from '../fx/Particles.js';
import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { Minimap } from '../ui/Minimap.js';

const TIPS = [
  'Tipp: Tempo erzeugt Auftrieb. Wer zu langsam fliegt, sackt ab – Nase runter oder Flügel schlagen!',
  'Tipp: Im Sturzflug (Shift) legt der Drache die Flügel an und wird sehr schnell.',
  'Tipp: Hütten, Bäume und Heuballen fangen Feuer. Regen löscht die Flammen.',
  'Tipp: Irgendwo auf der Insel verstecken sich Ziegen. Hör genau hin …',
  'Tipp: Mit gedrückter Maustaste kannst du dich umsehen, das Mausrad zoomt.',
  'Tipp: Brüll mal (Q) – vielleicht antwortet jemand.',
  'Tipp: Beim Schweben (V) drehst du dich mit A/D auf der Stelle.',
];

// Qualitäts-Stufen
// detail: Boden mit allen Foto-Details (triplanare Felsen, Anti-Wiederholung)
const QUALITY = {
  low: { pr: 0.75, shadows: 0, bloom: false, msaa: 0, detail: false, world: { trees: 0.5, particles: 0.5, clouds: 60, rain: 3000 } },
  medium: { pr: 1.0, shadows: 1024, bloom: true, msaa: 0, detail: true, world: { trees: 0.8, particles: 0.8, clouds: 85, rain: 5000 } },
  high: { pr: 1.5, shadows: 2048, bloom: true, msaa: 4, detail: true, world: { trees: 1, particles: 1, clouds: 100, rain: 7000 } },
  auto: { pr: 1.25, shadows: 2048, bloom: true, msaa: 0, detail: true, world: { trees: 0.9, particles: 0.9, clouds: 95, rain: 6000 } },
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _prev = new THREE.Vector3();
const _mouth = new THREE.Vector3();
const _tipR = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _tipL = new THREE.Vector3();

export class Game {
  constructor(renderer) {
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 30000);
    this.camera.position.set(0, 300, 600);
    this.state = 'loading';
    this.input = new Input(this.canvas);
    this.audio = new AudioManager();
    this.custom = new Customization();
    this.rig = new CameraRig(this.camera);
    this.hud = new HUD();
    this.time = 0;
    this.damage = 0;
    this.roarTimer = 0;
    this.roarAnim = 0;
    this.previewFireTimer = 0;
    this.nostrilTimer = 3;
    this.skimTimer = 0;
    this.fps = 60;
    this.frameTimes = [];
    this.autoPR = null;
    this.anim = {};
    this.flightInput = { pitch: 0, roll: 0, flap: false, flapPressed: false, dive: false, boost: false, hover: false, fire: false };
    this.shownHints = new Set();
  }

  qualityPreset() {
    return QUALITY[settings.get('quality')] || QUALITY.auto;
  }

  async init(progress) {
    const preset = this.qualityPreset();
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    this.world = new World(this.scene, preset.world);
    await this.world.build(progress);
    this.world.audio = this.audio;
    this.world.sky.setupEnvironment(this.renderer);

    progress(0.96, 'Drache schlüpft …');
    await loadDragonModel();
    this.dragon = new Dragon();
    this.scene.add(this.dragon.root);
    this.physics = new FlightPhysics();
    this.fire = new FireBreath(this.scene, this.world.particles, preset.world.particles);
    this.speedFx = new SpeedFx(this.scene);
    this.speedFx.onBoom = () => {
      // "Schallmauer": Knall, Beben, Blickwinkel reisst auf, kurzes Aufblitzen
      this.audio.playBoom();
      this.rig.addShake(1.1);
      this.rig.kick(14);
      this.hud.doFlash(0.18);
    };
    this.wasBoosting = false;
    this.race = new RingRace(this.scene, this.world, this.audio);
    this.tutorial = new Tutorial(this.input, this.audio, {
      ...this.hud.tutorialUI(),
      finished: () => this.hud.toast('Tutorial abgeschlossen!', 'Viel Spass beim Fliegen 🐉', 4),
    });
    this.minimap = new Minimap(document.getElementById('minimap'), this.world.terrain, this.world.settlement);
    this.menu = new Menu(this);

    this._applyCustomization();
    this.custom.onChange(() => this._applyCustomization());
    this._wireEvents();
    this.applyQuality();
    settings.onChange((k) => {
      if (k === 'quality') this.applyQuality();
    });
    document.getElementById('hud-map').classList.toggle('hidden', !settings.get('showMinimap'));
    document.getElementById('tut-skip').addEventListener('click', () => {
      this.tutorial.stop();
      this.audio.playClick();
    });
    this.hud.setGoats(this.world.goats.foundCount, this.world.goats.total);
    this.hud.setKeyHints(this.input);

    // Menü-Drache in Position bringen
    this.menuAngle = 0;
    this._updateMenuDragon(0);
    this.rig.mode = 'orbit';
    this.rig.update(0.016, this._rigTarget(), this.world.terrain, this.dragon);

    // Shader vorab kompilieren → keine Ruckler beim ersten Feuer/Regen/Nacht
    progress(0.98, 'Shader vorbereiten …');
    this._precompile();
    progress(1, 'Bereit!');
  }

  _precompile() {
    const toggled = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        toggled.push(o);
        o.visible = true;
      }
    });
    try {
      this.renderer.compile(this.scene, this.camera);
      this.post.render(0.016);
    } catch (e) {
      console.warn('Vorab-Kompilieren fehlgeschlagen', e);
    }
    for (const o of toggled) o.visible = false;
  }

  _applyCustomization() {
    const c = this.custom;
    this.dragon.setSkin(c.skin);
    this.dragon.setRider(c.state.rider);
    this.fire.setPalette(c.fire.c);
    this.fireColor = new THREE.Color(c.fire.c[1]);
    this.dragon.setFireColor(this.fireColor);
  }

  _wireEvents() {
    const p = this.physics;
    const w = this.world;
    p.events.flap = (s) => {
      this.audio.playFlap(s * (this.rig.mode === 'first' ? 1.2 : 0.8));
      this._wingGust(s);
    };
    p.events.impact = (s, water) => {
      if (water) this._splash(s);
      else {
        this.audio.playImpact(s);
        w.particles.dust(p.position, s);
      }
      this.rig.addShake(s * 0.9);
      this.damage = Math.min(1, this.damage + s * 0.6);
    };
    p.events.splash = (s) => this._splash(s);
    p.events.land = (water, into = 3) => {
      // Schwere Landung: je schneller nach unten, desto mehr Staub, Beben und Wumms
      const s = clamp(into / 12, 0.35, 1.3);
      _v.copy(p.position).setY(p.position.y - 2.4);
      if (!water) {
        w.particles.dust(_v, 0.6 + s);
        this.speedFx.shock(_v, _up, { r0: 2, r1: 12 + 14 * s, dur: 0.7, opacity: 0.3, color: 0x8a7a62 });
        this.audio.playImpact(0.25 + s * 0.5);
      }
      this.rig.addShake(0.25 + s * 0.6);
      this._hintOnce('land', 'Gelandet', `Mit ${this._key('flap')} hebst du wieder ab, mit ${this._key('pitchDown')} läufst du.`);
    };
    p.events.takeoff = () => {
      _v.copy(p.position).setY(p.position.y - 2.4);
      if (!p.onWater) {
        w.particles.dust(_v, 1.0);
        this.speedFx.shock(_v, _up, { r0: 2, r1: 18, dur: 0.6, opacity: 0.22, color: 0x8a7a62 });
      }
      this.rig.addShake(0.3);
    };

    w.goats.onFound = (goat, found, total) => {
      w.particles.confetti(goat.pos);
      this.audio.playSuccess();
      this.hud.setGoats(found, total, true);
      this.hud.toast(`🐐 Ziege gefunden! ${found}/${total}`, goat.name, 4);
      if (found === total) {
        setTimeout(() => this.hud.toast('✦ Alle Ziegen gefunden!', 'Der goldene Drache ist jetzt freigeschaltet (Drache anpassen).', 7), 1500);
      }
    };
    w.burn.onIgnite = (e) => {
      const d = e ? Math.hypot(e.x - this.physics.position.x, e.z - this.physics.position.z) : 50;
      if (d < 400) this.audio.playIgnite(clamp(1 - d / 400, 0.2, 1) * (e.kind === 'tree' ? 0.5 : 1));
      if (e) this._ignitionBurst(e, d);
      if (e.kind === 'hut') this._hintOnce('hut', '🔥 Das Dach brennt!', 'Regen löscht Feuer. Neustart (Pause-Menü) baut alles wieder auf.');
    };
    this.fire.onOverheat = () => {
      this.audio.playError();
      this._hintOnce('heat', 'Überhitzt!', 'Warte kurz, bis sich der Drache abgekühlt hat.');
    };

    // Rennen
    const r = this.race;
    r.events.countdown = (n) => this.hud.center(String(n), '', 0.9);
    r.events.go = () => this.hud.center('LOS!', '', 1.0);
    r.events.ring = (i, n, time, delta) => {
      this.hud.showDelta(delta);
      if (i < n - 1) this.hud.center('', `Ring ${i + 1} / ${n}`, 0.8);
    };
    r.events.finish = (res) => {
      this.hud.center('ZIEL!', formatTime(res.time), 2.5);
      this.audio.setMusicIntensity(0);
      setTimeout(() => {
        if (this.state === 'race' && this.race.state === 'finished') {
          this.state = 'results';
          this.input.gameActive = false;
          this.menu.showResults(res);
        }
      }, 2200);
    };
  }

  _key(action) {
    const c = this.input.bindings[action]?.[0];
    return c ? (c === 'Space' ? 'Leertaste' : c.replace('Key', '')) : '?';
  }

  _hintOnce(id, title, sub) {
    if (this.shownHints.has(id)) return;
    this.shownHints.add(id);
    this.hud.toast(title, sub, 5);
  }

  _splash(s) {
    this.world.particles.splash(this.physics.position, s, this.physics.velocity);
    this.audio.playSplash(s);
  }

  // ------------------------------------------------------------ Qualität
  applyQuality() {
    const q = this.qualityPreset();
    this.maxPR = Math.min(window.devicePixelRatio || 1, q.pr);
    this.autoPR = settings.get('quality') === 'auto' ? this.maxPR : null;
    this.world.sky.setShadowQuality(q.shadows);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.post.setQuality({ bloom: q.bloom, msaa: q.msaa });
    this.world.terrain.setDetail(q.detail);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = this.autoPR ?? this.maxPR ?? 1;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
    this._updateParticleScale();
  }

  _updateParticleScale() {
    const h = this.renderer.domElement.height;
    PARTICLE_SCALE.value = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  /** Automatische Qualität: Auflösung an die Bildrate anpassen */
  _autoQuality(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.fps = Math.round(1 / avg);
    if (this.autoPR == null) return;
    let pr = this.autoPR;
    if (this.fps < 48) pr = Math.max(0.55, pr * 0.88);
    else if (this.fps > 58 && pr < this.maxPR) pr = Math.min(this.maxPR, pr * 1.06);
    if (Math.abs(pr - this.autoPR) > 0.01) {
      this.autoPR = pr;
      this.resize();
    }
  }

  // ------------------------------------------------------------ Zustände
  /** Nach dem Laden: Klick auf "Los geht's" */
  enterMenu() {
    this.audio.init();
    this.state = 'menu';
    this.menu.show('menu', { push: false });
    this.hud.show(false);
  }

  /** Fokus von Menü-Knöpfen nehmen (sonst "drückt" die Leertaste sie im Flug) */
  _focusGame() {
    document.activeElement?.blur?.();
    this.canvas.focus({ preventScroll: true });
  }

  startFreeFlight({ tutorial = false } = {}) {
    this.audio.init();
    this._focusGame();
    this.race.clear();
    this.hud.showRace(false);
    this.menu.hideAll();
    const V = PLACES.village;
    const start = _v.set(V.x + 30, this.world.terrain.heightAt(V.x, V.z + 320) + 110, V.z + 320);
    this.physics.reset(start, 0, 36);
    this.physics.frozen = false;
    this.rig.mode = this.rig.mode === 'first' ? 'first' : 'chase';
    this.rig.snap();
    this.state = 'play';
    this.mode = 'free';
    this.input.gameActive = true;
    this.hud.show(true);
    this.audio.setMusicIntensity(0);
    if (tutorial) this.tutorial.start();
    else {
      this.tutorial.stop();
      this._hintOnce('welcome', 'Willkommen, Drachenreiter!', `Drücke ${this._key('help')} für die Steuerung. Tipp: Das Tutorial erklärt alles.`);
    }
  }

  startRace(courseId, ghost) {
    this.audio.init();
    this._focusGame();
    this.tutorial.stop();
    this.menu.hideAll();
    this.race.load(courseId, ghost);
    this.race.begin(this.physics);
    this.lastCourse = { courseId, ghost };
    this.rig.mode = this.rig.mode === 'first' ? 'first' : 'chase';
    this.rig.snap();
    this.state = 'race';
    this.mode = 'race';
    this.input.gameActive = true;
    this.hud.show(true);
    this.hud.showRace(true);
    this.hud.showDelta(null);
    this.audio.setMusicIntensity(1);
  }

  retryRace() {
    if (this.lastCourse) this.startRace(this.lastCourse.courseId, this.lastCourse.ghost);
  }

  pause() {
    if (this.state !== 'play' && this.state !== 'race') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.input.gameActive = false;
    this.menu.show('pause', { push: false });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState || 'play';
    this.menu.hideAll();
    this.input.gameActive = true;
    this._focusGame();
  }

  restart() {
    this.world.reset();
    if (this.mode === 'race') this.retryRace();
    else this.startFreeFlight();
  }

  toMenu() {
    this.race.clear();
    this.tutorial.stop();
    this.world.reset();
    this.hud.show(false);
    this.hud.showRace(false);
    this.state = 'menu';
    this.input.gameActive = false;
    this.rig.mode = 'orbit';
    this.audio.setMusicIntensity(0);
    this.menu.hideAll();
    this.menu.show('menu', { push: false });
  }

  enterCustomize() {
    this.state = 'customize';
    this.rig.mode = 'showcase';
    this.menu.show('customize');
  }

  exitCustomize() {
    this.state = 'menu';
    this.rig.mode = 'orbit';
    this.menu.show('menu', { push: false });
  }

  previewFire() {
    this.previewFireTimer = 1.6;
  }

  // ------------------------------------------------------------ Menü-Drache
  _updateMenuDragon(dt) {
    // Der Drache kreist über dem Dorf (ohne Physik, "auf Schienen")
    const V = PLACES.village;
    const R = 280;
    const speed = 30;
    this.menuAngle += (dt * speed) / R;
    const a = this.menuAngle;
    const x = V.x + Math.cos(a) * R;
    const z = V.z + Math.sin(a) * R;
    const y = 150 + Math.sin(a * 2) * 15;
    const heading = Math.atan2(-(-Math.sin(a)), -Math.cos(a));
    this.physics.position.set(x, y, z);
    _e.set(Math.cos(a * 2) * 0.08, heading, -0.38, 'YXZ'); // Rechtskurve → rechter Flügel unten
    this.physics.quaternion.setFromEuler(_e);
    this.physics.velocity.set(-Math.sin(a) * speed, 0, Math.cos(a) * speed);
    // Flügelschlag: 3 s schlagen, 4 s gleiten
    const cyc = (this.time % 7) < 3;
    this.physics.flapAmp = damp(this.physics.flapAmp, cyc ? 0.9 : 0, 3, dt);
    this.physics.flapPhase = (this.physics.flapPhase + dt * 1.5) % 1;
    this.physics.fold = 0;
    this.physics.hovering = false;
    this.physics.grounded = false;
    this.physics.speed = speed;
  }

  _updateShowcaseDragon(dt) {
    const V = PLACES.village;
    const x = V.x + 80;
    const z = V.z + 160;
    const y = this.world.terrain.heightAt(x, z) + 55 + Math.sin(this.time * 1.1) * 1.2;
    this.physics.position.set(x, y, z);
    _e.set(0.25, 0.6, 0, 'YXZ');
    this.physics.quaternion.setFromEuler(_e);
    this.physics.velocity.set(0, 0, 0);
    this.physics.flapAmp = damp(this.physics.flapAmp, 1, 3, dt);
    this.physics.flapPhase = (this.physics.flapPhase + dt * 2.1) % 1;
    this.physics.hovering = true;
    this.physics.speed = 0;
  }

  _rigTarget() {
    const p = this.physics;
    return {
      pos: p.position,
      quat: p.quaternion,
      vel: p.velocity,
      speed: p.speed,
      hover: p.hovering || p.frozen,
      grounded: p.grounded,
      boost: p.boosting,
      dive: p.fold,
    };
  }

  // ------------------------------------------------------------ Hauptschleife
  update(dt) {
    this.time += dt;
    const input = this.input;
    input.update(dt);
    this._autoQuality(dt);
    this._globalKeys();

    const playing = this.state === 'play' || this.state === 'race';
    const paused = this.state === 'paused' || this.state === 'results';
    let fireI = 0;

    if (this.state === 'menu' || this.state === 'loading') {
      this._updateMenuDragon(dt);
      this.rig.mode = 'orbit';
    } else if (this.state === 'customize') {
      this._updateShowcaseDragon(dt);
      this.previewFireTimer -= dt;
    } else if (playing) {
      this._playUpdate(dt);
    }

    // Feuer (auch als Vorschau im Anpassen-Menü)
    if (!paused) {
      const wantsFire = (playing && this.flightInput.fire) || (this.state === 'customize' && this.previewFireTimer > 0);
      fireI = this.fire.update(dt, wantsFire, this.dragon, this.physics.velocity, playing ? this.world.burn : null, this.world.terrain);
    }

    // Drachen-Modell an die Physik hängen und animieren
    const d = this.dragon;
    d.root.position.copy(this.physics.position);
    d.root.quaternion.copy(this.physics.quaternion);
    const a = this.physics.animState(this.anim);
    a.fire = fireI;
    this.roarAnim = Math.max(0, this.roarAnim - dt);
    a.roar = this.roarAnim > 0 ? 1 : 0;
    if (!paused) d.update(dt, a);
    this._nostrilSmoke(dt, fireI, paused);
    if (!paused) this._speedEffects(dt, a, playing);

    // Welt
    this.world.update(dt, {
      camera: this.camera,
      focus: this.physics.position,
      camVel: this.rig.camVelocity,
      dragonPos: this.physics.position,
      dragonSpeed: this.physics.speed,
      paused,
      fireColor: this.fireColor,
    });
    // Ziegen
    this.world.goats.update(paused ? 0 : dt, this.physics.position, this.audio, playing);

    // Kamera
    if (playing) {
      this.rig.look(input.mouseDX, input.mouseDY, dt, input.getLook());
      this.rig.setZoom(input.wheel);
    }
    this.rig.sunDir = this.world.sky.sunDir.y > -0.05 ? this.world.sky.sunDir : this.world.sky.moonDir;
    this.rig.update(dt, this._rigTarget(), this.world.terrain, this.dragon);
    this._updateParticleScale();

    // Ton
    const w = this.world;
    this.audio.update(dt, {
      speed: this.state === 'menu' ? 18 : this.physics.speed,
      agl: this.physics.agl ?? 100,
      fire: fireI,
      rain: w.weather.rain,
      night: w.sky.night,
      day: w.sky.day,
      wind: w.weather.gust,
      burnNearby: w.burn.stats.nearby,
      burnDist: w.burn.stats.nearest,
      inCloud: w.inCloud,
      paused,
      inMenu: !playing,
    });
    this.audio.setListener(this.camera);

    // HUD
    if (playing) this._updateHud(dt);
    this.hud.setFps(this.fps, settings.get('showFps'));

    // Nachbearbeitung
    this.damage = damp(this.damage, 0, 2.5, dt);
    const sp = this.physics.speed;
    const fast = playing ? clamp((sp - 70) / 60, 0, 1) : 0;
    this.post.set({
      blur: playing ? (this.physics.boosting ? 0.5 + fast * 0.8 : fast * 0.5) : 0,
      aberration: playing && this.physics.boosting ? 0.6 + fast : fast * 0.5,
      white: w.inCloud * 0.5,
      damage: this.damage,
      night: w.sky.night,
    });
    this.renderer.toneMappingExposure = lerp(0.9, 1.7, w.sky.night) * (1 + w.weather.overcast * 0.12);
    this.post.render(dt);
    input.endFrame();
  }

  _globalKeys() {
    const input = this.input;
    if (input.pressed('mute')) {
      settings.set('muted', !settings.get('muted'));
      this.hud.toast(settings.get('muted') ? '🔇 Ton aus' : '🔊 Ton an', '', 1.5);
    }
    // Gamepad in Menüs
    if (this.menu && this.menu.current) {
      if (input.padPressed(PAD.DOWN) || (input.padAxes[1] > 0.7 && !this._stickHeld)) this.menu.navigate(1);
      if (input.padPressed(PAD.UP) || (input.padAxes[1] < -0.7 && !this._stickHeld)) this.menu.navigate(-1);
      this._stickHeld = Math.abs(input.padAxes[1]) > 0.7;
      if (input.padPressed(PAD.A)) this.menu.activate();
      if (input.padPressed(PAD.B)) this.menu.back();
    }
    // Escape / Start in Menüs = zurück
    if (input.pressed('pause')) {
      if (this.state === 'play' || this.state === 'race') this.pause();
      else if (this.state === 'paused' && this.menu.current === 'pause') this.resume();
      else if (this.menu.current && this.menu.current !== 'menu' && this.menu.current !== 'loading' && this.menu.current !== 'results') this.menu.back();
    }
    if (this.state === 'loading' && !document.getElementById('btn-start').classList.contains('hidden') && (input.justPressed.has('Enter') || input.padPressed(PAD.A))) {
      this.enterMenu();
    }
  }

  _playUpdate(dt) {
    const input = this.input;
    const p = this.physics;
    const fi = this.flightInput;
    fi.pitch = input.getPitch();
    fi.roll = input.getRoll();
    fi.flap = input.isDown('flap');
    fi.flapPressed = input.pressed('flap');
    fi.dive = input.isDown('dive');
    fi.boost = input.isDown('boost');
    fi.hover = input.isDown('hover');
    fi.fire = input.isDown('fire');

    if (input.pressed('help')) {
      this.pause();
      this.menu.show('help');
      return;
    }
    if (input.pressed('photo')) {
      const on = this.hud.togglePhoto();
      if (!on) this.hud.toast('HUD wieder an', '', 1.2);
    }
    if (input.pressed('camera')) {
      this.rig.mode = this.rig.mode === 'first' ? 'chase' : 'first';
      this.rig.snap();
      this.dragon.setRiderHeadVisible(this.rig.mode !== 'first');
      this.tutorial.onCameraToggle();
    }
    this.roarTimer -= dt;
    if (input.pressed('roar') && this.roarTimer <= 0) {
      this.roarTimer = 2.5;
      this.roarAnim = 1.6;
      this.audio.playRoar();
      this.rig.addShake(0.7);
      this.rig.kick(4);
      // Druckwelle vor dem Maul, nahe am Boden auch eine Staubwelle
      this.dragon.getMouth(_mouth, _dir);
      this.speedFx.shock(_mouth.addScaledVector(_dir, 4), _dir, { r0: 1, r1: 38, dur: 0.9, opacity: 0.3 });
      if ((p.agl ?? 99) < 25) {
        _v.set(p.position.x, p.position.y - (p.agl ?? 2.4), p.position.z);
        this.world.particles.dust(_v, 1.2);
        this.speedFx.shock(_v.setY(_v.y + 0.3), _up, { r0: 4, r1: 40, dur: 1.1, opacity: 0.25, color: 0x8a7a62 });
      }
      this.world.goats.respondToRoar(p.position);
    }
    if (this.state === 'race' && input.pressed('restart')) {
      this.retryRace();
      return;
    }

    // Physik
    _prev.copy(p.position);
    p.update(dt, fi, {
      terrain: this.world.terrain,
      colliders: this.world.colliders,
      wind: this.world.weather.windVec,
      assist: settings.get('flightAssist'),
      turbulence: this.world.weather.lightning > 0.5 ? this.world.weather.wind * 0.6 : this.world.weather.gust * 0.2,
    });
    if (this.state === 'race') this.race.update(dt, p, _prev, this.world.particles);
    this.tutorial.update({ dt, input: fi, physics: p });

    // Effekte: Gischt über dem Wasser, Staub über dem Boden
    const sp = p.speed;
    if (!p.grounded && sp > 22) {
      const w = this.world;
      if (p.overWater && p.heightAboveWater < 10) {
        const k = (1 - p.heightAboveWater / 10) * clamp(sp / 80, 0, 1.2);
        const n = Math.floor(k * 30 * w.q.particles * dt * 60 * 0.5);
        for (let i = 0; i < n; i++) {
          w.particles.spray.spawn(
            p.position.x + (Math.random() - 0.5) * 10, 0.3, p.position.z + (Math.random() - 0.5) * 10,
            p.velocity.x * 0.35 + (Math.random() - 0.5) * 6, 3 + Math.random() * 8 * k, p.velocity.z * 0.35 + (Math.random() - 0.5) * 6,
            0.8 + Math.random() * 0.6, 1.5, 5 + Math.random() * 4
          );
        }
        this.skimTimer -= dt;
        if (this.skimTimer <= 0 && k > 0.25) {
          this.skimTimer = 0.35;
          this.audio.playSplash(k * 0.35);
        }
      } else if (!p.overWater && p.agl < 8) {
        if (Math.random() < dt * 20 * (1 - p.agl / 8)) w.particles.dust(_v.copy(p.position).setY(p.position.y - p.agl), 0.15);
      }
    }
    if (p.boosting) this.rig.addShake(dt * 0.25);
    if (this.fire.intensity > 0.1) this.rig.addShake(dt * 0.3 * this.fire.intensity); // Feuer speien bebt
    if (sp > 110) this.rig.addShake(dt * 0.3 * (sp - 110) / 40);
  }

  /** Etwas fängt Feuer: Stichflamme und Funken; Gebäude gehen mit Knall und Druckwelle in Flammen auf */
  _ignitionBurst(e, dist) {
    const w = this.world;
    const big = e.kind !== 'tree';
    const q = w.q.particles;
    const n = Math.floor((big ? 70 : 22) * q);
    const r = e.r || 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 6 : 3) + Math.random() * (big ? 14 : 6);
      w.particles.fire.spawn(
        e.x + Math.cos(a) * r * 0.5, e.y, e.z + Math.sin(a) * r * 0.5,
        Math.cos(a) * sp, 8 + Math.random() * (big ? 22 : 10), Math.sin(a) * sp,
        0.6 + Math.random() * 0.6, 1.5, big ? 6 + Math.random() * 5 : 3 + Math.random() * 3
      );
      if (i % 2 === 0) {
        w.particles.sparks.spawn(e.x, e.y + 1, e.z, Math.cos(a) * sp * 1.4, 10 + Math.random() * 20, Math.sin(a) * sp * 1.4, 1 + Math.random(), 0.4, 0.1, 1, 0.6, 0.2);
      }
    }
    if (!big) return;
    // dunkle Rauchwolke dazu, damit es nach einer Explosion aussieht
    for (let i = 0; i < 18 * q; i++) {
      const a = Math.random() * Math.PI * 2;
      w.particles.smoke.spawn(e.x, e.y + 2, e.z, Math.cos(a) * 5, 6 + Math.random() * 8, Math.sin(a) * 5, 2.5 + Math.random() * 2, 4, 14);
    }
    if (dist < 300) {
      const k = 1 - dist / 300;
      this.audio.playImpact(0.3 + k * 0.6);
      this.rig.addShake(k * 0.5);
    }
  }

  /** Flügelschlag nahe am Boden wirbelt Staub auf (über Wasser: Gischt) */
  _wingGust(strength) {
    const p = this.physics;
    const agl = p.agl ?? 99;
    if (p.grounded || agl > 16 || !this.speedFx) return;
    const k = (1 - agl / 16) * clamp(strength, 0.3, 1.2);
    _v.set(p.position.x, p.position.y - agl, p.position.z);
    if (p.overWater) {
      this.world.particles.splash(_v, k * 0.7);
      this.speedFx.shock(_v.setY(_v.y + 0.3), _up, { r0: 3, r1: 16 + 10 * k, dur: 0.6, opacity: 0.35 * k });
    } else {
      this.world.particles.dust(_v, 0.3 + k * 0.9);
      this.speedFx.shock(_v.setY(_v.y + 0.3), _up, { r0: 3, r1: 14 + 10 * k, dur: 0.6, opacity: 0.25 * k, color: 0x8a7a62 });
    }
    this.rig.addShake(k * 0.12);
  }

  /** Kondensstreifen, Dampfkegel, Schallmauer, Boost-Stoss */
  _speedEffects(dt, a, playing) {
    const p = this.physics;
    const d = this.dragon;
    d.root.updateMatrixWorld(true);
    d.getWingTip('R', _tipR);
    d.getWingTip('L', _tipL);
    const turnRate = Math.hypot(a.pitchRate || 0, a.yawRate || 0);
    this.speedFx.update(dt, {
      tipR: _tipR,
      tipL: _tipL,
      speed: p.speed,
      turnG: (p.speed * turnRate) / 9.81,
      boost: p.boosting,
      pos: p.position,
      vel: p.velocity,
      camPos: this.camera.position,
      active: playing && !p.grounded,
    });
    // Boost-Start: Ruck, Wusch, Blickwinkel reisst kurz auf
    if (playing && p.boosting && !this.wasBoosting) {
      this.rig.addShake(0.45);
      this.rig.kick(7);
      this.audio.playWhoosh();
    }
    this.wasBoosting = p.boosting;
  }

  _nostrilSmoke(dt, fireI, paused) {
    if (paused) return;
    this.nostrilTimer -= dt;
    if (fireI > 0.05) this.nostrilTimer = Math.min(this.nostrilTimer, 0.5);
    if (this.nostrilTimer <= 0) {
      this.nostrilTimer = fireI > 0 ? 0.06 : 3 + Math.random() * 3;
      this.dragon.getNostril(_mouth);
      const v = this.physics.velocity;
      for (let i = 0; i < (fireI > 0 ? 1 : 4); i++) {
        this.world.particles.smoke.spawn(_mouth.x, _mouth.y, _mouth.z, v.x * 0.8 + (Math.random() - 0.5), v.y * 0.8 + 1, v.z * 0.8 + (Math.random() - 0.5), 1.5, 0.4, 2.5, 1.8, 1.8, 1.8);
      }
    }
  }

  _updateHud(dt) {
    const p = this.physics;
    let mode = '';
    if (p.grounded) mode = p.onWater ? '🌊 Schwimmt' : '⛰ Gelandet';
    else if (p.hovering) mode = '🪽 Schwebt';
    else if (p.braking) mode = 'Bremst';
    else if (p.fold > 0.5) mode = '⬇ Sturzflug';
    else if (p.boosting) mode = '⚡ Boost';
    else if (p.speed < 14) mode = '⚠ Zu langsam';
    if (this.fire.overheated) mode = '🔥 Überhitzt!';
    this.hud.update(dt, {
      speed: p.speed,
      altitude: p.position.y,
      vSpeed: p.velocity.y,
      stamina: p.stamina,
      heat: this.fire.heat,
      exhausted: p.exhausted,
      overheated: this.fire.overheated,
      heading: Math.atan2(-this.physics.forward(_v).x, -_v.z),
      mode,
      outOfBounds: p.outOfBounds,
    });
    const heading = Math.atan2(-_v.x, -_v.z);
    if (settings.get('showMinimap')) {
      this.minimap.draw(dt, p.position, heading, this.state === 'race' && this.race.course ? { list: this.race.course.rings, next: this.race.next } : null);
    }
    if (this.state === 'race' && this.race.course) {
      this.hud.updateRace(this.race.time, this.race.next, this.race.course.rings.length, this.race.record?.time);
      this.hud.ringIndicator(this.race.state !== 'finished' ? this.race.nextRing : null, this.camera, p.position);
    }
    // Blitz → kurzes Aufhellen
    if (this.world.sky.flash > 0.5) this.hud.doFlash(0.15);
  }
}
