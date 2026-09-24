// Anpassung: Drachenfarbe, Feuerfarbe, Reiter an/aus.
// Änderungen wirken sofort (ohne Neuladen) und werden gespeichert.
import { storage } from '../core/utils.js';

const KEY = 'dragontwin.custom.v3'; // v3: neue Standardfarbe Schwarz (wilder Drache); v2 war Grau

// Natürliche, gedämpfte Farben (wie echte Reptilien – nicht knallig)
export const SKINS = {
  grey: { label: 'Grau', body: 0x6e665c, belly: 0x9c9080, membrane: 0x5e4c42, horn: 0xb8ab92, eye: 0xff9a22 },
  black: { label: 'Schwarz', body: 0x24221f, belly: 0x4a4038, membrane: 0x2e2522, horn: 0xa89c86, eye: 0xff5a1a, rough: 0.7 },
  blue: { label: 'Stahlblau', body: 0x3c4b5c, belly: 0x8a8578, membrane: 0x2e3440, horn: 0xbfb5a0, eye: 0x7ad0ff },
  green: { label: 'Moosgrün', body: 0x4a5236, belly: 0x9a9170, membrane: 0x3e3f2a, horn: 0xb8ac8c, eye: 0xfff040 },
  red: { label: 'Rostrot', body: 0x6a2e22, belly: 0xa88660, membrane: 0x4a1e18, horn: 0x3a302a, eye: 0xffe070 },
  bone: { label: 'Knochenweiss', body: 0xb8ae9c, belly: 0x8e8270, membrane: 0x7a6a5a, horn: 0x3a3028, eye: 0x40c0ff },
  gold: { label: 'Gold ✦', body: 0xa67c2c, belly: 0xd8c08a, membrane: 0x7a5418, horn: 0xf0e2c0, eye: 0xff3010, metal: 0.7, rough: 0.35, locked: true },
};

export const FIRE_COLORS = {
  orange: { label: 'Orange', c: [0xfff2c0, 0xff9a2a, 0x8a2000] },
  red: { label: 'Rot', c: [0xffd8c8, 0xff3a1a, 0x700600] },
  blue: { label: 'Blau', c: [0xeaf6ff, 0x3aa0ff, 0x0a2090] },
  green: { label: 'Grün', c: [0xeeffd8, 0x4aff5a, 0x065a14] },
  purple: { label: 'Violett', c: [0xf6e6ff, 0xb050ff, 0x3a0a80] },
  pink: { label: 'Pink', c: [0xfff0f8, 0xff66c0, 0x8a0a50] },
  crimson: { label: 'Dunkelrot', c: [0xffb0a0, 0xb0101c, 0x300004] },
};

export class Customization {
  constructor() {
    const saved = storage.get(KEY, {});
    this.state = {
      skin: SKINS[saved.skin] ? saved.skin : 'black',
      fire: FIRE_COLORS[saved.fire] ? saved.fire : 'orange',
      rider: saved.rider !== false,
    };
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  set(key, value) {
    this.state[key] = value;
    storage.set(KEY, this.state);
    for (const fn of this.listeners) fn(this.state);
  }

  get skin() {
    return SKINS[this.state.skin];
  }

  get fire() {
    return FIRE_COLORS[this.state.fire];
  }
}
