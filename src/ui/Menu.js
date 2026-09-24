// Menüs: Hauptmenü, Rennauswahl, Anpassen, Einstellungen, Hilfe, Pause,
// Ergebnisse. Bedienbar mit Maus, Tastatur (Pfeile + Enter + Esc) und Gamepad.
import { settings } from '../core/Settings.js';
import { ACTIONS, keyLabel } from '../core/Input.js';
import { formatTime } from '../core/utils.js';
import { SKINS, FIRE_COLORS } from '../dragon/Customization.js';
import { COURSES } from '../gameplay/Courses.js';
import { loadRecord, clearRecords } from '../gameplay/GhostReplay.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const PAD_LABELS = {
  pitchUp: 'Linker Stick ↓',
  pitchDown: 'Linker Stick ↑',
  rollLeft: 'Linker Stick ←',
  rollRight: 'Linker Stick →',
  flap: 'A',
  dive: 'B',
  boost: 'RT',
  fire: 'X',
  hover: 'LT',
  camera: 'Y',
  roar: 'RB',
  restart: 'LB',
  pause: 'Start',
  help: 'Back',
};

export class Menu {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.current = null;
    this.settingsTab = 'graphics';
    this.listening = null;

    document.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', () => {
        this.game.audio.playClick();
        this.handle(b.dataset.action);
      });
    });
    // Hover-Sound für alle Knöpfe
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest?.('.btn, .course, .swatch, .tab');
      if (t && t !== this._lastHover) {
        this._lastHover = t;
        this.game.audio.playHover();
      }
    });
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        this.game.audio.playClick();
        this.settingsTab = t.dataset.tab;
        this._buildSettings();
      });
    });
    $('chk-rider').addEventListener('change', (e) => this.game.custom.set('rider', e.target.checked));
    $('chk-ghost').checked = settings.get('ghost') !== false;
    $('chk-ghost').addEventListener('change', (e) => settings.set('ghost', e.target.checked));

    // Tastatur-Navigation in Menüs
    window.addEventListener('keydown', (e) => {
      if (!this.current || this.game.input.captureCallback) return;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        const tag = document.activeElement?.tagName;
        if (tag === 'SELECT' || (tag === 'INPUT' && document.activeElement.type === 'range')) return;
        e.preventDefault();
        this.navigate(e.code === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  // ------------------------------------------------------------ Bildschirme
  show(id, { push = true } = {}) {
    if (push && this.current && this.current !== id) this.stack.push(this.current);
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
    this.current = id;
    if (id === 'menu') this._fillMenuStats();
    if (id === 'race') this._buildCourses();
    if (id === 'customize') this._buildCustomize();
    if (id === 'settings') this._buildSettings();
    if (id === 'help') this._buildHelp();
    // ersten Knopf fokussieren (für Tastatur/Gamepad)
    requestAnimationFrame(() => {
      const first = document.querySelector(`#screen-${id} .btn.primary, #screen-${id} .course, #screen-${id} .btn`);
      first?.focus({ preventScroll: true });
    });
  }

  hideAll() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    this.current = null;
    this.stack = [];
  }

  back() {
    if (this.current === 'customize') {
      this.game.exitCustomize();
      return;
    }
    const prev = this.stack.pop();
    if (prev) this.show(prev, { push: false });
    else if (this.game.state === 'paused') this.show('pause', { push: false });
    else this.show('menu', { push: false });
  }

  handle(action) {
    const g = this.game;
    switch (action) {
      case 'play':
        g.startFreeFlight();
        break;
      case 'tutorial':
        g.startFreeFlight({ tutorial: true });
        break;
      case 'race':
        this.show('race');
        break;
      case 'customize':
        g.enterCustomize();
        break;
      case 'settings':
        this.show('settings');
        break;
      case 'help':
        this.show('help');
        break;
      case 'back':
        this.back();
        break;
      case 'resume':
        g.resume();
        break;
      case 'restart':
        g.restart();
        break;
      case 'retry':
        g.retryRace();
        break;
      case 'menu':
        g.toMenu();
        break;
    }
  }

  /** Fokus zum nächsten/vorherigen Element im aktiven Bildschirm */
  navigate(dir) {
    const scr = $('screen-' + this.current);
    if (!scr) return;
    const items = [...scr.querySelectorAll('button, input, select')].filter((el) => el.offsetParent !== null && !el.disabled);
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    i = i < 0 ? 0 : (i + dir + items.length) % items.length;
    items[i].focus({ preventScroll: false });
    this.game.audio.playHover();
  }

  activate() {
    const el = document.activeElement;
    if (el && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) el.click();
  }

  // ------------------------------------------------------------ Hauptmenü
  _fillMenuStats() {
    const goats = this.game.world.goats;
    const parts = [`🐐 Ziegen gefunden: <b>${goats.foundCount} / ${goats.total}</b>`];
    for (const c of COURSES) {
      const r = loadRecord(c.id);
      if (r?.time) parts.push(`${c.name}: <b>${formatTime(r.time)}</b>`);
    }
    $('menu-stats').innerHTML = parts.join('<br>');
  }

  // ------------------------------------------------------------ Rennauswahl
  _buildCourses() {
    const list = $('course-list');
    list.innerHTML = '';
    for (const c of COURSES) {
      const r = loadRecord(c.id);
      const b = document.createElement('button');
      b.className = 'course';
      b.innerHTML = `
        <div class="c-diff">${c.difficulty}</div>
        <div class="c-name">${c.name}</div>
        <div class="c-desc">${c.desc}</div>
        <div class="c-best">Bestzeit: ${r?.time ? formatTime(r.time) : '—'}${r?.ghost ? ' · 👻 Geist' : ''}</div>`;
      b.addEventListener('click', () => {
        this.game.audio.playClick();
        this.game.startRace(c.id, $('chk-ghost').checked);
      });
      list.appendChild(b);
    }
  }

  // ------------------------------------------------------------ Anpassen
  _buildCustomize() {
    const custom = this.game.custom;
    const allGoats = this.game.world.goats.foundCount >= this.game.world.goats.total;
    const skinBox = $('skin-swatches');
    skinBox.innerHTML = '';
    for (const [id, s] of Object.entries(SKINS)) {
      const locked = s.locked && !allGoats;
      const b = document.createElement('button');
      b.className = 'swatch' + (custom.state.skin === id ? ' selected' : '') + (locked ? ' locked' : '');
      // Punkt: Bauch (Glanz) → Körper → Flughaut am Rand
      b.innerHTML = `<span class="dot" style="background: radial-gradient(circle at 35% 30%, ${hex(s.belly)}, ${hex(s.body)} 55%, ${hex(s.membrane)})"></span>${locked ? '🔒' : s.label}`;
      b.title = locked ? 'Finde alle Ziegen, um den goldenen Drachen freizuschalten!' : s.label;
      b.addEventListener('click', () => {
        if (locked) {
          this.game.audio.playError();
          return;
        }
        this.game.audio.playClick();
        custom.set('skin', id);
        this._buildCustomize();
      });
      skinBox.appendChild(b);
    }
    $('gold-hint').textContent = allGoats ? '✦ Goldener Drache freigeschaltet!' : `Tipp: Finde alle ${this.game.world.goats.total} Ziegen, um eine geheime Farbe freizuschalten.`;
    const fireBox = $('fire-swatches');
    fireBox.innerHTML = '';
    for (const [id, f] of Object.entries(FIRE_COLORS)) {
      const b = document.createElement('button');
      b.className = 'swatch' + (custom.state.fire === id ? ' selected' : '');
      b.innerHTML = `<span class="dot" style="background: radial-gradient(circle, ${hex(f.c[0])} 10%, ${hex(f.c[1])} 45%, ${hex(f.c[2])})"></span>${f.label}`;
      b.addEventListener('click', () => {
        this.game.audio.playClick();
        custom.set('fire', id);
        this._buildCustomize();
        this.game.previewFire();
      });
      fireBox.appendChild(b);
    }
    $('chk-rider').checked = custom.state.rider;
  }

  // ------------------------------------------------------------ Einstellungen
  _buildSettings() {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === this.settingsTab));
    const body = $('settings-body');
    body.innerHTML = '';
    const row = (label, desc, control) => {
      const d = document.createElement('div');
      d.className = 'setting';
      const l = document.createElement('label');
      l.innerHTML = label + (desc ? `<span class="desc">${desc}</span>` : '');
      d.append(l, control);
      body.appendChild(d);
      return d;
    };
    const select = (key, options, onChange) => {
      const s = document.createElement('select');
      for (const [v, t] of options) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        s.appendChild(o);
      }
      s.value = String(settings.get(key));
      s.addEventListener('change', () => {
        settings.set(key, s.value);
        onChange?.(s.value);
      });
      return s;
    };
    const check = (key, onChange) => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!settings.get(key);
      c.addEventListener('change', () => {
        settings.set(key, c.checked);
        onChange?.(c.checked);
      });
      return c;
    };
    const range = (key, min, max, step, fmt, onInput, getValue) => {
      const w = document.createElement('div');
      w.className = 'range-wrap';
      const r = document.createElement('input');
      r.type = 'range';
      r.min = min;
      r.max = max;
      r.step = step;
      r.value = getValue ? getValue() : settings.get(key);
      const o = document.createElement('output');
      o.textContent = fmt(Number(r.value));
      r.addEventListener('input', () => {
        const v = Number(r.value);
        o.textContent = fmt(v);
        if (key) settings.set(key, v);
        onInput?.(v);
      });
      w.append(r, o);
      return w;
    };
    const button = (text, fn) => {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = text;
      b.addEventListener('click', fn);
      return b;
    };
    const pct = (v) => `${Math.round(v * 100)} %`;
    const g = this.game;

    if (this.settingsTab === 'graphics') {
      row('Grafikqualität', 'Automatisch passt die Auflösung an, damit es flüssig bleibt. Baumdichte ändert sich erst nach dem Neuladen.',
        select('quality', [['auto', 'Automatisch'], ['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']], () => g.applyQuality()));
      row('FPS anzeigen', 'Bilder pro Sekunde oben rechts', check('showFps'));
    } else if (this.settingsTab === 'world') {
      const hhmm = (v) => {
        const h = Math.floor(v) % 24;
        const m = Math.round((v - Math.floor(v)) * 60) % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };
      row('Tageszeit', 'Schieben = Zeit sofort ändern', range(null, 0, 24, 0.05, hhmm, (v) => (g.world.time = v), () => g.world.time));
      row('Zeit läuft', 'Tag-Nacht-Zyklus aktiv', check('timeRunning'));
      row('Tageslänge', 'Echte Minuten für 24 Stunden', range('dayLengthMin', 2, 60, 1, (v) => `${v} min`));
      row('Wetter', 'Automatisch = wechselt ab und zu', select('weather', [['auto', 'Automatisch'], ['clear', 'Klar'], ['cloudy', 'Bewölkt'], ['rain', 'Regen'], ['fog', 'Nebel'], ['storm', 'Gewitter']], (v) => g.world.weather.set(v)));
    } else if (this.settingsTab === 'audio') {
      row('Gesamtlautstärke', '', range('masterVolume', 0, 1, 0.01, pct));
      row('Musik', '', range('musicVolume', 0, 1, 0.01, pct));
      row('Effekte', 'Wind, Feuer, Flügel …', range('sfxVolume', 0, 1, 0.01, pct));
      row('Stumm', 'Taste ' + keyLabel(g.input.bindings.mute[0]), check('muted'));
    } else if (this.settingsTab === 'controls') {
      row('Höhenruder umkehren', 'W = Nase hoch, S = Nase runter', check('invertPitch'));
      row('Maus-Kamera', 'Mit gedrückter Maustaste umsehen, Mausrad = Zoom', check('mouseCamera'));
      const kb = document.createElement('div');
      kb.style.gridColumn = '1 / -1';
      for (const a of ACTIONS) {
        const r = document.createElement('div');
        r.className = 'keybind';
        const l = document.createElement('span');
        l.textContent = a.label;
        r.appendChild(l);
        for (let slot = 0; slot < 2; slot++) {
          const b = document.createElement('button');
          b.textContent = keyLabel(g.input.bindings[a.id][slot]);
          b.title = 'Klicken und neue Taste drücken (Esc = leeren)';
          b.addEventListener('click', () => {
            if (this.listening) return;
            this.listening = b;
            b.classList.add('listening');
            b.textContent = 'Taste …';
            g.input.captureNext((code) => {
              g.input.rebind(a.id, slot, code);
              this.listening = null;
              g.hud.setKeyHints(g.input);
              this._buildSettings();
            });
          });
          r.appendChild(b);
        }
        kb.appendChild(r);
      }
      body.appendChild(kb);
      const reset = button('Standard-Tasten wiederherstellen', () => {
        g.input.resetBindings();
        g.hud.setKeyHints(g.input);
        this._buildSettings();
      });
      row('Zurücksetzen', '', reset);
    } else if (this.settingsTab === 'game') {
      row('Flughilfe', 'Richtet den Drachen automatisch gerade aus und hilft bei langsamen Kurven', check('flightAssist'));
      row('Kamera-Wackeln', 'Bei Aufprall, Boost und Donner', check('cameraShake'));
      row('Minikarte', '', check('showMinimap', (v) => document.getElementById('hud-map').classList.toggle('hidden', !v)));
      row('Ziegen-Fortschritt', 'Alle gefundenen Ziegen wieder verstecken', button('Zurücksetzen', () => {
        if (confirm('Wirklich alle Ziegen wieder verstecken?')) {
          g.world.goats.resetProgress();
          g.hud.setGoats(0, g.world.goats.total);
        }
      }));
      row('Bestzeiten', 'Alle Rennzeiten und Geister löschen', button('Löschen', () => {
        if (confirm('Wirklich alle Bestzeiten löschen?')) clearRecords(COURSES.map((c) => c.id));
      }));
    }
  }

  // ------------------------------------------------------------ Hilfe
  _buildHelp() {
    const b = this.game.input.bindings;
    const body = $('help-body');
    let html = '<div class="help-sec">Fliegen</div>';
    const row = (label, a) => {
      const keys = b[a].filter(Boolean).map((c) => `<span class="k">${keyLabel(c)}</span>`).join(' ');
      const pad = PAD_LABELS[a] ? ` <small style="color:var(--ink-dim)">🎮 ${PAD_LABELS[a]}</small>` : '';
      html += `<div class="help-row"><span>${label}</span><span class="keys">${keys}${pad}</span></div>`;
    };
    for (const a of ACTIONS) {
      if (a.id === 'camera') html += '<div class="help-sec">Sonstiges</div>';
      row(a.label, a.id);
    }
    html += `<div class="help-sec">Tipps</div>
      <div class="help-row" style="grid-column:1/-1"><span>Tempo = Auftrieb. Zu langsam? Nase runter oder Flügel schlagen. Im Sturzflug wirst du richtig schnell.</span></div>
      <div class="help-row" style="grid-column:1/-1"><span>Gelandet? Mit ${keyLabel(b.pitchDown[0])} läuft der Drache, mit ${keyLabel(b.flap[0])} hebst du wieder ab.</span></div>
      <div class="help-row" style="grid-column:1/-1"><span>Hütten, Bäume und Heuballen fangen Feuer. Regen löscht Brände.</span></div>
      <div class="help-row" style="grid-column:1/-1"><span>Maus gedrückt halten = umsehen, Mausrad = Zoom. ${keyLabel(b.roar[0])} = Brüllen (Ziegen antworten …)</span></div>`;
    body.innerHTML = html;
  }

  // ------------------------------------------------------------ Ergebnisse
  showResults(r) {
    $('res-title').textContent = r.isRecord ? (r.best == null ? 'Erste Zeit!' : 'Neue Bestzeit!') : 'Ziel!';
    const medal = $('res-medal');
    medal.className = 'medal ' + (r.medal || '');
    medal.textContent = r.medal ? '✦' : '';
    $('res-time').textContent = formatTime(r.time);
    $('res-best').textContent =
      r.best == null ? 'Deine erste Zeit auf dieser Strecke.' : r.isRecord ? `Alte Bestzeit: ${formatTime(r.best)} (−${(r.best - r.time).toFixed(2)} s)` : `Bestzeit: ${formatTime(r.best)} (+${(r.time - r.best).toFixed(2)} s)`;
    const m = r.medals;
    $('res-medals').innerHTML = `<span class="m">🥇 <b>${formatTime(m.gold)}</b></span><span class="m">🥈 <b>${formatTime(m.silver)}</b></span><span class="m">🥉 <b>${formatTime(m.bronze)}</b></span>`;
    this.show('results', { push: false });
  }
}
