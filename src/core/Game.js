// Game = der "Dirigent". Hält alle Systeme zusammen und steuert den Ablauf:
//   loading → menu ↔ customize
//   menu → play (Freiflug, optional Tutorial) / race (Ringrennen)
//   play/race ↔ paused, race → results
import * as THREE from 'three';
import { settings } from './Settings.js';
import { Input, PAD } from './Input.js';
import { AudioManager } from './AudioManager.js';
import { CameraRig } from './CameraRig.js';
import { clamp, damp, smoothstep, formatTime } from './utils.js';
import { World } from '../world/World.js';
import { PLACES } from '../world/Terrain.js';
import { Dragon, loadDragonModel } from '../dragon/Dragon.js';
import { FlightPhysics } from '../dragon/FlightPhysics.js';
import { FireBreath } from '../dragon/FireBreath.js';
import { Customization } from '../dragon/Customization.js';
import { RingRace } from '../gameplay/RingRace.js';
import { Tutorial } from '../gameplay/Tutorial.js';
import { Ballistae } from '../gameplay/Ballistae.js';
import { Adventure } from '../gameplay/Adventure.js';
import { DeathSequence } from '../gameplay/DeathSequence.js';
import { Battle } from '../gameplay/Battle.js';
import { EnemyDragon, ENEMY_NAME } from '../gameplay/EnemyDragon.js';
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
// grass: Grasbüschel rund um die Kamera (count = Anzahl, radius = Sichtweite in m)
const QUALITY = {
  low: { pr: 0.75, shadows: 0, bloom: false, msaa: 0, detail: false, world: { trees: 0.5, particles: 0.5, clouds: 60, rain: 3000, grass: { count: 0, radius: 40 } } },
  medium: { pr: 1.0, shadows: 1024, bloom: true, msaa: 0, detail: true, world: { trees: 0.8, particles: 0.8, clouds: 85, rain: 5000, grass: { count: 9000, radius: 40 } } },
  high: { pr: 1.5, shadows: 2048, bloom: true, msaa: 4, detail: true, world: { trees: 1, particles: 1, clouds: 100, rain: 7000, grass: { count: 24000, radius: 55 } } },
  auto: { pr: 1.25, shadows: 2048, bloom: true, msaa: 0, detail: true, world: { trees: 0.9, particles: 0.9, clouds: 95, rain: 6000, grass: { count: 16000, radius: 50 } } },
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
const _aim = new THREE.Vector3();
const _tipL = new THREE.Vector3();
const _sun = new THREE.Vector3();
const LAND_MAX_AGL = 150; // so hoch darf man höchstens sein, um mit L zu landen (m)

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
    this.landing = false; // Landeanflug läuft (Taste L)
    this.flightInput = { pitch: 0, move: 0, roll: 0, land: false, flap: false, flapPressed: false, dive: false, boost: false, hover: false, fire: false };
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
      this.adv?.onSonic();
    };
    this.wasBoosting = false;
    this.ballistae = new Ballistae(this.scene, this.world);
    this.battle = new Battle(this.scene, this.world, this.ballistae);
    this.enemy = new EnemyDragon(this.scene, this.world, preset.world.particles);
    this.lockOn = false;
    this.biteT = 0;
    this.biteCd = 0;
    this.biteHit = false;
    this.lastRollTap = { rollLeft: -9, rollRight: -9 };
    this.dodgeCd = 0;
    // Feuer des Spielers trifft Soldaten und den feindlichen Drachen
    this._onFlame = (p, r, k) => {
      this.battle.onFlame(p, r, k, 'player');
      this.enemy.takeFlame(p, r, k);
    };
    this.race = new RingRace(this.scene, this.world, this.audio);
    this.tutorial = new Tutorial(this.input, this.audio, {
      ...this.hud.tutorialUI(),
      finished: () => this.hud.toast('Tutorial abgeschlossen!', 'Viel Spass beim Fliegen 🐉', 4),
    });
    this.adv = new Adventure(this);
    this.death = new DeathSequence(this); // Absturz-Szene, wenn das Leben aufgebraucht ist
    this.minimap = new Minimap(document.getElementById('minimap'), this.world.terrain, this.world.settlement, this.world);
    this.menu = new Menu(this);

    this._applyCustomization();
    this.custom.onChange(() => this._applyCustomization());
    this._wireEvents();
    this.applyQuality();
    settings.onChange((k) => {
      if (k === 'quality' || k === 'grass') this.applyQuality();
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
      this.adv.damage(s * 0.25);
      this.battle.onImpact(p.position, s);
      w.destruction.impact(p.position, s, p.forward(_v2).setY(0).normalize()); // Hütten krachen ein
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
      const flung = this.battle.onImpact(_v, s);
      if (flung) this.adv.onSweep(flung);
      w.destruction.blast(_v, 6 + 6 * s, s * 0.8, 'player');
      this.dragon.touchdown(s);
      this._hintOnce('land', 'Gelandet', `Mit ${this._key('flap')} hebst du wieder ab, mit ${this._key('pitchUp')} läufst du.`);
    };
    // Schritte am Boden: dumpfer Tritt, etwas Staub, beim Rennen leichtes Beben
    this.dragon.onStep = (k) => {
      if (this.state !== 'play' && this.state !== 'race') return;
      _v.copy(p.position).setY(p.position.y - 2.5);
      if (!p.onWater) w.particles.dust(_v, 0.15 + k * 0.25);
      this.audio.playImpact(0.06 + k * 0.1);
      this.rig.addShake(k * 0.08);
    };
    p.events.takeoff = () => {
      _v.copy(p.position).setY(p.position.y - 2.4);
      this.battle.onImpact(_v, 0.5);
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
      this.adv.onGoat();
      this.hud.toast(`🐐 Ziege gefunden! ${found}/${total}`, goat.name, 4);
      if (found === total) {
        setTimeout(() => this.hud.toast('✦ Alle Ziegen gefunden!', 'Der goldene Drache ist jetzt freigeschaltet (Drache anpassen).', 7), 1500);
      }
    };
    w.burn.onIgnite = (e) => {
      const d = e ? Math.hypot(e.x - this.physics.position.x, e.z - this.physics.position.z) : 50;
      if (d < 400) this.audio.playIgnite(clamp(1 - d / 400, 0.2, 1) * (e.kind === 'tree' ? 0.5 : 1));
      if (e) this._ignitionBurst(e, d);
      this.adv.onIgnite(e);
      if (e.kind === 'hut') this._hintOnce('hut', '🔥 Das Dach brennt!', 'Regen löscht Feuer. Neustart (Pause-Menü) baut alles wieder auf.');
    };
    this.fire.onOverheat = () => {
      this.audio.playError();
      this._hintOnce('heat', 'Überhitzt!', 'Warte kurz, bis sich der Drache abgekühlt hat.');
    };

    // Armbrust-Türme
    const bl = this.ballistae;
    bl.onShot = (pos) => {
      const d = pos.distanceTo(this.camera.position);
      this.audio.playBallista(clamp(1 - d / 450, 0, 1));
    };
    bl.onHit = (dir, point) => {
      p.velocity.addScaledVector(dir, 7);
      p.stamina = Math.max(0, p.stamina - 0.12);
      this.damage = Math.min(1, this.damage + 0.55);
      this.adv.damage(0.2);
      this.rig.addShake(0.7);
      this.audio.playBoltHit();
      for (let i = 0; i < 25 * w.q.particles; i++) {
        w.particles.sparks.spawn(point.x, point.y, point.z, (Math.random() - 0.5) * 16, Math.random() * 10, (Math.random() - 0.5) * 16, 0.4 + Math.random() * 0.4, 0.3, 0.1, 1, 0.8, 0.5);
      }
      this._hintOnce('bolt', '🏹 Getroffen!', `Zerstöre die Armbrust-Türme mit Feuer (${this._key('fire')}). Enge Kurven helfen beim Ausweichen.`);
    };
    bl.onAim = () => this._hintOnce('aim', '⚠ Armbrust!', 'Eine Armbrust zielt auf dich. Weiche in Kurven aus oder brenne sie nieder!');
    bl.onNearMiss = () => this.adv.onNearMiss();
    bl.onDestroyed = (n, total, tw) => {
      if (tw?.field) this.adv.onSiegeDestroyed();
      this.hud.toast(`🏹 Armbrust zerstört! ${n}/${total}`, n === total ? 'Alle Armbrüste sind still.' : '', 3.5);
      this.audio.playSuccess();
      this.adv.onTowerDestroyed(n, total);
    };

    // Schafe
    w.herds.onCatch = (sheep, pos) => this.adv.onSheep(pos);
    w.herds.onPanic = null;

    // Schlacht und feindlicher Drachenreiter
    this._wireBattle();
    this._wireDestruction();

    // Rennen
    const r = this.race;
    r.events.countdown = (n) => this.hud.center(String(n), '', 0.9);
    r.events.go = () => this.hud.center('LOS!', '', 1.0);
    r.events.ring = (i, n, time, delta) => {
      this.hud.showDelta(delta);
      if (i < n - 1) this.hud.center('', `Ring ${i + 1} / ${n}`, 0.8);
    };
    r.events.finish = (res) => {
      this.adv.onRaceFinish(res);
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

  /** Schlacht (Battle.js) und feindlicher Drachenreiter (EnemyDragon.js) → Töne, Anzeigen, Punkte */
  _wireBattle() {
    const b = this.battle;
    const e = this.enemy;
    const hud = this.hud;
    const vol = (pos) => clamp(1 - pos.distanceTo(this.camera.position) / 900, 0, 1);
    b.on.start = () => {
      hud.center('SCHLACHT!', 'Das Heer der Eisenkrone greift an!', 2.6);
      hud.toast('⚔ Schlacht auf der Ostebene', `Blase das Drachenhorn (${this._key('horn')}), damit deine Truppen angreifen. Vorsicht: Dein Feuer trifft auch die eigenen Leute!`, 7);
      this.audio.playWarHorn(1);
      this.audio.setMusicIntensity(1);
    };
    b.on.wave = (n, total) => {
      this.audio.playWarHorn(0.8);
      hud.toast(`⚔ Verstärkung! Welle ${n}/${total}`, n === total ? 'Der Anführer der Eisenkrone führt die letzte Welle an. Besiege ihn!' : 'Neue Truppen der Eisenkrone kommen aus dem Heerlager im Osten.', 5);
    };
    b.on.death = (sold, cause) => this.adv.onSoldierDeath(sold, cause);
    b.on.commander = (cause) => this.adv.onCommander(cause);
    b.on.arrowHit = () => {
      this.adv.damage(0.006);
      this.audio.playArrowHit();
      this.rig.addShake(0.05);
    };
    b.on.clash = (pos) => this.audio.playClash(vol(pos) * 0.8);
    b.on.shoot = (pos) => {
      if (Math.random() < 0.25) this.audio.playBow(vol(pos) * 0.6);
    };
    b.on.noise = (k) => this.audio.playBattleNoise(k);
    b.on.enemyDragon = () => {
      const C = b.C;
      e.spawn(_v.set(C.x + 700, C.y + 220, C.z - 250), this.physics.position);
      hud.center('DRACHENREITER!', `${ENEMY_NAME} greift an`, 2.6);
      hud.toast('🐉 Ein feindlicher Drachenreiter!', `Er kündigt Angriffe an: Glüht sein Maul, weich aus (2× ${this._key('rollLeft')} oder ${this._key('rollRight')}). Mit ${this._key('lock')} visierst du ihn an, mit ${this._key('bite')} beisst du zu.`, 8);
    };
    b.on.victory = (info) => {
      hud.center('SIEG!', info.commander ? 'Der feindliche Anführer ist gefallen' : 'Das Heer der Eisenkrone flieht', 3.5);
      this.audio.playFinish(true);
      this.audio.setMusicIntensity(0);
      this.adv.onBattleWon(info);
      e.leave();
    };
    b.on.defeat = () => {
      hud.center('NIEDERLAGE', 'Deine Truppen fliehen … die nächste Schlacht kommt', 3.5);
      this.audio.playError();
      this.audio.setMusicIntensity(0);
      e.leave();
    };
    // feindlicher Drache
    e.on.roar = (pos, angry) => {
      this.audio.playRoar(1.3, vol(pos) * 1.4 + 0.25);
      if (angry) hud.toast(`😡 ${ENEMY_NAME} ist wütend!`, 'Er ist jetzt schneller und schiesst mehr Feuerbälle.', 4);
    };
    e.on.growl = (pos) => this.audio.playRoar(1.6, vol(pos) * 0.5);
    e.on.fireball = (pos) => this.audio.playFireball(vol(pos));
    e.on.hitPlayer = (amount) => {
      if (this.adv.damage(amount)) {
        this.damage = Math.min(1, this.damage + amount * 3);
        this.rig.addShake(amount * 2);
      }
    };
    e.on.explode = (pos) => {
      const k = vol(pos);
      this.audio.playImpact(0.4 + k * 0.8);
      this.rig.addShake(k * 0.6);
      this.speedFx.shock(pos, _up, { r0: 2, r1: 26, dur: 0.6, opacity: 0.3 });
    };
    e.on.bump = (dir) => {
      this.physics.velocity.addScaledVector(dir, -9);
      this.adv.damage(0.05);
      this.rig.addShake(0.6);
      this.audio.playImpact(0.7);
    };
    e.on.strafe = () => hud.toast('⚠ Der Drachenreiter greift deine Truppen an!', 'Halte ihn auf – verfolge ihn!', 3.5);
    e.on.phase2 = () => {};
    e.on.defeated = () => {
      hud.center('BESIEGT!', `${ENEMY_NAME} stürzt ab`, 3);
      this.adv.onEnemyDragonDefeated();
      this.lockOn = false;
    };
    e.on.crash = (pos) => {
      const k = vol(pos);
      this.audio.playBoom();
      this.rig.addShake(0.4 + k);
      this.world.particles.dust(pos, 2);
      this.speedFx.shock(pos, _up, { r0: 4, r1: 60, dur: 1, opacity: 0.35, color: 0x8a7a62 });
    };
  }

  /** Zerstörbare Gebäude (Destruction.js) → Töne, Beben, Punkte, Hinweis */
  _wireDestruction() {
    const D = this.world.destruction;
    const cam = this.camera.position;
    const vol = (x, z) => clamp(1 - Math.hypot(x - cam.x, z - cam.z) / 700, 0, 1);
    D.onCollapse = (st, cause, src) => {
      this.audio.playCollapse(vol(st.x, st.z) * 1.1, st.kind === 'tower');
      const d = Math.hypot(st.x - this.physics.position.x, st.z - this.physics.position.z);
      if (d < 90) this.rig.addShake((1 - d / 90) * 0.5);
      this.adv.onCollapse(st, cause, src);
      if (st.kind === 'hut' && this.state === 'play') {
        this._hintOnce('collapse', '🏚 Eingestürzt!', 'Gebäude stürzen ein, wenn sie lange brennen – oder wenn du mit voller Wucht hineinkrachst, daneben landest, zubeisst oder dagegen drückst.');
      }
    };
    D.onDamage = (st) => this.audio.playCreak(vol(st.x, st.z));
    D.onThud = (p, s) => {
      this.audio.playImpact(clamp((0.2 + s * 0.6) * vol(p.x, p.z), 0, 1.3));
      const d = p.distanceTo(this.physics.position);
      if (d < 120) this.rig.addShake((1 - d / 120) * 0.6 * s);
    };
  }

  /** Wohin der Kopf zielt: angepeilter Gegner, oder ein Gegner vor dem Drachen (Zielhilfe) */
  _aimDir() {
    const e = this.enemy;
    if (!e.active || this.state !== 'play') return null;
    const p = this.physics.position;
    _aim.subVectors(e.position, p);
    const d = _aim.length();
    _aim.divideScalar(d || 1);
    if (this.lockOn) return _aim;
    if (d < 260 && _aim.dot(this.physics.forward(_v)) > 0.88) return _aim;
    return null;
  }

  /** Drachenhorn (G): eigene Truppen sammeln */
  _horn() {
    this.audio.playHorn();
    this.speedFx.shock(this.physics.position, _up, { r0: 4, r1: 90, dur: 1.4, opacity: 0.35, color: 0xffd35a });
    const r = this.battle.horn(this.physics.position);
    if (r === 'rally') {
      this.hud.center('', '⚔ Deine Truppen stürmen vor!', 2);
      this.adv.onHorn();
    } else if (r === 'cooldown') this.hud.toast('Das Horn braucht noch Luft …', '', 1.5);
    else if (r === 'far' || r === 'none') this.hud.toast('Das Horn hallt über das Land …', 'Deine Truppen stehen auf der Ostebene (Südosten).', 3);
  }

  /** Biss (X): kurzer Vorstoss, schnappt zu – Soldaten vor dem Maul und der feindliche Drache */
  _bite() {
    if (this.biteCd > 0) return;
    const p = this.physics;
    this.biteCd = 1.1;
    this.biteT = 0.45;
    this.biteHit = false;
    if (!p.grounded) p.velocity.addScaledVector(p.forward(_v), 14);
    this.audio.playRoar(1.9, 0.35);
  }

  _biteUpdate(dt) {
    this.biteCd = Math.max(0, this.biteCd - dt);
    if (this.biteT <= 0) return 0;
    this.biteT -= dt;
    // zuschnappen nach ca. 0.2 s
    if (!this.biteHit && this.biteT < 0.25) {
      this.biteHit = true;
      this.audio.playBite();
      this.dragon.getMouth(_mouth, _dir);
      const n = this.battle.onBite(_mouth, _dir);
      this.world.destruction.blast(_mouth, 5, 0.55, 'player', _dir);
      const hitDragon = this.enemy.takeBite(_mouth, _dir);
      if (hitDragon) {
        this.rig.addShake(0.6);
        this.adv.onBiteHit(true);
      } else if (n > 0) this.adv.onBiteHit(false, n);
    }
    return this.biteT > 0.25 ? 1 : 0.3;
  }

  /** Ausweichrolle: 2× schnell A oder D */
  _dodge(dir) {
    const p = this.physics;
    if (this.dodgeCd > 0 || p.grounded || p.stamina < 0.12) return;
    this.dodgeCd = 0.9;
    p.stamina -= 0.12;
    p.velocity.addScaledVector(p.right(_v), dir * 24);
    this.dragon.rollT = 0;
    this.dragon.rollDir = dir;
    this.adv.onDodge();
    this.audio.playWhoosh();
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
    this.world.grass.setQuality(settings.get('grass') ? q.world.grass.count : 0, q.world.grass.radius);
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
    this.landing = false;
    this.death.cancel();
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
    this.adv.startRun();
    if (tutorial) this.tutorial.start();
    else {
      this.tutorial.stop();
      this._hintOnce('welcome', 'Willkommen, Drachenreiter!', `Drücke ${this._key('help')} für die Steuerung. Tipp: Das Tutorial erklärt alles.`);
    }
  }

  startRace(courseId, ghost) {
    this.landing = false;
    this.death.cancel();
    this.audio.init();
    if (this.battle.state !== 'waiting') this.battle.reset();
    this.enemy.despawn();
    this.lockOn = false;
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
    this.landing = false;
    this.death.cancel();
    this.world.reset();
    this.battle.reset();
    this.enemy.despawn();
    this.lockOn = false;
    if (this.mode === 'race') this.retryRace();
    else this.startFreeFlight();
  }

  toMenu() {
    this.landing = false;
    this.death.cancel();
    this.race.clear();
    this.battle.reset();
    this.enemy.despawn();
    this.lockOn = false;
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
    this.physics.agl = 120;
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
    this.physics.agl = 55;
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
      lock: this.lockOn && this.enemy.active ? this.enemy.position : null,
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
      fireI = this.fire.update(dt, wantsFire, this.dragon, this.physics.velocity, playing ? this.world.burn : null, this.world.terrain, playing ? this._onFlame : null);
    }

    // Drachen-Modell an die Physik hängen und animieren
    const d = this.dragon;
    d.root.position.copy(this.physics.position);
    d.root.quaternion.copy(this.physics.quaternion);
    const a = this.physics.animState(this.anim);
    a.land = this.landing;
    a.dead = 0;
    a.crouch = 0;
    this.death.decorate(a);
    a.bite = this._biteUpdate(paused ? 0 : dt);
    a.look = this._aimDir();
    a.fire = fireI;
    this.roarAnim = Math.max(0, this.roarAnim - dt);
    a.roar = this.roarAnim > 0 ? 1 : 0;
    if (!paused) d.update(dt, a);
    this._nostrilSmoke(dt, fireI, paused);
    if (!paused) this._speedEffects(dt, a, playing);
    if (!paused) {
      // Schlacht und feindlicher Drachenreiter
      const pp = this.physics;
      const free = this.state === 'play' && this.mode === 'free' && !this.tutorial.active;
      this.battle.update(dt, { dragonPos: pp.position, dragonVel: pp.velocity, free, camPos: this.camera.position });
      this.enemy.update(dt, { playerPos: pp.position, playerVel: pp.velocity, playerActive: free, battle: this.battle });
      if (free) {
        let flung = pp.grounded ? 0 : this.battle.lowPass(pp.position, pp.velocity, pp.agl ?? 99);
        // am Boden: wer unter die Füsse kommt, wird zertrampelt
        this.stompT = (this.stompT || 0) - dt;
        if (pp.grounded && Math.abs(pp.walkSpeed) > 1 && this.stompT <= 0) {
          this.stompT = 0.35;
          _v.copy(pp.position).setY(pp.position.y - 2.4);
          if (this.battle.state !== 'idle') flung += this.battle.soldiers.blast(_v, 4.5, 5, 2, null, true);
          // Marktstände zertrampeln, gegen Hütten drücken
          this.world.destruction.blast(_v, 6, 0.4, 'player', pp.forward(_v2).setY(0).normalize());
        }
        if (flung) this.adv.onSweep(flung);
      }
      if (!this.enemy.active && this.lockOn) this.lockOn = false;
      this.ballistae.update(dt, {
        dragonPos: this.physics.position,
        dragonVel: this.physics.velocity,
        active: this.state === 'play' && settings.get('enemies') && !this.tutorial.active,
      });
    }

    // Welt
    // Luftstoss der Flügel drückt das Gras weg: stark beim Abheben/Landen/Schweben,
    // beim Laufen teilt nur der Körper das Gras
    const pp = this.physics;
    const nearGround = smoothstep(28, 4, pp.agl ?? 99);
    this.world.update(dt, {
      camera: this.camera,
      focus: pp.position,
      camVel: this.rig.camVelocity,
      dragonPos: pp.position,
      dragonSpeed: pp.speed,
      paused,
      fireColor: this.fireColor,
      downwash: pp.grounded ? 0.45 : nearGround * (0.25 + 0.75 * pp.flapAmp),
      downwashRadius: pp.grounded ? 6 : 18,
    });
    // Ziegen und Schafe
    this.world.goats.update(paused ? 0 : dt, this.physics.position, this.audio, playing);
    this.world.herds.update(paused ? 0 : dt, {
      dragonPos: this.physics.position,
      agl: playing ? this.physics.agl : 999,
      canCatch: playing && this.physics.speed < 85,
      audio: playing ? this.audio : null,
      roar: this.roarPulse,
    });
    this.roarPulse = false;
    // Leben, Punkte, Aufträge
    this.adv.update(paused ? 0 : dt);
    if (this.adv.active && this.adv.health < 0.3) this.damage = Math.max(this.damage, (0.3 - this.adv.health) * 1.6 * (0.75 + 0.25 * Math.sin(this.time * 6)));

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
      waterfall: w.canyon.loudness(this.camera.position),
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
      fade: this.death.fade,
      damage: this.damage,
      night: w.sky.night,
    });
    this._updateSunFx(w);
    // Belichtung: nachts und in der Dämmerung heller (wie ein Auge, das sich anpasst)
    this.renderer.toneMappingExposure = (0.95 + w.sky.night * 0.9 + w.sky.twilight * 0.45) * (1 + w.weather.overcast * 0.12);
    this.post.render(dt);
    input.endFrame();
  }

  /**
   * Sonnenstrahlen und Linsen-Reflexe: Wo steht die Sonne auf dem Bildschirm, wie stark?
   * Am stärksten bei tiefer Sonne (Abend, Morgen) und klarem Himmel.
   */
  _updateSunFx(w) {
    const sky = w.sky;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const facing = cam.getWorldDirection(_sun).dot(sky.sunDir); // 1 = genau in die Sonne
    const up = smoothstep(-0.03, 0.04, sky.sunDir.y);
    if (facing < 0.05 || up <= 0 || !settings.get('sunRays')) {
      this.post.setSun(0.5, 0.5, sky.sunColor, 0, 0, cam.aspect);
      return;
    }
    _sun.copy(cam.position).addScaledVector(sky.sunDir, 10000).project(cam);
    const x = _sun.x * 0.5 + 0.5;
    const y = _sun.y * 0.5 + 0.5;
    const edge = Math.min(x, 1 - x, y, 1 - y); // < 0: Sonne ausserhalb des Bildes
    const clear = (1 - w.weather.overcast) ** 2 * (1 - w.inCloud) * (1 - w.weather.darkness);
    const low = 1 + 0.8 * (1 - smoothstep(0.06, 0.45, sky.sunDir.y));
    const rays = 0.4 * up * clear * low * smoothstep(-0.25, 0.03, edge) * smoothstep(0.05, 0.35, facing);
    const flare = up * clear * smoothstep(0.0, 0.05, edge);
    // so hell ist klarer Himmel neben der Sonne (dunklere Wolken davor halten Licht zurück)
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const skyRef = lum(sky.horizon) + 0.5 * lum(sky.sunColor);
    this.post.setSun(x, y, sky.sunColor, rays, flare, cam.aspect, skyRef);
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
    fi.move = input.getMove();
    fi.roll = input.getRoll();
    fi.flap = input.isDown('flap');
    fi.flapPressed = input.pressed('flap');
    fi.dive = input.isDown('dive');
    fi.boost = input.isDown('boost');
    fi.hover = input.isDown('hover');
    fi.fire = input.isDown('fire');

    // Absturz-Szene: bewusstlos → keine Steuerung, kein Feuer, keine Tasten.
    // DeathSequence bewegt den Drachen selbst (statt der Flugphysik).
    if (this.death.active) {
      fi.pitch = fi.move = fi.roll = 0;
      fi.flap = fi.flapPressed = fi.dive = fi.boost = fi.hover = fi.fire = fi.land = false;
      this.death.update(dt);
      return;
    }

    // Landen (L): Landeanflug bis zum Boden. Abbrechen: L nochmal, Flügelschlag oder Boost.
    if (p.grounded) this.landing = false;
    if (input.pressed('land')) {
      if (p.grounded) this.hud.toast('Du stehst schon am Boden', `Abheben mit ${this._key('flap')}`, 2);
      else if (this.landing) {
        this.landing = false;
        this.hud.toast('Landung abgebrochen', '', 1.5);
      } else if ((p.agl ?? 999) > LAND_MAX_AGL) {
        this.hud.toast('Zu hoch zum Landen', `Flieg tiefer als ${LAND_MAX_AGL} m, dann ${this._key('land')}.`, 3);
      } else {
        this.landing = true;
        this.hud.toast('🛬 Landeanflug', `Abbrechen mit ${this._key('flap')}`, 2);
      }
    }
    if (this.landing && (fi.flapPressed || fi.boost)) this.landing = false;
    fi.land = this.landing;

    if (!p.grounded && !this.landing && (p.agl ?? 999) < 40 && p.speed < 30) {
      this._hintOnce('landtip', 'Landen', `Drück ${this._key('land')}: Der Drache bremst und setzt sanft auf.`);
    }

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
      this.roarPulse = true;
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
      this.battle.onRoar(p.position);
    }
    // Kampf: Drachenhorn, Biss, Anvisieren, Ausweichrolle (2× schnell A oder D)
    if (this.state === 'play') {
      if (input.pressed('horn')) this._horn();
      if (input.pressed('bite')) this._bite();
      if (input.pressed('lock')) {
        if (this.enemy.active && this.enemy.position.distanceTo(p.position) < 1800) {
          this.lockOn = !this.lockOn;
          this.hud.toast(this.lockOn ? '🎯 Ziel erfasst' : 'Ziel gelöst', this.lockOn ? 'Die Kamera behält den Drachenreiter im Blick, dein Feuer zielt auf ihn.' : '', 2);
        } else this.hud.toast('Kein Gegner in der Nähe', '', 1.5);
      }
    }
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    for (const [act, dir] of [['rollLeft', -1], ['rollRight', 1]]) {
      if (input.pressed(act)) {
        if (this.time - this.lastRollTap[act] < 0.3) {
          this._dodge(dir);
          this.lastRollTap[act] = -9;
        } else this.lastRollTap[act] = this.time;
      }
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
    // Schlacht, Drachenreiter, Zielkreis (nur im freien Flug)
    const free = this.adv.active;
    const b = this.battle;
    const near = b.state !== 'idle' && p.position.distanceTo(b.C) < 900;
    this.hud.updateBattle(free && (near || b.state === 'fight') ? b.status() : null, this._key('horn'));
    const e = this.enemy;
    this.hud.updateBoss(free && e.visible && e.state !== 'wreck' && e.state !== 'leave' ? { name: ENEMY_NAME, k: e.hp / 100, angry: e.phase2, hurt: e.hurtFlash > 0 } : null);
    const aim = free && e.active ? this._aimDir() : null;
    this.hud.lockReticle(aim ? e.position : null, this.camera, p.position, this.lockOn);
    // Blitz → kurzes Aufhellen
    if (this.world.sky.flash > 0.5) this.hud.doFlash(0.15);
  }
}
