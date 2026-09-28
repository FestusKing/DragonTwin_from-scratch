// HUD = Anzeige während des Fliegens: Tempo, Höhe, Ausdauer, Hitze,
// Ziegen, Rennzeit, Kompass, Ring-Pfeil, Meldungen.
// DOM-Änderungen sind teuer → Texte nur schreiben, wenn sie sich ändern.
import * as THREE from 'three';
import { formatTime } from '../core/utils.js';
import { keyLabel } from '../core/Input.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = $('hud');
    this.cache = new Map();
    this.speed = $('hud-speed');
    this.alt = $('hud-alt');
    this.vs = $('hud-vs');
    this.mode = $('hud-mode');
    this.stamina = $('bar-stamina');
    this.heat = $('bar-heat');
    this.goats = $('goat-count');
    this.goatChip = $('hud-goats');
    this.fps = $('hud-fps');
    this.race = $('hud-race');
    this.raceTime = $('race-time');
    this.raceRing = $('race-ring');
    this.raceBest = $('race-best');
    this.raceDelta = $('race-delta');
    this.ringInd = $('ring-indicator');
    this.ringDist = $('ring-dist');
    this.centerBig = $('center-big');
    this.centerSmall = $('center-small');
    this.warning = $('hud-warning');
    this.toasts = $('toasts');
    this.flash = $('flash');
    this.strip = $('compass-strip');
    // Abenteuer: Leben, Punkte, Aufträge, Wegweiser
    this.quests = $('hud-quests');
    this.scoreEl = $('hud-score');
    this.scorePts = $('score-pts');
    this.scoreCombo = $('score-combo');
    this.comboFill = $('combo-fill');
    this.pops = $('score-pops');
    this.healthWrap = $('health-wrap');
    this.healthBar = $('bar-health');
    this.healthVal = $('health-val');
    this.qInd = $('quest-indicator');
    this.qLabel = $('quest-label');
    this.adventure = null;
    this.popCount = 0;
    // Schlacht, Boss, Zielkreis
    this.battleEl = $('hud-battle');
    this.bossEl = $('hud-boss');
    this.bossFill = $('boss-fill');
    this.lockEl = $('lock-reticle');
    this.lockDist = $('lock-dist');
    this.battleShown = false;
    this.bossShown = false;
    this._buildCompass();
    this.flashValue = 0;
    this.centerTimer = 0;
    this.visible = false;
    this.photo = false;
  }

  _buildCompass() {
    // Eine Grad-Skala von -360 bis 720 (damit sie beim Drehen nie endet)
    const names = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    this.pxPerDeg = 3;
    let html = '';
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const x = d * this.pxPerDeg;
      if (names[n] !== undefined) html += `<span class="${n % 90 === 0 ? 'main' : ''}" style="left:${x}px">${names[n]}</span>`;
      else html += `<span class="tick" style="left:${x}px"></span>`;
    }
    this.strip.innerHTML = html;
  }

  show(v) {
    this.visible = v;
    this.el.classList.toggle('hidden', !v || this.photo);
  }

  togglePhoto() {
    this.photo = !this.photo;
    this.el.classList.toggle('hidden', !this.visible || this.photo);
    return this.photo;
  }

  _text(el, value) {
    if (this.cache.get(el) !== value) {
      this.cache.set(el, value);
      el.textContent = value;
    }
  }

  setKeyHints(input) {
    const k = (a) => keyLabel(input.bindings[a][0]);
    this._text($('stamina-key'), k('boost'));
    this._text($('fire-key'), k('fire'));
    this._text($('hint-pause'), k('pause'));
    this._text($('hint-cam'), k('camera'));
    this._text($('hint-help'), k('help'));
  }

  /** Jedes Bild: Fluganzeigen */
  update(dt, s) {
    this._text(this.speed, String(Math.round(s.speed * 3.6)));
    this._text(this.alt, `${Math.max(0, Math.round(s.altitude))} m`);
    const vs = s.vSpeed;
    this._text(this.vs, Math.abs(vs) < 1 ? '' : vs > 0 ? `▲ ${Math.round(vs)} m/s` : `▼ ${Math.round(-vs)} m/s`);
    this._text(this.mode, s.mode);
    this.stamina.style.transform = `scaleX(${s.stamina.toFixed(3)})`;
    this.heat.style.transform = `scaleX(${s.heat.toFixed(3)})`;
    this.stamina.parentElement.parentElement.classList.toggle('warn', s.exhausted);
    this.heat.parentElement.parentElement.classList.toggle('warn', s.overheated);
    this._text($('heat-label'), s.overheated ? 'Überhitzt!' : 'Feuer-Hitze');
    // Kompass: heading 0 = Norden (-z), positiv = nach links (Westen)
    const deg = ((-s.heading * 180) / Math.PI + 360) % 360;
    this.strip.style.transform = `translateX(${-deg * this.pxPerDeg}px)`;
    this.warning.classList.toggle('hidden', s.outOfBounds < 0.05);

    // Weisses Aufblitzen (Blitz) abklingen lassen
    if (this.flashValue > 0) {
      this.flashValue = Math.max(0, this.flashValue - dt * 3);
      this.flash.style.opacity = this.flashValue.toFixed(3);
    }
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) {
        this._text(this.centerBig, '');
        this._text(this.centerSmall, '');
      }
    }
  }

  setFps(fps, show) {
    this.fps.classList.toggle('hidden', !show);
    if (show) this._text(this.fps, `${fps} FPS`);
  }

  setGoats(found, total, pop = false) {
    this._text(this.goats, `${found}/${total}`);
    if (pop) {
      this.goatChip.classList.remove('pop');
      void this.goatChip.offsetWidth; // Animation neu starten
      this.goatChip.classList.add('pop');
    }
  }

  // ---------------- Rennen ----------------
  showRace(v) {
    this.race.classList.toggle('hidden', !v);
    if (!v) this.ringInd.classList.add('hidden');
  }

  updateRace(time, next, total, best) {
    this._text(this.raceTime, formatTime(time));
    this._text(this.raceRing, `${Math.min(next, total)} / ${total}`);
    this._text(this.raceBest, best != null ? formatTime(best) : '--:--.--');
  }

  showDelta(delta) {
    if (delta == null) {
      this._text(this.raceDelta, '');
      return;
    }
    this.raceDelta.className = 'race-delta ' + (delta <= 0 ? 'good' : 'bad');
    this._text(this.raceDelta, (delta <= 0 ? '−' : '+') + Math.abs(delta).toFixed(2) + ' s');
  }

  /** Pfeil/Markierung zum nächsten Ring (auf dem Bildschirm) */
  ringIndicator(ring, camera, playerPos) {
    if (!ring) {
      this.ringInd.classList.add('hidden');
      return;
    }
    this.ringInd.classList.remove('hidden');
    const w = window.innerWidth;
    const h = window.innerHeight;
    _v.copy(ring.pos).project(camera);
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * w;
    let y = (-_v.y * 0.5 + 0.5) * h;
    const margin = 60;
    const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
    let angle = 0;
    if (!onScreen) {
      // an den Bildschirmrand klemmen und Pfeil in Richtung drehen
      let dx = x - w / 2;
      let dy = y - h / 2;
      if (behind) {
        dx = -dx;
        dy = -dy;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
      }
      // unten Platz lassen für die Balken (Leben, Ausdauer, Hitze)
      const vh = dy > 0 ? h / 2 - 130 : h / 2 - margin;
      const s = Math.min((w / 2 - margin) / Math.abs(dx || 1e-6), vh / Math.abs(dy || 1e-6));
      x = w / 2 + dx * s;
      y = h / 2 + dy * s;
      angle = Math.atan2(dy, dx) + Math.PI / 2;
    }
    this.ringInd.classList.toggle('off', !onScreen);
    this.ringInd.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.ringInd.firstElementChild.style.transform = onScreen ? '' : `rotate(${angle.toFixed(3)}rad)`;
    this._text(this.ringDist, `${Math.round(playerPos.distanceTo(ring.pos))} m`);
  }

  // ---------------- Abenteuer ----------------
  /** Leben, Punkte und Aufträge nur im freien Flug zeigen */
  showAdventure(v) {
    if (this.adventure === v) return;
    this.adventure = v;
    for (const el of [this.quests, this.scoreEl, this.healthWrap]) el.classList.toggle('hidden', !v);
    if (!v) {
      this.qInd.classList.add('hidden');
      this.updateBattle(null);
      this.updateBoss(null);
      this.lockReticle(null);
    }
  }

  updateAdventure(s) {
    this.healthBar.style.transform = `scaleX(${s.health.toFixed(3)})`;
    this._text(this.healthVal, String(Math.ceil(s.health * 100)));
    this.healthWrap.classList.toggle('warn', s.lowHealth);
    this._text(this.scorePts, s.points.toLocaleString('de-CH'));
    this._text(this.scoreCombo, s.combo > 1 ? `×${s.combo}` : '');
    this.comboFill.style.transform = `scaleX(${s.comboLeft.toFixed(3)})`;
  }

  /** "+60 Dach in Brand" steigt kurz auf und verschwindet */
  scorePop(pts, label, combo) {
    const d = document.createElement('div');
    d.className = 'score-pop' + (pts < 0 ? ' bad' : pts >= 200 ? ' big' : '') + (label === 'Tiefflug' || label === 'Schluchtflug' || label === 'Baum' ? ' small' : '');
    d.textContent = `${pts < 0 ? '' : '+'}${pts} ${label}`;
    d.style.setProperty('--x', `${((this.popCount++ % 5) - 2) * 26}px`);
    this.pops.appendChild(d);
    setTimeout(() => d.remove(), 1600);
    while (this.pops.children.length > 6) this.pops.firstChild.remove();
    if (combo > 1) {
      this.scoreEl.classList.remove('pop');
      void this.scoreEl.offsetWidth;
      this.scoreEl.classList.add('pop');
    }
  }

  comboPop(c) {
    const d = document.createElement('div');
    d.className = 'score-pop combo';
    d.textContent = `KOMBO ×${c}!`;
    this.pops.appendChild(d);
    setTimeout(() => d.remove(), 1600);
  }

  // ---------------- Schlacht ----------------
  /** st = Battle.status() oder null (ausblenden), hornKey = Taste fürs Horn */
  updateBattle(st, hornKey) {
    const show = !!st;
    if (show !== this.battleShown) {
      this.battleShown = show;
      this.battleEl.classList.toggle('hidden', !show);
      this.el.classList.toggle('battle-on', show); // Meldungen rutschen unter die Schlacht-Anzeige
    }
    if (!show) return;
    const STATE = { waiting: 'bereit', won: 'Sieg!', lost: 'verloren' };
    this._text($('bt-state'), st.state === 'fight' ? `Welle ${st.wave}/${st.waves}` : STATE[st.state] || '');
    this._text($('bt-ally-n'), String(st.allies));
    this._text($('bt-enemy-n'), String(st.enemies));
    $('bt-ally').style.transform = `scaleX(${(st.allies / Math.max(1, st.alliesTotal)).toFixed(3)})`;
    $('bt-enemy').style.transform = `scaleX(${(st.enemies / Math.max(1, st.enemiesTotal)).toFixed(3)})`;
    this._text($('bt-siege'), String(st.siege));
    this._text($('bt-horn-key'), hornKey);
    $('bt-horn').classList.toggle('ready', st.horn >= 1 && st.state === 'fight');
    $('bt-horn-fill').style.transform = `scaleX(${st.horn.toFixed(3)})`;
  }

  /** Lebensbalken des feindlichen Drachenreiters (null = ausblenden) */
  updateBoss(b) {
    const show = !!b;
    if (show !== this.bossShown) {
      this.bossShown = show;
      this.bossEl.classList.toggle('hidden', !show);
    }
    if (!show) return;
    this._text($('boss-name'), b.name);
    this.bossFill.style.transform = `scaleX(${b.k.toFixed(3)})`;
    this.bossEl.classList.toggle('angry', b.angry);
    this.bossEl.classList.toggle('hurt', b.hurt);
  }

  /** Zielkreis auf dem Gegner. hard = angepeilt (T), sonst nur Zielhilfe */
  lockReticle(pos, camera, playerPos, hard) {
    if (!pos) {
      this.lockEl.classList.add('hidden');
      return;
    }
    _v.copy(pos).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
      this.lockEl.classList.add('hidden');
      return;
    }
    this.lockEl.classList.remove('hidden');
    this.lockEl.classList.toggle('soft', !hard);
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    this.lockEl.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this._text(this.lockDist, `${Math.round(playerPos.distanceTo(pos))} m`);
  }

  /** q = { rank, rankNo, xp, k, list: [{ text, progress }], done } */
  setQuests(q) {
    this._text($('q-rank-name'), q.rank);
    this._text($('q-rank-no'), String(q.rankNo));
    this._text($('q-xp'), q.xp);
    $('q-rank-fill').style.transform = `scaleX(${q.k.toFixed(3)})`;
    const ul = $('q-list');
    ul.innerHTML = '';
    if (!q.list.length) {
      const li = document.createElement('li');
      li.textContent = 'Alle Aufträge erfüllt – du bist eine Legende! 👑';
      ul.appendChild(li);
    }
    for (const m of q.list) {
      const li = document.createElement('li');
      li.textContent = m.text;
      if (m.progress) {
        const b = document.createElement('b');
        b.textContent = ` ${m.progress}`;
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
    // nur aufleuchten, wenn ein anderer Auftrag dazukommt (nicht bei jedem Fortschritt)
    const key = q.list.map((m) => m.text).join('|');
    if (key !== this._questKey) {
      this._questKey = key;
      this.quests.classList.remove('pop');
      void this.quests.offsetWidth;
      this.quests.classList.add('pop');
    }
  }

  /** Wegweiser zum Ort des aktuellen Auftrags (am Bildschirmrand, wenn ausserhalb) */
  questIndicator(pos, camera, playerPos, label) {
    if (!pos) {
      this.qInd.classList.add('hidden');
      return;
    }
    this.qInd.classList.remove('hidden');
    const w = window.innerWidth;
    const h = window.innerHeight;
    _v.copy(pos).project(camera);
    const behind = _v.z > 1;
    let x = (_v.x * 0.5 + 0.5) * w;
    let y = (-_v.y * 0.5 + 0.5) * h;
    const margin = 70;
    const onScreen = !behind && x > margin && x < w - margin && y > margin && y < h - margin;
    let angle = 0;
    if (!onScreen) {
      let dx = x - w / 2;
      let dy = y - h / 2;
      if (behind) {
        dx = -dx;
        dy = -dy;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
      }
      // unten Platz lassen für die Balken (Leben, Ausdauer, Hitze)
      const vh = dy > 0 ? h / 2 - 130 : h / 2 - margin;
      const s = Math.min((w / 2 - margin) / Math.abs(dx || 1e-6), vh / Math.abs(dy || 1e-6));
      x = w / 2 + dx * s;
      y = h / 2 + dy * s;
      angle = Math.atan2(dy, dx) + Math.PI / 2;
    }
    this.qInd.classList.toggle('off', !onScreen);
    this.qInd.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.qInd.firstElementChild.style.transform = onScreen ? '' : `rotate(${angle.toFixed(3)}rad)`;
    const d = playerPos.distanceTo(pos);
    this._text(this.qLabel, `${label} · ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}`);
  }

  // ---------------- Meldungen ----------------
  center(big, small = '', time = 1.2) {
    this._text(this.centerBig, big);
    this._text(this.centerSmall, small);
    this.centerBig.classList.remove('pop');
    void this.centerBig.offsetWidth;
    this.centerBig.classList.add('pop');
    this.centerTimer = time;
  }

  toast(title, sub = '', life = 3.2) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.style.setProperty('--life', `${life}s`);
    d.textContent = title;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      d.appendChild(s);
    }
    this.toasts.appendChild(d);
    setTimeout(() => d.remove(), (life + 0.6) * 1000);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  doFlash(v = 0.6) {
    this.flashValue = Math.max(this.flashValue, v);
  }

  // ---------------- Tutorial-Panel ----------------
  tutorialUI() {
    const panel = $('tutorial');
    const text = $('tut-text');
    const step = $('tut-step');
    const keys = $('tut-keys');
    const fill = $('tut-fill');
    return {
      show: (t, i, n, labels, progress, info) => {
        panel.classList.remove('hidden');
        step.textContent = `Schritt ${i + 1} / ${n}`;
        text.textContent = t;
        keys.innerHTML = '';
        labels.forEach((group, gi) => {
          if (gi > 0) keys.append(' und ');
          group.forEach((l) => {
            const k = document.createElement('span');
            k.className = 'k';
            k.textContent = l;
            keys.appendChild(k);
          });
        });
        if (info && labels.length) keys.append(' zum Weitermachen');
        fill.style.width = `${progress * 100}%`;
      },
      progress: (p) => (fill.style.width = `${(p * 100).toFixed(1)}%`),
      hide: () => panel.classList.add('hidden'),
      success: () => {
        panel.classList.remove('success');
        void panel.offsetWidth;
        panel.classList.add('success');
      },
    };
  }
}
