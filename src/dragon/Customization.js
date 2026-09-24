// Anpassung: Drachenfarbe, Feuerfarbe, Reiter an/aus.
// Änderungen wirken sofort (ohne Neuladen) und werden gespeichert.
import { storage } from '../core/utils.js';

const KEY = 'dragontwin.custom.v1';

export const SKINS = {
  black: { label: 'Schwarz', body: 0x1c1b22, belly: 0x4a4038, membrane: 0x2a1f2a, horn: 0xc8bca0, eye: 0xff5a1a, metal: 0.3, rough: 0.4 },
  blue: { label: 'Blau', body: 0x1f4f95, belly: 0xc9b58c, membrane: 0x173766, horn: 0xdcd0b4, eye: 0xffc020 },
  green: { label: 'Grün', body: 0x2f6a2a, belly: 0xc2b27a, membrane: 0x2a4a1e, horn: 0xd6c8a4, eye: 0xfff040 },
  red: { label: 'Rot', body: 0x7c1b16, belly: 0xd4a86a, membrane: 0x5a1210, horn: 0x2a2220, eye: 0xffe070 },
  bone: { label: 'Knochenweiss', body: 0xcfc6b2, belly: 0x9c8e76, membrane: 0x8a7a66, horn: 0x3a3028, eye: 0x40c0ff },
  gold: { label: 'Gold ✦', body: 0xc9982e, belly: 0xf0dca0, membrane: 0x9a6a1a, horn: 0xfff4d0, eye: 0xff3010, metal: 0.85, rough: 0.28, locked: true },
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
      skin: SKINS[saved.skin] ? saved.skin : 'blue',
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
