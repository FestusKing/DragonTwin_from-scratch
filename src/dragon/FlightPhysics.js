// =====================================================================
//  FLUGPHYSIK DES DRACHEN
// =====================================================================
// Ein fliegender Körper spürt VIER Kräfte:
//
//   1) SCHWERKRAFT (Gravity)  – zieht immer nach unten (9.81 m/s²).
//   2) AUFTRIEB (Lift)        – entsteht an den Flügeln, steht SENKRECHT
//                               zur Flugrichtung. Je schneller, desto mehr.
//   3) LUFTWIDERSTAND (Drag)  – bremst, zeigt GEGEN die Flugrichtung.
//   4) SCHUB (Thrust)         – hier: Flügelschläge und Boost.
//
// Die wichtigste Formel (für Auftrieb UND Widerstand):
//
//     Kraft = ½ · Luftdichte · Geschwindigkeit² · Flügelfläche · Beiwert
//
// Wichtig ist das "Geschwindigkeit²": doppelt so schnell = VIERMAL so viel
// Auftrieb. Deshalb braucht der Drache Tempo, um zu gleiten.
//
// Den festen Teil (½ · Luftdichte · Fläche / Masse) fassen wir zu EINER Zahl
// zusammen: K_AIR. Dann gilt für die Beschleunigung (Kraft / Masse):
//
//     a_lift = K_AIR · v² · CL        (CL = Auftriebsbeiwert)
//     a_drag = K_AIR · v² · CD        (CD = Widerstandsbeiwert)
//
// CL hängt vom ANSTELLWINKEL (angle of attack, α) ab: Das ist der Winkel
// zwischen der Nase und der Richtung, aus der die Luft kommt. Mehr Winkel =
// mehr Auftrieb … bis ca. 20°. Danach reisst die Strömung ab ("Strömungs-
// abriss" / Stall) und der Auftrieb bricht ein.
//
// Wir rechnen alles in kleinen, festen Zeitschritten (1/120 s). Pro Schritt:
//   Beschleunigung ausrechnen → Geschwindigkeit ändern → Position ändern.
// Das nennt man "Euler-Integration".
// =====================================================================
import * as THREE from 'three';
import { clamp, angleDiff, damp } from '../core/utils.js';
import { WATER_LEVEL } from '../world/Terrain.js';
import { STAND_HEIGHT } from './Dragon.js';

// ---------------- Einstellbare Konstanten ----------------
const G = 9.81; // Erdbeschleunigung (m/s²)
const K_AIR = 0.018; // ½ · Luftdichte · Flügelfläche / Masse
const CL0 = 0.3; // Auftrieb bei 0° Anstellwinkel (gewölbter Flügel)
const CL_ALPHA = 4.2; // Zusatz-Auftrieb pro Radiant Anstellwinkel
const STALL_ANGLE = 0.34; // ≈ 20°: ab hier Strömungsabriss
const CD0 = 0.035; // Grund-Widerstand (Körper + Flügel)
const K_INDUCED = 0.06; // "induzierter" Widerstand: Auftrieb kostet Tempo
const BRAKE_CD = 0.7; // Zusatz-Widerstand beim Bremsen (V)
const MAX_G = 6; // maximale Kurvenkraft in "g" (sonst wirkt es zu zackig)

const PITCH_RATE = 1.45; // max. Drehrate Nase hoch/runter (rad/s)
const ROLL_RATE = 2.6; // max. Rollrate (rad/s)
const RESPONSE = 4.5; // wie schnell die Drehung auf Eingaben reagiert (Trägheit)
const WEATHERVANE = 0.075; // Nase dreht sich in Flugrichtung (wie ein Pfeil)
const TRIM = 0.05; // Nase leicht über der Flugbahn → etwas Auftrieb im Gleitflug (ohne Flughilfe)
const MAX_BANK = 1.2; // max. Schräglage mit Flughilfe (≈ 70°)

const FLAP_FREQ = 1.55; // Flügelschläge pro Sekunde
const FLAP_FREQ_FAST = 2.3;
const BOOST_ACC = 16; // Boost-Schub (m/s²) bei niedrigem Tempo
const STAMINA_DRAIN = 0.28; // Ausdauer-Verbrauch pro Sekunde Boost
const STAMINA_REGEN = 0.14; // Erholung pro Sekunde
const BODY_RADIUS = 4.2; // Kollisions-Kugel des Drachen (m)
const WORLD_RADIUS = 2850; // ab hier wird man sanft zurückgelenkt

const STEP = 1 / 120;

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// temporäre Vektoren (vermeidet Speicher-Müll pro Bild)
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _air = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _n = new THREE.Vector3();
const _e = new THREE.Euler();

/** Auftriebsbeiwert je nach Anstellwinkel (mit Strömungsabriss) */
function liftCoefficient(alpha) {
  const linear = clamp(CL0 + CL_ALPHA * alpha, -1.2, 1.75);
  // Nach dem Abriss verhält sich der Flügel wie eine flache Platte
  const plate = 1.1 * Math.sin(2 * alpha);
  const w = clamp((Math.abs(alpha) - STALL_ANGLE) / 0.2, 0, 1);
  return linear * (1 - w) + plate * w;
}

export class FlightPhysics {
  constructor() {
    this.position = new THREE.Vector3(0, 200, 0);
    this.velocity = new THREE.Vector3(0, 0, -35);
    this.quaternion = new THREE.Quaternion();
    this.angVel = new THREE.Vector3(); // Drehraten im Körper-System: x=Nicken, y=Gieren, z=Rollen

    this.stamina = 1;
    this.staminaDelay = 0;
    this.exhausted = false;
    this.flapPhase = 0;
    this.flapAmp = 0;
    this.fold = 0;
    this.boosting = false;
    this.hovering = false;
    this.braking = false;
    this.grounded = false;
    this.onWater = false;
    this.walkSpeed = 0;
    this.agl = 100; // Höhe über Boden
    this.speed = 35;
    this.yawRate = 0;
    this.bank = 0;
    this.outOfBounds = 0;
    this.frozen = false;
    this._heading = 0;
    this._acc = 0;
    this.events = {}; // flap, impact, land(water, Aufprall-Tempo), takeoff, splash
    this.lastInput = { pitch: 0, roll: 0 };
  }

  /** Drache an eine Position setzen (heading = Blickrichtung in Radiant) */
  reset(pos, heading = 0, speed = 35) {
    this.position.copy(pos);
    this.quaternion.setFromAxisAngle(UP, heading);
    this.velocity.copy(FWD).applyQuaternion(this.quaternion).multiplyScalar(speed);
    this.angVel.set(0, 0, 0);
    this.grounded = false;
    this.hovering = false;
    this.stamina = 1;
    this.exhausted = false;
    this.flapAmp = speed < 5 ? 0.8 : 0;
    this._heading = heading;
  }

  forward(out = new THREE.Vector3()) {
    return out.copy(FWD).applyQuaternion(this.quaternion);
  }
  up(out = new THREE.Vector3()) {
    return out.copy(UP).applyQuaternion(this.quaternion);
  }
  right(out = new THREE.Vector3()) {
    return out.copy(RIGHT).applyQuaternion(this.quaternion);
  }

  /**
   * @param input { pitch, roll, flap, flapPressed, dive, boost, hover }
   * @param env   { terrain, colliders, wind, assist, turbulence }
   */
  update(dt, input, env) {
    this.lastInput = input;
    if (this.frozen) {
      // Countdown vor dem Rennen: in der Luft stehen, nur Flügel schlagen
      this.flapPhase = (this.flapPhase + dt * FLAP_FREQ_FAST) % 1;
      this.flapAmp = damp(this.flapAmp, 0.9, 4, dt);
      this.hovering = true;
      this.velocity.set(0, 0, 0);
      return;
    }
    this._acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this._acc >= STEP && steps < 12) {
      this._step(STEP, input, env);
      this._acc -= STEP;
      steps++;
    }
    // Gierrate (für die Animation) aus der Kursänderung
    this.forward(_f);
    const heading = Math.atan2(-_f.x, -_f.z);
    this.yawRate = damp(this.yawRate, angleDiff(this._heading, heading) / Math.max(dt, 1e-4), 6, dt);
    this._heading = heading;
    this.speed = this.velocity.length();
    const ground = env.terrain.heightAt(this.position.x, this.position.z);
    this.agl = this.position.y - Math.max(ground, WATER_LEVEL);
    this.heightAboveWater = this.position.y - WATER_LEVEL;
    this.overWater = ground < WATER_LEVEL;
  }

  _step(dt, input, env) {
    const q = this.quaternion;
    const vel = this.velocity;
    const pos = this.position;
    const assist = env.assist;

    // ---------- Ausdauer & Boost ----------
    const wantsBoost = input.boost && !this.grounded && !this.exhausted;
    this.boosting = wantsBoost && this.stamina > 0;
    if (this.boosting) {
      this.stamina -= STAMINA_DRAIN * dt;
      this.staminaDelay = 1.0;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true; // erst ab 25% wieder boosten
      }
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt * (this.grounded ? 2 : 1));
      if (this.exhausted && this.stamina > 0.25) this.exhausted = false;
    }

    if (this.grounded) {
      this._groundStep(dt, input, env);
      return;
    }

    // Richtungsvektoren des Drachen (lokal → Welt)
    this.forward(_f);
    this.up(_u);
    this.right(_r);
    // Luft relativ zum Drachen (Wind zählt mit!)
    _air.copy(vel).sub(env.wind);
    const speed = _air.length();

    // Schweben (V gedrückt und langsam genug) → eigener Modus
    this.braking = !!input.hover && speed >= 24;
    const wantHover = !!input.hover && (this.hovering || speed < 24);
    this.hovering = wantHover;
    if (this.hovering) {
      this._hoverStep(dt, input, env);
      this._collide(dt, env);
      return;
    }

    // ---------- 1) DREHEN: Eingaben → Drehraten ----------
    // Bei wenig Tempo haben die Flügel weniger "Griff" → weniger Kontrolle
    const authority = clamp(speed / 25, 0.35, 1);
    // Querlage (bank): > 0 = rechter Flügel unten
    this.bank = Math.atan2(-_r.y, _u.y);
    // Dünne Luft in grosser Höhe
    const density = clamp(1 - (pos.y - 1400) / 900, 0.25, 1);
    // Anstellwinkel α (Luft von unten = positiv) und Schiebewinkel β (Luft von der Seite)
    let alpha = 0;
    let beta = 0;
    if (speed > 1) {
      _dir.copy(_air).divideScalar(speed);
      alpha = Math.atan2(-_dir.dot(_u), _dir.dot(_f));
      beta = Math.asin(clamp(_dir.dot(_r), -1, 1));
    }
    let tPitch;
    let tRoll;
    let tYaw;
    if (assist) {
      // ===== FLUGHILFE ("Fly-by-Wire") =====
      // a) Auto-Trimm: genau so viel Anstellwinkel, dass der Auftrieb das
      //    Gewicht trägt – auch in der Kurve (dort braucht es mehr Auftrieb).
      const spread = 1 - 0.8 * this.fold;
      const qd = K_AIR * density * speed * speed;
      const gamma = Math.asin(clamp(_air.y / Math.max(speed, 1e-3), -1, 1)); // Steigwinkel
      const cosBank = Math.max(Math.cos(this.bank), 0.35);
      const wantLift = Math.min(MAX_G * G, (G * Math.cos(gamma) * 0.97) / cosBank);
      const trim = clamp(((wantLift / Math.max(qd * spread, 1e-3)) - CL0) / CL_ALPHA, -0.15, STALL_ANGLE - 0.04);
      // b) S/W wählen den Ziel-Anstellwinkel: hochziehen = mehr Auftrieb (enge
      //    Kurve, Steigen), drücken = weniger. Nie über den Abrisswinkel.
      const maxA = STALL_ANGLE - 0.03;
      let alphaDes = input.pitch >= 0 ? trim + input.pitch * (maxA - trim) : trim + input.pitch * (trim + 0.22);
      if (input.dive) alphaDes = Math.min(alphaDes, -0.02);
      tPitch = speed > 8 ? clamp((alphaDes - alpha) * 7, -2.4, 2.4) : input.pitch * PITCH_RATE * authority;
      // c) A/D geben eine ZIEL-Schräglage vor (max. ~70°). Loslassen → gerade.
      //    Beim kräftigen Hochziehen (Looping) bleibt die Hilfe aus.
      const pulling = Math.abs(input.pitch) > 0.5 && Math.abs(input.roll) < 0.1;
      if (Math.abs(_f.y) < 0.9 && !pulling) {
        tRoll = clamp(-(input.roll * MAX_BANK - this.bank) * 3, -ROLL_RATE, ROLL_RATE) * authority;
      } else tRoll = -input.roll * ROLL_RATE * 0.5;
      // d) Nase seitlich in die Flugrichtung drehen (kein Rutschen)
      tYaw = speed > 8 ? clamp(-beta * 4, -1.5, 1.5) : -input.roll * 0.4;
    } else {
      // Ohne Flughilfe: direkte Drehraten (Fassrollen und Loopings möglich!)
      tPitch = input.pitch * PITCH_RATE * authority;
      tRoll = -input.roll * ROLL_RATE * authority; // negativ = rechts rollen
      tYaw = -input.roll * 0.22 * authority;
      if (input.dive) tPitch -= 0.15;
    }
    // Trägheit: die Drehrate nähert sich dem Ziel nur langsam an
    const k = 1 - Math.exp(-RESPONSE * dt);
    this.angVel.x += (tPitch - this.angVel.x) * k;
    this.angVel.y += (tYaw - this.angVel.y) * k;
    this.angVel.z += (tRoll - this.angVel.z) * k;
    // Drehung im Körper-System anwenden (q = q · Δq)
    _tmp.copy(this.angVel).multiplyScalar(dt);
    const ang = _tmp.length();
    if (ang > 1e-6) {
      _q.setFromAxisAngle(_tmp.divideScalar(ang), ang);
      q.multiply(_q);
    }

    // ---------- 2) WINDFAHNEN-EFFEKT (ohne Flughilfe) ----------
    // Wie ein Pfeil dreht sich die Nase von selbst in die Flugrichtung,
    // plus ein kleiner Winkel TRIM nach oben (damit die Flügel tragen).
    if (!assist && speed > 3) {
      this.forward(_f);
      this.up(_u);
      _dir.copy(_air).divideScalar(speed).addScaledVector(_u, TRIM).normalize();
      _tmp.crossVectors(_f, _dir);
      const s = _tmp.length();
      if (s > 1e-5) {
        const angle = Math.atan2(s, _f.dot(_dir));
        const kw = Math.min(WEATHERVANE * speed, 6);
        _q.setFromAxisAngle(_tmp.divideScalar(s), angle * (1 - Math.exp(-kw * dt)));
        q.premultiply(_q); // Welt-System: vorne anmultiplizieren
      }
    } else if (assist && speed <= 8) {
      // Sehr langsam (Strömungsabriss): Nase kippt nach vorne-unten
      this.forward(_f);
      if (_f.y > -0.5) {
        this.right(_r);
        _q.setFromAxisAngle(_r, -0.8 * dt);
        q.premultiply(_q);
      }
    }
    q.normalize();

    // ---------- 3) KRÄFTE ----------
    this.forward(_f);
    this.up(_u);
    this.right(_r);
    _acc.set(0, -G, 0); // Schwerkraft

    // Flügel anlegen beim Sturzflug (weniger Auftrieb, weniger Widerstand)
    this.fold = damp(this.fold, input.dive ? 0.85 : 0, 5, dt);
    const spread = 1 - 0.8 * this.fold;

    if (speed > 0.5) {
      _dir.copy(_air).divideScalar(speed); // Flugrichtung
      // Anstellwinkel α: Luft kommt von unten → positiv
      const alpha = Math.atan2(-_dir.dot(_u), _dir.dot(_f));
      const CL = liftCoefficient(alpha) * spread;
      const qd = K_AIR * density * speed * speed; // "Staudruck"-Faktor

      // AUFTRIEB: senkrecht zur Flugrichtung, in Richtung "oben" des Drachen
      _tmp.crossVectors(_r, _dir).normalize();
      const lift = clamp(qd * CL, -MAX_G * G, MAX_G * G);
      _acc.addScaledVector(_tmp, lift);

      // WIDERSTAND: gegen die Flugrichtung. Der "induzierte" Teil hängt vom
      // tatsächlich erzeugten Auftrieb ab (CLeff), nicht vom begrenzten Wunsch.
      const CLeff = lift / Math.max(qd, 1e-3);
      let CD = CD0 - 0.018 * this.fold + K_INDUCED * CLeff * CLeff;
      if (this.braking) CD += BRAKE_CD;
      if (speed > 120) CD += ((speed - 120) / 40) ** 2 * 0.05; // Höchstgeschwindigkeit
      _acc.addScaledVector(_dir, -qd * CD);

      // SEITENKRAFT: verhindert seitliches Rutschen (Körper + Schwanz)
      const side = _air.dot(_r);
      _acc.addScaledVector(_r, -side * (0.4 + speed * 0.02));
    }

    // SCHUB 1: Flügelschlag (pulsierend, synchron zur Animation)
    const autoFlap = assist && speed < 16 && !input.dive;
    const flapping = input.flap || this.boosting || autoFlap;
    const targetAmp = input.flap || this.boosting ? 1 : autoFlap ? 0.6 : 0;
    this.flapAmp = damp(this.flapAmp, targetAmp, 4, dt);
    if (flapping || this.flapAmp > 0.05) {
      const prev = this.flapPhase;
      this.flapPhase = (this.flapPhase + dt * (this.boosting ? FLAP_FREQ_FAST : FLAP_FREQ)) % 1;
      if (this.flapPhase < prev && this.flapAmp > 0.3) this.events.flap?.(this.flapAmp);
    }
    if (this.flapAmp > 0.01) {
      // Nur der Abschlag (Phase 0–0.5) drückt richtig. Mittelwert der Formel = 1.
      const stroke = 0.4 + 0.6 * (Math.max(0, Math.sin(this.flapPhase * Math.PI * 2)) / 0.318);
      // Beim steilen Steigen wird Flattern immer weniger wirksam (kein "Raketen-Drache")
      const climb = clamp(1 - (vel.y - 6) / 10, 0.15, 1);
      const fwdThrust = (7 * Math.max(0, 1 - speed / 60) + 1.2) * climb;
      const upThrust = (4 + 6 * Math.max(0, 1 - speed / 35)) * climb;
      _acc.addScaledVector(_f, fwdThrust * stroke * this.flapAmp * density);
      // Hub zeigt überwiegend nach OBEN (Welt) – sonst würde Dauer-Flattern
      // den Drachen in einen Looping drehen.
      _tmp.copy(_u).lerp(UP, 0.7).normalize();
      _acc.addScaledVector(_tmp, upThrust * stroke * this.flapAmp * density);
    }

    // SCHUB 2: Boost (verbraucht Ausdauer)
    if (this.boosting) _acc.addScaledVector(_f, BOOST_ACC * Math.max(0, 1 - speed / 110) + 3);

    // Turbulenz bei Sturm
    if (env.turbulence > 0) {
      const t = env.turbulence * 5;
      _acc.x += (Math.random() - 0.5) * t;
      _acc.y += (Math.random() - 0.5) * t;
      _acc.z += (Math.random() - 0.5) * t;
    }

    // Kartenrand: sanft zurück zur Mitte lenken
    const dist = Math.hypot(pos.x, pos.z);
    this.outOfBounds = clamp((dist - WORLD_RADIUS) / 300, 0, 1);
    if (dist > WORLD_RADIUS) {
      _tmp.set(-pos.x / dist, 0, -pos.z / dist);
      _acc.addScaledVector(_tmp, (dist - WORLD_RADIUS) * 0.06);
      // auch die Nase Richtung Mitte drehen
      const want = Math.atan2(pos.x, pos.z);
      const d = angleDiff(this._heading, want);
      _q.setFromAxisAngle(UP, d * dt * 0.8 * this.outOfBounds);
      q.premultiply(_q);
    }
    // Höhen-Decke
    if (pos.y > 2600) _acc.y -= (pos.y - 2600) * 0.1;

    // ---------- 4) BEWEGEN ----------
    vel.addScaledVector(_acc, dt);
    pos.addScaledVector(vel, dt);

    this._collide(dt, env);
  }

  // Schweben: Der Drache steht fast senkrecht in der Luft und schlägt kräftig.
  _hoverStep(dt, input, env) {
    const q = this.quaternion;
    const vel = this.velocity;
    this.fold = damp(this.fold, 0, 5, dt);
    this.flapAmp = damp(this.flapAmp, 1, 4, dt);
    const prev = this.flapPhase;
    this.flapPhase = (this.flapPhase + dt * 2.1) % 1;
    if (this.flapPhase < prev) this.events.flap?.(0.9);

    // Gieren mit A/D (auf der Stelle drehen)
    this.forward(_f);
    let heading = Math.atan2(-_f.x, -_f.z);
    heading -= input.roll * 1.3 * dt;
    // Zielhaltung: Nase 22° hoch, keine Schräglage
    _e.set(0.38 - input.pitch * 0.1, heading, 0, 'YXZ');
    _q2.setFromEuler(_e);
    q.slerp(_q2, 1 - Math.exp(-3 * dt));
    this.angVel.multiplyScalar(Math.exp(-5 * dt));
    this.bank = 0;

    // Gewünschte Geschwindigkeit: W vor, S zurück, Leertaste hoch, Shift runter
    _tmp.set(-Math.sin(heading), 0, -Math.cos(heading));
    _tmp2.copy(_tmp).multiplyScalar(-input.pitch * (input.pitch < 0 ? 12 : 6));
    _tmp2.y = (input.flap ? 9 : 0) - (input.dive ? 9 : 0);
    _tmp2.addScaledVector(env.wind, 0.25);
    const k = 1 - Math.exp(-1.8 * dt);
    vel.x += (_tmp2.x - vel.x) * k;
    vel.y += (_tmp2.y - vel.y) * k;
    vel.z += (_tmp2.z - vel.z) * k;
    this.position.addScaledVector(vel, dt);
  }

  // Am Boden: gehen, drehen, mit Leertaste abheben
  _groundStep(dt, input, env) {
    const q = this.quaternion;
    const pos = this.position;
    this.hovering = false;
    this.braking = false;
    this.fold = damp(this.fold, 0, 5, dt);
    this.flapAmp = damp(this.flapAmp, 0, 5, dt);
    this.forward(_f);
    let heading = Math.atan2(-_f.x, -_f.z);
    heading -= input.roll * 1.4 * dt;
    const target = input.pitch < -0.1 ? 9 : input.pitch > 0.1 ? -3 : 0;
    this.walkSpeed = damp(this.walkSpeed, target, 3, dt);
    const hx = -Math.sin(heading);
    const hz = -Math.cos(heading);
    pos.x += hx * this.walkSpeed * dt;
    pos.z += hz * this.walkSpeed * dt;
    const gh = env.terrain.heightAt(pos.x, pos.z);
    this.onWater = gh < WATER_LEVEL;
    const surface = Math.max(gh, WATER_LEVEL);
    const standY = surface + (this.onWater ? STAND_HEIGHT * 0.45 : STAND_HEIGHT);
    pos.y = damp(pos.y, standY, 10, dt);
    this.velocity.set(hx * this.walkSpeed, 0, hz * this.walkSpeed);

    // Körper an den Boden anpassen (Hang)
    if (this.onWater) _n.set(0, 1, 0);
    else env.terrain.normalAt(pos.x, pos.z, _n);
    _tmp.set(hx, 0, hz); // vorne
    _r.crossVectors(_tmp, _n).normalize(); // rechts
    _f.crossVectors(_n, _r).normalize(); // vorne, parallel zum Hang
    _m.makeBasis(_r, _n, _f.negate());
    _q.setFromRotationMatrix(_m);
    q.slerp(_q, 1 - Math.exp(-6 * dt));

    this._collide(dt, env);

    // Abheben!
    if (input.flapPressed || (input.flap && this.stamina > 0.05)) {
      this.grounded = false;
      _tmp.set(hx, 0, hz);
      this.velocity.copy(_tmp).multiplyScalar(14).add(_tmp2.set(0, 13, 0));
      this.flapAmp = 1;
      this.flapPhase = 0;
      this.events.takeoff?.();
      this.events.flap?.(1.2);
    }
  }

  // Boden, Wasser und Gebäude
  _collide(dt, env) {
    const pos = this.position;
    const vel = this.velocity;
    const gh = env.terrain.heightAt(pos.x, pos.z);
    const water = gh < WATER_LEVEL;
    const surface = Math.max(gh, WATER_LEVEL);
    const minY = surface + (water ? STAND_HEIGHT * 0.45 : STAND_HEIGHT);

    if (!this.grounded && pos.y < minY) {
      if (water) _n.set(0, 1, 0);
      else env.terrain.normalAt(pos.x, pos.z, _n);
      const into = -vel.dot(_n); // wie schnell geht es "in den Boden"?
      pos.y = minY;
      const speed = vel.length();
      if (water && into > 2) this.events.splash?.(clamp(speed / 50, 0.3, 1.5));
      if (into > 14 && speed > 20) {
        // harter Aufprall → abprallen
        vel.addScaledVector(_n, into * 1.35);
        vel.multiplyScalar(0.55);
        this.stamina = Math.max(0, this.stamina - 0.2);
        this.events.impact?.(clamp(into / 30, 0.3, 1.5), water);
      } else if (into > 0) {
        // weich: Geschwindigkeit in den Boden entfernen, Reibung
        vel.addScaledVector(_n, into);
        vel.multiplyScalar(Math.exp(-(water ? 1.5 : 1.0) * dt));
        const horiz = Math.hypot(vel.x, vel.z);
        if (horiz < 14 && !this.hovering) {
          this.grounded = true;
          this.walkSpeed = 0;
          vel.set(0, 0, 0);
          this.events.land?.(water, into);
        }
      }
      if (this.hovering && pos.y <= minY + 0.01 && vel.y <= 0.1) {
        this.hovering = false;
        this.grounded = true;
        this.events.land?.(water, 2);
      }
    }

    // Gebäude & Felsen
    if (env.colliders) {
      for (let i = 0; i < 3; i++) {
        const depth = env.colliders.test(pos, BODY_RADIUS, _n);
        if (depth <= 0) break;
        pos.addScaledVector(_n, depth);
        const vn = vel.dot(_n);
        if (vn < 0) {
          vel.addScaledVector(_n, -vn * 1.25);
          if (-vn > 18) {
            vel.multiplyScalar(0.7);
            this.stamina = Math.max(0, this.stamina - 0.15);
            this.events.impact?.(clamp(-vn / 35, 0.3, 1.4), false);
          }
        }
      }
    }
  }

  /** Zustand für die Animation des Modells */
  animState(out = {}) {
    out.flapPhase = this.flapPhase;
    out.flapAmp = this.flapAmp;
    out.fold = this.fold;
    out.bank = this.bank;
    out.pitchRate = this.angVel.x;
    out.yawRate = this.yawRate;
    out.roll = this.lastInput.roll || 0;
    out.speed = this.speed;
    out.hover = this.hovering || this.frozen ? 1 : 0;
    out.grounded = this.grounded ? 1 : 0;
    out.walk = this.grounded ? Math.min(1, Math.abs(this.walkSpeed) / 6) : 0;
    out.boost = this.boosting;
    return out;
  }
}
