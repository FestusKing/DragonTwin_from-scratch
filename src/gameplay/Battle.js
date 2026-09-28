// Schlacht auf der Ostebene (wie in DragonTwin): Das feindliche Heer der "Eisenkrone" marschiert
// von Osten auf das Dorf zu. Die Dorfwache (blau) stellt sich ihm entgegen. Der Drache entscheidet
// die Schlacht vom Himmel aus:
//  - Feuer auf die feindlichen Reihen (Vorsicht: auch die eigenen Leute brennen!)
//  - im Tiefflug durch die Reihen fegen, landen, brüllen, zubeissen → Soldaten fliegen durch die Luft
//  - mit dem Drachenhorn (G) die eigenen Truppen sammeln: sie stürmen los und kämpfen härter
// Der Feind wehrt sich mit Bogenschützen, Belagerungs-Armbrüsten und einem eigenen
// Drachenreiter (EnemyDragon.js), der mit der zweiten Welle kommt.
// Das feindliche Heer kommt in 3 Wellen aus dem Heerlager im Osten. Der Anführer führt die letzte an.
// Sieg: der Anführer fällt oder von der letzten Welle ist fast niemand mehr übrig → Flucht.
import * as THREE from 'three';
import { PLACES } from '../world/Terrain.js';
import { storage } from '../core/utils.js';
import { Soldiers, ALLY, ENEMY, INFANTRY, ARCHER, COMMANDER } from './Soldiers.js';

const KEY = 'dragontwin.battle.v1';
const START_RADIUS = 650; // so nah muss der Drache kommen, damit die Schlacht beginnt
const HORN_COOLDOWN = 22;
const RALLY_TIME = 18;
const ADVANCE = 3.0; // Marschtempo des feindlichen Heeres (m/s)
const ALLY_X = -110; // Aufstellung relativ zur Mitte des Schlachtfelds
const ENEMY_X = 130;
const CAMP_X = 400; // Heerlager: weiter hinten tauchen keine Verstärkungen auf
const WAVES = 3;
const WAVE_TIME = 60; // spätestens nach so vielen Sekunden kommt die nächste Welle

const _v = new THREE.Vector3();

/** Banner (Stange + wehende Fahne) für die Anführer */
function makeBanner(color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 6.5, 6), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 }));
  pole.position.y = 3.25;
  g.add(pole);
  const flagGeo = new THREE.PlaneGeometry(2.2, 1.4, 8, 4);
  flagGeo.translate(1.1, 0, 0);
  const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
  flag.position.set(0.05, 5.7, 0);
  g.add(flag);
  g.userData.flag = flag;
  g.userData.base = flagGeo.getAttribute('position').array.slice();
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

export class Battle {
  constructor(scene, world, ballistae) {
    this.scene = scene;
    this.world = world;
    this.terrain = world.terrain;
    this.ballistae = ballistae;
    this.C = new THREE.Vector3(PLACES.battle.x, PLACES.battle.h, PLACES.battle.z);
    this.soldiers = new Soldiers(scene, world.terrain, world.particles);
    this.q = world.q.particles;
    const saved = storage.get(KEY, {});
    this.wins = saved.wins || 0;
    this.state = 'idle';
    this.time = 0;
    this.stateT = 0;
    this.front = [0, 0];
    this.orders = ['hold', 'hold'];
    this.rally = [0, 0];
    this.hornCd = 0;
    this.initial = [1, 1];
    this.commanders = [null, null];
    this.banners = [makeBanner(0x2d5aa8), makeBanner(0xa22020)];
    for (const b of this.banners) {
      b.visible = false;
      scene.add(b);
    }
    this.dragonCalled = false;
    this.clashT = 0;
    // Belagerungs-Armbrüste des Feindes (brennbar, schiessen nur während der Schlacht)
    this.siege = [];
    for (const dz of [-70, 0, 70]) {
      const x = this.C.x + 285;
      const z = this.C.z + dz;
      const tw = ballistae.addField(x, this.terrain.heightAt(x, z), z);
      this.siege.push(tw);
    }
    this._buildCamp(scene);
    // Ereignisse (setzt Game.js / Adventure.js)
    this.on = {};
    this.soldiers.onDeath = (s, cause) => this._onDeath(s, cause);
    this.soldiers.onArrowHitDragon = () => this.on.arrowHit?.();
    this.soldiers.onClash = (p) => this.on.clash?.(p);
    this.soldiers.onShoot = (p) => this.on.shoot?.(p);
    this.setup();
  }

  /** Feindliches Heerlager im Osten: Zelte (brennbar) und Lagerfeuer */
  _buildCamp(scene) {
    const t = this.terrain;
    this.tents = [];
    const spots = [[380, -120], [410, -40], [395, 45], [430, 120], [460, -80], [470, 30]];
    for (const [dx, dz] of spots) {
      const x = this.C.x + dx;
      const z = this.C.z + dz;
      const y = t.heightAt(x, z);
      const mat = new THREE.MeshStandardMaterial({ color: 0xcdbb98, roughness: 0.95 });
      const base = mat.color.clone();
      const tent = new THREE.Mesh(new THREE.ConeGeometry(4.2, 5, 8, 1, true), mat);
      tent.position.set(x, y + 2.4, z);
      tent.rotation.y = Math.random() * 3;
      tent.castShadow = tent.receiveShadow = true;
      scene.add(tent);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ color: 0xa22020, side: THREE.DoubleSide }));
      flag.position.set(x + 0.55, y + 5.6, z);
      scene.add(flag);
      const e = this.world.burn.addEntity({
        kind: 'hut',
        x,
        y: y + 2,
        z,
        r: 5,
        h: 5,
        w: 7,
        d: 7,
        fuel: 12,
        onProgress: (k) => {
          mat.color.copy(base).lerp(new THREE.Color(0x151210), Math.min(1, k * 1.5));
          tent.scale.setScalar(1 - Math.max(0, k - 0.5) * 0.9);
          flag.visible = k < 0.3;
        },
        onBurnt: () => (tent.visible = false),
        onReset: () => {
          mat.color.copy(base);
          tent.scale.setScalar(1);
          tent.visible = true;
          flag.visible = true;
        },
      });
      this.tents.push(e);
    }
  }

  /** Heere in Aufstellung bringen (warten auf den Drachen) */
  setup() {
    const S = this.soldiers;
    S.clear();
    const C = this.C;
    this.level = Math.min(this.wins, 4);
    // Verbündete im Westen (Blick nach Osten = +x → yaw +90°)
    const east = Math.PI / 2;
    this._rows(ALLY, INFANTRY, 112, C.x + ALLY_X, C.x + ALLY_X, -2.6, 28, 2.5, east);
    this._rows(ALLY, ARCHER, 30, C.x + ALLY_X - 22, C.x + ALLY_X - 22, -2.6, 30, 3, east);
    this.commanders[ALLY] = S.add(ALLY, COMMANDER, C.x + ALLY_X - 32, C.z, east);
    this.commanders[ENEMY] = null;
    this.wave = 0;
    this.waveT = 0;
    this.waveSize = 0;
    this.spawned = 0;
    this._spawnWave(true);
    this.initial = S.counts();
    this.front = [0, 0];
    this.orders = ['hold', 'hold'];
    this.rally = [0, 0];
    this.dragonCalled = false;
    this.state = 'waiting';
    this.stateT = 0;
    this.banners[ALLY].visible = true;
    this.banners[ENEMY].visible = false;
    // Belagerungs-Armbrüste und Zelte wieder aufbauen
    for (const tw of this.siege) {
      tw.enabled = false;
      const e = tw.burn;
      if (e.state !== 0) {
        e.state = 0;
        e.heat = 0;
        e.t = 0;
        e.onReset?.();
      }
    }
    for (const e of this.tents) {
      if (e.state !== 0) {
        e.state = 0;
        e.heat = 0;
        e.t = 0;
        e.onReset?.();
      }
    }
  }

  /**
   * Reihen aufstellen: n Soldaten, perRow pro Reihe. x0 = wo sie erscheinen, slot0 = ihr Platz
   * in der Formation (Verstärkungen erscheinen im Lager und laufen zu ihrem Platz).
   */
  _rows(team, type, n, x0, slot0, dxRow, perRow, spacing, yaw) {
    const C = this.C;
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      const w = (Math.min(perRow, n - r * perRow) - 1) * spacing;
      const jx = (Math.random() - 0.5) * 0.6;
      const z = C.z - w / 2 + c * spacing + (Math.random() - 0.5) * 0.6;
      const s = this.soldiers.add(team, type, x0 + r * dxRow + jx, z, yaw);
      if (!s) return;
      s.slotX = slot0 + r * dxRow + jx;
    }
  }

  /** Nächste Welle der Eisenkrone. first = gleich in Aufstellung (sonst aus dem Lager) */
  _spawnWave(first = false) {
    const C = this.C;
    const S = this.soldiers;
    const west = -Math.PI / 2;
    this.wave++;
    this.waveT = 0;
    const k = 1 + this.level * 0.12; // nach jedem Sieg etwas stärker
    const inf = Math.round([96, 84, 92][this.wave - 1] * k);
    const arch = Math.round([24, 20, 26][this.wave - 1] * k);
    const before = S.counts()[ENEMY];
    // Platz in der Formation: hinter der aktuellen Front (front[ENEMY] wird beim Laufen addiert)
    const slot = C.x + ENEMY_X + (first ? 0 : 8);
    // Verstärkung erscheint hinter der feindlichen Front (höchstens beim Heerlager) und rennt nach vorn
    const x0 = first ? slot : C.x + Math.min(CAMP_X, ENEMY_X + this.front[ENEMY] + 150);
    this._rows(ENEMY, INFANTRY, inf, x0, slot, 2.6, 32, 2.4, west);
    this._rows(ENEMY, ARCHER, arch, x0 + 22, slot + 22, 2.6, 30, 3, west);
    if (this.wave === WAVES) {
      this.commanders[ENEMY] = S.add(ENEMY, COMMANDER, x0 + 34, C.z, west);
      if (this.commanders[ENEMY]) this.commanders[ENEMY].slotX = slot + 34;
      this.banners[ENEMY].visible = true;
    }
    this.waveSize = S.counts()[ENEMY] - before;
    this.spawned += this.waveSize;
  }

  get active() {
    return this.state === 'fight';
  }

  /** Mitte der eigenen (lebenden) Truppen – Ziel für den Tiefangriff des feindlichen Drachen */
  allyCentroid() {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const s of this.soldiers.list) {
      if (s.alive && s.team === ALLY && s.state !== 'air') {
        x += s.x;
        z += s.z;
        n++;
      }
    }
    if (!n) return null;
    x /= n;
    z /= n;
    return new THREE.Vector3(x, this.terrain.heightAt(x, z), z);
  }

  /** Alles zurück (Neustart, Menü): neue Heere in Aufstellung */
  reset() {
    this.setup();
  }

  /** Zahlen für die Anzeige */
  status() {
    const c = this.soldiers.counts();
    return {
      state: this.state,
      allies: c[ALLY],
      alliesTotal: this.initial[ALLY],
      enemies: c[ENEMY],
      enemiesTotal: this.spawned,
      wave: this.wave,
      waves: WAVES,
      horn: this.hornCd > 0 ? 1 - this.hornCd / HORN_COOLDOWN : 1,
      rally: this.rally[ALLY],
      siege: this.siege.filter((s) => !s.destroyed).length,
      wins: this.wins,
    };
  }

  // ------------------------------------------------------------ Aktionen des Drachen
  /** Drachenhorn: eigene Truppen sammeln (Rückgabe: true, wenn es gewirkt hat) */
  horn(dragonPos) {
    if (this.hornCd > 0) return 'cooldown';
    this.hornCd = HORN_COOLDOWN;
    if (this.state !== 'fight' && this.state !== 'waiting') return 'none';
    if (dragonPos.distanceTo(this.C) > 1400) return 'far';
    if (this.state === 'waiting') this._start();
    this.rally[ALLY] = 1;
    this.rallyT = RALLY_TIME;
    this.orders[ALLY] = 'charge';
    // Feinde in der Nähe des Drachen erschrecken
    this.soldiers.scare(dragonPos, 90, ENEMY);
    return 'rally';
  }

  onFlame(p, radius, amount, src = 'player') {
    if (this.state === 'idle') return;
    this.soldiers.heat(p, radius + 1.5, amount, src);
  }

  /** Landung / Aufprall / Abheben neben Soldaten */
  onImpact(p, strength) {
    if (this.state === 'idle') return 0;
    return this.soldiers.blast(p, 12 + 10 * strength, 9 + 8 * strength, 6 + 4 * strength, null, strength > 0.9);
  }

  onGust(p, strength) {
    if (this.state === 'idle') return 0;
    return this.soldiers.blast(p, 14, 5 + 5 * strength, 3.5);
  }

  onRoar(p) {
    if (this.state === 'idle') return;
    this.soldiers.scare(p, 110, ENEMY);
    this.soldiers.blast(p, 10, 7, 3);
  }

  /** Biss/Krallen: vor dem Maul fliegen Soldaten weg (tödlich) */
  onBite(p, dir) {
    if (this.state === 'idle') return 0;
    _v.copy(dir).multiplyScalar(14);
    return this.soldiers.blast(p, 8, 14, 8, _v, true);
  }

  /** Tiefflug über die Reihen: der Drachenkörper fegt Soldaten um */
  lowPass(p, vel, agl) {
    if (this.state === 'idle' || agl > 9 || vel.lengthSq() < 20 * 20) return 0;
    _v.copy(p);
    _v.y -= 2.5;
    return this.soldiers.sweep(_v, vel, 8);
  }

  // ------------------------------------------------------------ Ablauf
  _start() {
    this.state = 'fight';
    this.stateT = 0;
    this.orders = ['hold', 'advance'];
    for (const tw of this.siege) tw.enabled = true;
    this.on.start?.();
  }

  _onDeath(s, cause) {
    if (s.type === COMMANDER && this.state === 'fight') {
      if (s.team === ENEMY) this.on.commander?.(cause);
    }
    this.on.death?.(s, cause);
  }

  /**
   * ctx = { dragonPos, dragonVel, dragonActive (spielt, nicht im Menü), camPos, free (Freiflug) }
   */
  update(dt, ctx) {
    this.time += dt;
    this.stateT += dt;
    this.hornCd = Math.max(0, this.hornCd - dt);
    if (this.rallyT > 0) {
      this.rallyT -= dt;
      this.rally[ALLY] = Math.max(0, Math.min(1, this.rallyT / 4));
    }
    const S = this.soldiers;
    const dist = Math.hypot(ctx.dragonPos.x - this.C.x, ctx.dragonPos.z - this.C.z);

    if (this.state === 'waiting' && ctx.free && dist < START_RADIUS) this._start();

    if (this.state === 'fight') {
      const c = S.counts();
      // Feind rückt vor, bis sich die Heere treffen
      const gap = ENEMY_X + this.front[ENEMY] - (ALLY_X + this.front[ALLY]);
      if (this.orders[ENEMY] === 'advance') {
        this.front[ENEMY] -= ADVANCE * dt;
        if (gap < 45) this.orders[ENEMY] = 'charge';
      }
      // eigene Truppen halten, bis der Feind nah ist (oder das Horn erklingt)
      if (this.orders[ALLY] === 'hold' && gap < 70) this.orders[ALLY] = 'charge';
      if (this.orders[ALLY] === 'charge' && gap > 15) this.front[ALLY] += 2.6 * dt * (1 + this.rally[ALLY]);
      // Verstärkung: wenn die aktuelle Welle stark geschrumpft ist (oder nach einer Weile)
      this.waveT += dt;
      if (this.wave < WAVES && (c[ENEMY] < this.waveSize * 0.4 || this.waveT > WAVE_TIME)) {
        this._spawnWave();
        this.on.wave?.(this.wave, WAVES);
      }
      // feindlicher Drachenreiter kommt mit der zweiten Welle (oder wenn es lange dauert)
      if (!this.dragonCalled && (this.wave >= 2 || this.stateT > 90)) {
        this.dragonCalled = true;
        this.on.enemyDragon?.();
      }
      // Sieg oder Niederlage?
      const cmd = this.commanders[ENEMY];
      const cmdDead = this.wave === WAVES && cmd && !cmd.alive;
      if (this.wave === WAVES && (cmdDead || c[ENEMY] < Math.max(8, this.waveSize * 0.2))) {
        this.orders[ENEMY] = 'flee';
        this.state = 'won';
        this.stateT = 0;
        this.wins++;
        storage.set(KEY, { wins: this.wins });
        for (const tw of this.siege) tw.enabled = false;
        this.on.victory?.({ commander: cmdDead, allies: c[ALLY], alliesTotal: this.initial[ALLY] });
      } else if (c[ALLY] < this.initial[ALLY] * 0.2) {
        this.orders[ALLY] = 'flee';
        this.state = 'lost';
        this.stateT = 0;
        for (const tw of this.siege) tw.enabled = false;
        this.on.defeat?.();
      }
      // Kampflärm
      this.clashT -= dt;
      if (this.clashT <= 0) {
        this.clashT = 0.25 + Math.random() * 0.4;
        if (dist < 900) this.on.noise?.(Math.max(0, 1 - dist / 900));
      }
    } else if (this.state === 'won' || this.state === 'lost') {
      // nach einer Weile (und wenn der Drache weit weg ist) stellen sich neue Heere auf
      if (this.stateT > 45 && dist > 900) this.setup();
    }

    // Banner folgen den Anführern
    for (let i = 0; i < 2; i++) {
      const cmd = this.commanders[i];
      const b = this.banners[i];
      if (!cmd) continue;
      b.visible = cmd.alive || cmd.dead < 8;
      b.position.set(cmd.x - Math.cos(cmd.yaw) * 0.5, cmd.y, cmd.z + Math.sin(cmd.yaw) * 0.5);
      b.rotation.set(cmd.alive ? 0 : 1.2, cmd.yaw, 0);
      // Fahne weht
      const f = b.userData.flag.geometry.getAttribute('position');
      const base = b.userData.base;
      for (let k = 0; k < f.count; k++) {
        const x = base[k * 3];
        f.setZ(k, Math.sin(this.time * 5 + x * 2.5) * 0.18 * x);
      }
      f.needsUpdate = true;
    }

    S.update(dt, {
      dragonPos: ctx.dragonPos,
      dragonVel: ctx.dragonVel,
      dragonActive: ctx.free && this.state === 'fight',
      orders: this.orders,
      front: this.front,
      rally: this.rally,
      camPos: ctx.camPos,
    });
  }
}
