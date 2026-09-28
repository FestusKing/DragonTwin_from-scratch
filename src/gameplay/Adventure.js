// Abenteuer im freien Flug: Leben, Punkte & Kombos, Aufträge & Rang, Wegweiser.
// Game.js meldet Ereignisse (Feuer, Treffer, Schlacht, Schafe …), hier wird daraus Spiel:
//  - Leben: Treffer und harte Aufpralle kosten Leben. Schafe fressen, der Hort
//    im Vulkan und ein Sieg heilen. Bei 0 stürzt der Drache ab und erwacht im Hort.
//  - Punkte: jede Tat gibt Punkte, schnelle Folgen geben eine Kombo (×2 … ×5).
//    Eigene Soldaten verbrennen gibt Minuspunkte.
//  - Aufträge: 3 offene Ziele; geschafft → Erfahrung → höherer Drachen-Rang.
//  - Wegweiser: Pfeil zum Ort des ersten Auftrags (Hort, Schlacht, Schlucht …).
import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { Score } from './Score.js';
import { Missions } from './Missions.js';
import { PLACES, CANYON_LEN, polylineInfo } from '../world/Terrain.js';
import { canyonPoint } from '../world/Canyon.js';
import { ALLY, ENEMY } from './Soldiers.js';

const REGEN_DELAY = 6; // so lange nach einem Treffer keine Heilung (s)
const REGEN = 0.015; // Heilung pro Sekunde (ausserhalb des Horts)
const HOARD_HEAL = 0.4;
const DODGE_SAFE = 0.6; // so lange nach einer Ausweichrolle kein Schaden (s)
const FLUSH = 0.6; // viele Soldaten auf einmal → Punkte gesammelt anzeigen (s)

const IGNITE_POINTS = { hut: [60, 'Dach in Brand'], windmill: [150, 'Mühle in Flammen'], tower: [150, 'Turm brennt'], stall: [30, 'Marktstand brennt'], tree: [5, 'Baum'], ballista: [120, 'Armbrust brennt'] };

// Karren (Belagerungs-Armbrust) gibt schon über Ballistae.js Punkte → hier 0
const COLLAPSE_POINTS = { hut: [120, 'Haus eingestürzt!'], tower: [250, 'Turm umgestürzt!'], windmill: [200, 'Mühle zerstört!'], stall: [40, 'Stand zertrümmert'], tent: [40, 'Zelt zerstört'], cart: [0, ''] };

const _v = new THREE.Vector3();
const _info = { d: 0, s: 0 };
const _cp = { x: 0, z: 0, dx: 0, dz: 1 };

export class Adventure {
  constructor(game) {
    this.game = game;
    this.score = new Score();
    this.missions = new Missions();
    this.health = 1;
    this.hitTimer = 99;
    this.lowAcc = 0;
    this.canyonAcc = 0;
    this.run = { active: false, maxS: 0, grace: 0 };
    this.prev = new THREE.Vector3();
    this.hasPrev = false;
    this.archCool = 0;
    this.hoardVisited = false;
    this.inHoardHint = 0;
    this.saveTimer = 5;
    this.respawnTimer = 0;
    this.targetCache = null;
    this.invuln = 0;
    // gesammelte Kampf-Punkte (sonst gäbe es 30 Anzeigen auf einmal)
    this.buf = { enemy: 0, ally: 0, sweep: 0, t: 0 };

    const hud = game.hud;
    this.score.onAdd = (pts, label, combo) => {
      hud.scorePop(pts, label, combo);
      if (pts > 0) this.missions.addXp(pts);
      if (this.score.points >= 5000) this.missions.report('score');
    };
    this.score.onCombo = (c) => {
      hud.comboPop(c);
      game.audio.playPoints(c + 2);
      if (c >= 5) this.missions.report('combo5');
    };
    this.score.onBest = () => hud.toast('🏆 Neue Bestleistung!', 'Weiter so – jede Tat zählt.', 3);
    this.missions.onComplete = (m) => {
      hud.toast(`✔ Auftrag erfüllt: +${m.xp} XP`, m.text, 4.5);
      game.audio.playSuccess();
    };
    this.missions.onRank = (i, r) => {
      hud.center('RANG ' + (i + 1), r.name, 3);
      hud.toast(`👑 Neuer Rang: ${r.name}`, 'Neue Drachenfarbe freigeschaltet (Drache anpassen).', 6);
      game.audio.playFinish(true);
    };
    this.missions.onChange = () => this.refreshPanel();
    this.refreshPanel();
  }

  // ------------------------------------------------------------ Ereignisse von Game.js
  /** Neuer freier Flug */
  startRun() {
    this.score.resetRun();
    this.health = 1;
    this.hitTimer = 99;
    this.run.active = false;
    this.hasPrev = false;
    this.respawnTimer = 0;
    this.invuln = 0;
    this.buf.enemy = this.buf.ally = this.buf.sweep = 0;
    this.refreshPanel();
  }

  get active() {
    const g = this.game;
    return g.state === 'play' && g.mode === 'free' && !g.tutorial?.active;
  }

  /** Schaden nehmen. Rückgabe: true, wenn der Treffer zählt (nicht während einer Ausweichrolle). */
  damage(amount) {
    if (!this.active || this.respawnTimer > 0 || this.invuln > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.hitTimer = 0;
    if (this.health <= 0) this._crash();
    return true;
  }

  heal(amount) {
    this.health = Math.min(1, this.health + amount);
  }

  onIgnite(e) {
    if (!this.active || !e) return;
    const [pts, label] = IGNITE_POINTS[e.kind] || [20, 'Feuer'];
    this.score.add(pts, label, { chain: e.kind !== 'tree' });
    this.missions.report('burn40');
    if (e.kind === 'hut') this.missions.report('huts5');
  }

  /** Ein Gebäude stürzt ein (Destruction.js) */
  onCollapse(st, cause, src) {
    if (!this.active || src === 'enemy') return;
    const [pts, label] = COLLAPSE_POINTS[st.kind] || [80, 'Eingestürzt!'];
    if (pts > 0) this.score.add(pts, label);
    this.missions.report('collapse5');
  }

  onTowerDestroyed(n, total) {
    if (!this.active) return;
    this.score.add(300, 'Armbrust zerstört!');
    if (n >= total) this.missions.report('towers');
  }

  onSheep(pos) {
    const g = this.game;
    g.audio.playChomp();
    for (let i = 0; i < 18 * g.world.q.particles; i++) {
      g.world.particles.spray.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 6, (Math.random() - 0.5) * 8, 0.8 + Math.random() * 0.6, 1.2, 3);
    }
    if (!this.active) return;
    this.heal(0.25);
    g.physics.stamina = Math.min(1, g.physics.stamina + 0.35);
    this.score.add(60, 'Schaf gefangen! +Leben');
  }

  onNearMiss() {
    if (this.active) this.score.add(40, 'Knapp vorbei!');
  }

  onGoat() {
    if (this.active) this.score.add(200, 'Ziege gefunden');
  }

  onSonic() {
    if (!this.active) return;
    this.score.add(200, 'Schallmauer!');
    this.missions.report('sonic');
  }

  // ------------------------------------------------------------ Schlacht und Drachenreiter
  /** Ein Soldat ist gefallen. Nur was du selbst getan hast, zählt (Feuer oder Wucht). */
  onSoldierDeath(s, cause) {
    if (!this.active) return;
    if (cause !== 'feuer' && cause !== 'wucht') return;
    if (s.team === ENEMY) {
      this.buf.enemy++;
      this.missions.report('soldiers40');
    } else if (s.team === ALLY) this.buf.ally++;
  }

  onCommander(cause) {
    if (!this.active || (cause !== 'feuer' && cause !== 'wucht')) return;
    this.score.add(300, 'Anführer besiegt!');
  }

  /** Soldaten umgeworfen (Landung, Tiefflug, Flügelschlag) */
  onSweep(n) {
    if (!this.active || n <= 0) return;
    this.buf.sweep += n;
    this.missions.report('sweep', n);
  }

  onSiegeDestroyed() {
    if (this.active) this.missions.report('siege');
  }

  onHorn() {
    if (this.active) this.missions.report('horn');
  }

  onBiteHit(dragon, n = 0) {
    if (!this.active) return;
    if (dragon) this.score.add(150, 'Biss! Drachenreiter getroffen');
    else this.score.add(15 * n, n > 1 ? `Biss (${n})` : 'Biss');
    this.missions.report('bite');
  }

  onDodge() {
    this.invuln = DODGE_SAFE;
    if (this.active) this.missions.report('dodge');
  }

  onBattleWon(info) {
    if (!this.active) return;
    this.score.add(1500, info?.commander ? 'Schlacht gewonnen – Anführer gefallen!' : 'Schlacht gewonnen!');
    this.heal(1);
    this.missions.report('battle');
  }

  onEnemyDragonDefeated() {
    if (!this.active) return;
    this.score.add(2000, 'Drachenreiter besiegt!');
    this.heal(0.5);
    this.missions.report('enemyDragon');
  }

  /** Gesammelte Kampf-Punkte als eine Anzeige ausgeben */
  _flush(dt) {
    const b = this.buf;
    b.t -= dt;
    if (b.t > 0) return;
    b.t = FLUSH;
    if (b.enemy > 0) {
      this.score.add(4 * b.enemy, b.enemy > 1 ? `${b.enemy} Feinde besiegt` : 'Feind besiegt');
      b.enemy = 0;
    }
    if (b.sweep > 0) {
      this.score.add(5 * b.sweep, b.sweep > 1 ? `${b.sweep} Soldaten umgeworfen` : 'Umgeworfen', { chain: b.sweep >= 3 });
      b.sweep = 0;
    }
    if (b.ally > 0) {
      this.score.penalty(10 * b.ally, b.ally > 1 ? `${b.ally} eigene Soldaten verbrannt!` : 'Eigener Soldat verbrannt!');
      if (!this.allyHint) {
        this.allyHint = true;
        this.game.hud.toast('⚠ Das waren deine Leute!', 'Die Dorfwache trägt Blau. Brenne nur die roten Reihen der Eisenkrone.', 5);
      }
      b.ally = 0;
    }
  }

  onRaceFinish(res) {
    if (res?.medal === 'gold') this.missions.report('race');
    this.missions.save();
  }

  // ------------------------------------------------------------ Absturz und Hort
  _crash() {
    const g = this.game;
    this.respawnTimer = 2.2;
    this.score.breakCombo();
    g.hud.center('ABGESTÜRZT', 'Du erwachst in deinem Hort im Vulkan …', 2.2);
    g.hud.doFlash(0.5);
    g.rig.addShake(1.2);
    g.audio.playImpact(1.2);
  }

  _respawn() {
    const g = this.game;
    const h = g.world.volcano.hoard;
    const p = g.physics;
    p.reset(_v.set(h.x, h.y + 30, h.z + 12), Math.PI, 0); // Blick nach Norden auf den Lava-See
    p.hovering = true;
    p.stamina = 1;
    this.health = 1;
    this.hitTimer = 99;
    g.rig.snap();
    g.hud.toast('🔥 Im Hort erwacht', 'Leben und Ausdauer sind wieder voll.', 3.5);
  }

  /** Ort für den Wegweiser (erster offener Auftrag mit Ort) */
  _target() {
    const g = this.game;
    const W = g.world;
    const pos = g.physics.position;
    for (const m of this.missions.active) {
      switch (m.target) {
        case 'hoard':
          return { pos: _v.copy(W.volcano.hoard).setY(W.volcano.hoard.y + 20), label: 'Hort' };
        case 'canyon':
          canyonPoint(80, _cp);
          return { pos: _v.set(_cp.x, 45, _cp.z), label: 'Schlucht' };
        case 'bridge':
          if (!W.canyon.bridge) break;
          return { pos: _v.copy(W.canyon.bridge.mid).setY(W.canyon.bridge.mid.y - 45), label: 'Brücke' };
        case 'arch':
          return { pos: _v.copy(W.landmarks.archCenter), label: 'Felsbogen' };
        case 'pasture': {
          const p = W.herds.nearestPasture(pos);
          if (p) return { pos: _v.set(p.x, W.terrain.heightAt(p.x, p.z) + 12, p.z), label: 'Schafe' };
          break;
        }
        case 'battle': {
          const B = PLACES.battle;
          return { pos: _v.set(B.x, B.h + 45, B.z), label: 'Schlacht' };
        }
        case 'siege': {
          let best = null;
          let bd = Infinity;
          for (const t of g.battle.siege) {
            if (t.destroyed) continue;
            const d = t.top.distanceTo(pos);
            if (d < bd) {
              bd = d;
              best = t;
            }
          }
          if (best) return { pos: _v.copy(best.top).setY(best.top.y + 8), label: 'Belagerung' };
          break;
        }
        case 'enemyDragon':
          if (g.enemy.active) return { pos: _v.copy(g.enemy.position), label: 'Drachenreiter' };
          return { pos: _v.set(PLACES.battle.x, PLACES.battle.h + 45, PLACES.battle.z), label: 'Schlacht' };
        case 'village':
          return { pos: _v.set(PLACES.village.x, PLACES.village.h + 40, PLACES.village.z), label: 'Dorf' };
        case 'towers': {
          let best = null;
          let bd = Infinity;
          for (const t of g.ballistae.towers) {
            if (t.destroyed) continue;
            const d = t.top.distanceTo(pos);
            if (d < bd) {
              bd = d;
              best = t;
            }
          }
          if (best) return { pos: _v.copy(best.top).setY(best.top.y + 6), label: 'Turm' };
          break;
        }
        default:
      }
    }
    return null;
  }

  // ------------------------------------------------------------ jedes Bild
  update(dt) {
    const g = this.game;
    const hud = g.hud;
    this.score.update(dt);
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 5;
      this.missions.save();
    }
    const free = this.active;
    hud.showAdventure(free);
    if (!free) {
      hud.questIndicator(null);
      return;
    }
    const p = g.physics;
    const W = g.world;
    const pos = p.position;
    this.invuln = Math.max(0, this.invuln - dt);
    this._flush(dt);

    // Absturz → kurz warten → im Hort aufwachen
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this._respawn();
    }

    // Heilen
    this.hitTimer += dt;
    if (this.hitTimer > REGEN_DELAY) this.heal(REGEN * dt);
    const inHoard = W.volcano.inHoard(pos);
    if (inHoard && (p.grounded || p.hovering || p.speed < 12)) {
      this.heal(HOARD_HEAL * dt);
      p.stamina = Math.min(1, p.stamina + 0.5 * dt);
      if (!this.hoardVisited) {
        this.hoardVisited = true;
        this.missions.report('hoard');
        this.score.add(100, 'Heimkehr in den Hort');
        hud.toast('🔥 Dein Hort', 'Hier erholst du dich. Stürzt du ab, erwachst du hier.', 5);
      }
    } else if (!inHoard) this.hoardVisited = this.hoardVisited && pos.distanceTo(W.volcano.hoard) < 400;

    // Tiefflug: nah über Boden oder Wasser, mit Tempo
    if (!p.grounded && (p.agl ?? 99) < 10 && p.speed > 38) {
      this.lowAcc += dt;
      if (this.lowAcc >= 1) {
        this.lowAcc -= 1;
        this.score.add(20, 'Tiefflug', { chain: false });
        this.missions.report('lowfly');
      }
    } else this.lowAcc = Math.max(0, this.lowAcc - dt * 0.5);

    // Schlucht: in der Schlucht fliegen gibt Punkte; einmal ganz hindurch = Auftrag
    polylineInfo(pos.x, pos.z, PLACES.canyon, _info);
    const inCanyon = _info.d < 75 && pos.y < 118 && _info.s < CANYON_LEN && !p.grounded;
    const run = this.run;
    if (inCanyon) {
      run.grace = 1.5;
      if (!run.active && _info.s < 400) {
        run.active = true;
        run.maxS = _info.s;
      }
      if (run.active) {
        run.maxS = Math.max(run.maxS, _info.s);
        if (run.maxS > CANYON_LEN - 160) {
          run.active = false;
          this.score.add(800, 'Schlucht durchflogen!');
          this.missions.report('canyon');
        }
      }
      if (p.speed > 35) {
        this.canyonAcc += dt;
        if (this.canyonAcc >= 1) {
          this.canyonAcc -= 1;
          this.score.add(10, 'Schluchtflug', { chain: false });
        }
      }
    } else {
      run.grace -= dt;
      if (run.grace <= 0) run.active = false;
    }

    // Unter der Brücke durch / durch den Felsbogen
    const B = W.canyon.bridge;
    if (B && this.hasPrev) {
      const side = (q) => (B.B.x - B.A.x) * (q.z - B.A.z) - (B.B.z - B.A.z) * (q.x - B.A.x);
      const s0 = side(this.prev);
      const s1 = side(pos);
      if (s0 * s1 < 0 && pos.distanceTo(B.mid) < 140 && pos.y < B.mid.y - 3) {
        this.score.add(300, 'Unter der Brücke!');
        this.missions.report('bridge');
      }
    }
    this.archCool -= dt;
    if (this.archCool <= 0 && pos.distanceTo(W.landmarks.archCenter) < 14) {
      this.archCool = 6;
      this.score.add(250, 'Durch den Felsbogen!');
      this.missions.report('arch');
    }
    this.prev.copy(pos);
    this.hasPrev = true;

    // Ziegen-Auftrag folgt dem echten Zähler
    this.missions.set('goats6', W.goats.foundCount);

    // Anzeige
    hud.updateAdventure({
      health: this.health,
      points: this.score.points,
      combo: this.score.combo,
      comboLeft: this.score.comboLeft,
      lowHealth: this.health < 0.3,
    });
    const tgt = this._target();
    if (tgt && tgt.pos.distanceTo(pos) > 160) hud.questIndicator(tgt.pos, g.camera, pos, tgt.label);
    else hud.questIndicator(null);
  }

  /** Auftrags-Liste und Rang neu zeichnen */
  refreshPanel() {
    const m = this.missions;
    const rp = m.rankProgress();
    this.game.hud.setQuests({
      rank: `${rp.cur.name}`,
      rankNo: m.rankIndex + 1,
      xp: rp.next ? `${Math.floor(m.xp)} / ${rp.next.xp} XP` : `${Math.floor(m.xp)} XP`,
      k: clamp(rp.k, 0, 1),
      list: m.active.map((q) => ({
        text: q.text,
        progress: q.type === 'count' ? `${m.progress[q.id] || 0}/${q.goal}` : '',
      })),
      done: m.doneCount,
    });
  }
}
