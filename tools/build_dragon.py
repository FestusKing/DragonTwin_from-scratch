#!/usr/bin/env python3
"""
Drache "Scales" für DragonTwin – komplett per Skript in Blender gebaut.

Was das Skript macht:
  1. Es baut einen Wyvern (Flügel = Arme, zwei Hinterbeine) nur aus Formeln:
     Körper mit Kopf, Unterkiefer, Beine, Flügel mit Flughaut, Hörner,
     Rückenstacheln, Krallen, Zähne und Augen.
  2. Es baut ein Skelett (nur verformende Knochen) und rechnet aus,
     welcher Punkt der Haut an welchem Knochen hängt ("Gewichte").
  3. Es malt die Texturen (Schuppen, Bauchplatten, Adern) mit Cycles ("Bake").
  4. Es exportiert alles als GLB (glTF 2.0) für Three.js.

Sicherheit: Das Skript lädt NICHTS aus dem Internet und öffnet keine fremden
Dateien. Blender-Skripte in Dateien werden sowieso nicht automatisch ausgeführt.

Benutzung (Beispiel):
  python3.11 -m venv venv
  venv/bin/pip install bpy==5.0.1
  venv/bin/python tools/build_dragon.py --work /tmp/drache \
      --glb public/models/dragon_scales.glb --bones tools/dragon_scales_bones.json
  # Kontrolle: GLB wieder einlesen, zählen und Vorschaubilder rendern
  venv/bin/python tools/build_dragon.py --check public/models/dragon_scales.glb --work /tmp/drache

Koordinaten beim Bauen (Blender): x = rechts, y = vorne, z = oben, Einheit Meter.
Im GLB (glTF): x = rechts, y = oben, z = hinten → der Kopf zeigt nach -z (wie im Spiel).
"""
import argparse
import json
import math
import os
import struct
import sys
import time

import numpy as np

try:
    import bpy
    from mathutils import Matrix, Vector
except ImportError:
    sys.exit("Fehler: Das Modul 'bpy' fehlt. Installieren mit: pip install bpy==5.0.1")

TAU = 2.0 * math.pi
T_START = time.time()


def log(*a):
    print(f"[{time.time() - T_START:6.1f}s]", *a, flush=True)


# =====================================================================
# 1. Mathe-Helfer
# =====================================================================
def vec3(x, y, z):
    return np.array([x, y, z], dtype=float)


def nrm(v):
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def smooth(e0, e1, x):
    """Weicher Übergang von 0 (bei e0) nach 1 (bei e1)."""
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


def gauss(x, s):
    return math.exp(-0.5 * (x / s) ** 2)


def wrap(a):
    """Winkel in den Bereich -pi..pi bringen."""
    return (a + math.pi) % TAU - math.pi


def rotz(v, a):
    c, s = math.cos(a), math.sin(a)
    return vec3(v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2])


class Pchip:
    """Glatte Kurve durch Tabellenwerte, ohne Überschwingen (monotone kubische Interpolation)."""

    def __init__(self, xs, ys):
        self.x = np.asarray(xs, float)
        y = np.asarray(ys, float)
        self.y = y[:, None] if y.ndim == 1 else y
        self.scalar = y.ndim == 1
        h = np.diff(self.x)
        if np.any(h <= 0):
            raise ValueError("Pchip: x-Werte müssen aufsteigend sein")
        d = np.diff(self.y, axis=0) / h[:, None]
        m = np.zeros_like(self.y)
        m[0], m[-1] = d[0], d[-1]
        for i in range(1, len(self.x) - 1):
            for j in range(self.y.shape[1]):
                a, b = d[i - 1, j], d[i, j]
                if a * b <= 0:
                    m[i, j] = 0.0
                else:
                    w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                    m[i, j] = (w1 + w2) / (w1 / a + w2 / b)
        self.h, self.m = h, m

    def __call__(self, x):
        x = min(max(x, self.x[0]), self.x[-1])
        i = int(np.clip(np.searchsorted(self.x, x) - 1, 0, len(self.x) - 2))
        h = self.h[i]
        t = (x - self.x[i]) / h
        r = ((2 * t**3 - 3 * t**2 + 1) * self.y[i] + (t**3 - 2 * t**2 + t) * h * self.m[i]
             + (-2 * t**3 + 3 * t**2) * self.y[i + 1] + (t**3 - t**2) * h * self.m[i + 1])
        return float(r[0]) if self.scalar else r


def _catmull(p0, p1, p2, p3, n):
    """Ein Stück einer Catmull-Rom-Kurve (zentripetal) zwischen p1 und p2."""
    def tj(t, a, b):
        return t + max(np.linalg.norm(b - a), 1e-6) ** 0.5
    t0 = 0.0
    t1 = tj(t0, p0, p1)
    t2 = tj(t1, p1, p2)
    t3 = tj(t2, p2, p3)
    res = []
    for t in np.linspace(t1, t2, n, endpoint=False):
        a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
        a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
        a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
        b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
        b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
        res.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    return res


class Curve:
    """Kurve durch Punkte; man kann sie nach Bogenlänge s (Meter) abfragen."""

    def __init__(self, pts, smooth=True, n=60):
        P = [np.asarray(p, float) for p in pts]
        out = []
        if smooth and len(P) > 2:
            ext = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
            for i in range(1, len(ext) - 2):
                out.extend(_catmull(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], n))
        else:
            for a, b in zip(P[:-1], P[1:]):
                out.extend(a + (b - a) * t for t in np.linspace(0, 1, n, endpoint=False))
        out.append(P[-1])
        self.p = np.array(out)
        seg = np.linalg.norm(np.diff(self.p, axis=0), axis=1)
        self.s = np.concatenate([[0.0], np.cumsum(seg)])
        self.length = float(self.s[-1])

    def at(self, s):
        s = min(max(s, 0.0), self.length)
        i = int(np.clip(np.searchsorted(self.s, s) - 1, 0, len(self.s) - 2))
        d = self.s[i + 1] - self.s[i]
        t = (s - self.s[i]) / d if d > 1e-12 else 0.0
        return self.p[i] * (1 - t) + self.p[i + 1] * t

    def tangent(self, s, eps=0.03):
        return nrm(self.at(s + eps) - self.at(s - eps))

    def s_at(self, axis, value):
        """Bogenlänge, bei der die Koordinate 'axis' den Wert 'value' hat (dort monoton steigend)."""
        return float(np.interp(value, self.p[:, axis], self.s))

    def s_near(self, p):
        return float(self.s[int(np.argmin(np.linalg.norm(self.p - p, axis=1)))])


def bezier(p0, p1, p2, n=24):
    return [p0 * (1 - t) ** 2 + p1 * 2 * (1 - t) * t + p2 * t * t for t in np.linspace(0, 1, n)]


def frame(T, uref):
    """Seite (Sd) und Oben (U) senkrecht zur Laufrichtung T. uref = gewünschte Oben-Richtung."""
    Sd = nrm(np.cross(T, uref))
    U = nrm(np.cross(Sd, T))
    return Sd, U


def section(phi, rx, rt, rb, n=2.0):
    """Querschnitt: phi = 0 unten (Naht), pi/2 rechts, pi oben. n > 2 = kantiger ("Superellipse")."""
    s, c = math.sin(phi), math.cos(phi)
    e = 2.0 / n
    x = rx * math.copysign(abs(s) ** e, s)
    z = -(rb if c > 0 else rt) * math.copysign(abs(c) ** e, c)
    return x, z


# =====================================================================
# 2. Gewichte (welcher Hautpunkt hängt an welchem Knochen)
# =====================================================================
def wclean(w, keep=4):
    """Höchstens 4 Knochen pro Punkt (glTF-Standard), Summe = 1."""
    items = sorted(((k, v) for k, v in w.items() if v > 1e-4), key=lambda kv: -kv[1])[:keep]
    tot = sum(v for _, v in items)
    if tot <= 0:
        raise ValueError("Punkt ohne Knochen-Gewicht")
    out = {k: v / tot for k, v in items if v / tot >= 0.01}
    tot = sum(out.values())
    return {k: v / tot for k, v in out.items()}


def wmix(*pairs):
    """Gewichte mischen: wmix((0.3, w1), (0.7, w2)). Negative Anteile werden gekappt."""
    out = {}
    for f, w in pairs:
        for k, v in w.items():
            out[k] = out.get(k, 0.0) + f * v
    return {k: max(v, 0.0) for k, v in out.items()}


class Chain:
    """Knochenkette entlang einer Linie: segs = [(Name, s_start, s_ende), ...] aufsteigend."""

    def __init__(self, segs, blend=0.3):
        self.segs, self.blend = segs, blend

    def weights(self, s):
        segs = self.segs
        if s <= segs[0][1]:
            return {segs[0][0]: 1.0}
        if s >= segs[-1][2]:
            return {segs[-1][0]: 1.0}
        i = next(j for j, (_, s0, s1) in enumerate(segs) if s0 <= s <= s1)
        name, s0, s1 = segs[i]
        w = {name: 1.0}
        # weicher Übergang am Gelenk zum Vorgänger bzw. Nachfolger
        if i > 0:
            pn, p0, p1 = segs[i - 1]
            hw = min(self.blend, 0.35 * (s1 - s0), 0.35 * (p1 - p0))
            if s < s0 + hw:
                t = smooth(s0 - hw, s0 + hw, s)
                return {pn: 1 - t, name: t}
        if i < len(segs) - 1:
            nn, n0, n1 = segs[i + 1]
            hw = min(self.blend, 0.35 * (s1 - s0), 0.35 * (n1 - n0))
            if s > s1 - hw:
                t = smooth(s1 - hw, s1 + hw, s)
                return {name: 1 - t, nn: t}
        return w


# =====================================================================
# 3. Bau-Teile: Punkte, Flächen, Muster-Koordinaten, Gewichte
# =====================================================================
class Part:
    """Ein Teil des Drachen (wird später ein Blender-Objekt)."""

    def __init__(self, name, kind, atlas="A"):
        self.name, self.kind, self.atlas = name, kind, atlas
        self.v, self.w = [], []
        self.f, self.fm, self.fpat, self.finf, self.fuv = [], [], [], [], []
        self.seams = set()

    def vert(self, p, w):
        self.v.append(np.asarray(p, float))
        self.w.append(wclean(w))
        return len(self.v) - 1

    def face(self, idx, mat, pat, inf, uv=None):
        self.f.append(tuple(idx))
        self.fm.append(mat)
        self.fpat.append(list(pat))
        self.finf.append(list(inf))
        self.fuv.append(uv)

    def seam(self, a, b):
        if a != b:
            self.seams.add((min(a, b), max(a, b)))

    def ntris(self):
        return sum(len(f) - 2 for f in self.f)


def side_name(n, to="L"):
    return n[:-2] + "_" + to if n.endswith("_R") else n


def mirror_part(p, name):
    """Rechte Seite spiegeln (x → -x), Knochen _R → _L."""
    q = Part(name, p.kind, p.atlas)
    q.v = [v * np.array([-1.0, 1.0, 1.0]) for v in p.v]
    q.w = [{side_name(k): v for k, v in d.items()} for d in p.w]
    q.f = [tuple(reversed(f)) for f in p.f]      # Spiegeln dreht die Flächen um → Reihenfolge umkehren
    q.fm = list(p.fm)
    q.fpat = [list(reversed(x)) for x in p.fpat]
    q.finf = [list(reversed(x)) for x in p.finf]
    q.fuv = [list(reversed(x)) if x is not None else None for x in p.fuv]
    q.seams = set(p.seams)
    return q


def loft(part, rings, mat_of, cap0=None, cap1=None):
    """Verbindet Ringe (je R Punkte) zu einer Röhre. Naht bei Punkt 0 jedes Rings.
    rings: [{'pts': (R,3), 'w': Gewichte, 'b': Muster-Koordinate entlang, 'inf': (2 Werte)}]
    cap0/cap1: {'p': Spitze, 'b': ...} schliesst den Anfang/das Ende mit einer Spitze."""
    R = len(rings[0]["pts"])
    ids = [[part.vert(p, r["w"]) for p in r["pts"]] for r in rings]
    # Richtung prüfen: Normalen sollen nach aussen zeigen
    i0 = max(0, min(len(rings) // 2, len(rings) - 2))
    P, Q = rings[i0]["pts"], rings[i0 + 1]["pts"]
    cen = P.mean(axis=0)
    score = sum(np.dot(np.cross(P[(k + 1) % R] - P[k], Q[k] - P[k]), P[k] - cen) for k in range(R))
    flip = score < 0

    def put(idx, mat, pat, inf, rev):
        if rev:
            idx, pat, inf = idx[::-1], pat[::-1], inf[::-1]
        part.face(idx, mat, pat, inf)

    last = len(rings) - 1
    for i in range(last):
        ra, rb_ = rings[i], rings[i + 1]
        for k in range(R):
            k1 = (k + 1) % R
            idx = [ids[i][k], ids[i][k1], ids[i + 1][k1], ids[i + 1][k]]
            pat = [(k / R, ra["b"]), ((k + 1) / R, ra["b"]), ((k + 1) / R, rb_["b"]), (k / R, rb_["b"])]
            inf = [ra["inf"], ra["inf"], rb_["inf"], rb_["inf"]]
            put(idx, mat_of(i, k), pat, inf, flip)
        part.seam(ids[i][0], ids[i + 1][0])
    for cap, ri, start in ((cap0, 0, True), (cap1, last, False)):
        if cap is None:
            continue
        tip = part.vert(cap["p"], rings[ri]["w"])
        r = rings[ri]
        for k in range(R):
            k1 = (k + 1) % R
            idx = [ids[ri][k], ids[ri][k1], tip]
            pat = [(k / R, r["b"]), ((k + 1) / R, r["b"]), ((k + 0.5) / R, cap["b"])]
            put(idx, mat_of(min(ri, last - 1), k), pat, [r["inf"]] * 3, flip != start)
        part.seam(ids[ri][0], tip)
    return ids


def seam_ring(part, ring_ids):
    R = len(ring_ids)
    for k in range(R):
        part.seam(ring_ids[k], ring_ids[(k + 1) % R])


def tube(part, curve, radius, R, uref, weights, mat, flat=(1.0, 1.0), step=0.05, n_rings=None,
         cap0=False, cap1=True):
    """Röhre entlang einer Kurve (Beine, Arme, Finger, Hörner, Krallen, Zähne, Stacheln).
    radius(s) in Metern, weights(s, t) → Gewichte, flat = Streckung (seitlich, oben/unten).
    Muster-Koordinaten: a (rundherum), b (entlang, in Umfängen); Info: (t = 0..1, Länge)."""
    L = curve.length
    n = n_rings or max(3, int(math.ceil(L / step)))
    rings, b, s_prev, r_prev = [], 0.0, 0.0, None
    for i in range(n + 1):
        t = i / n
        s = t * L
        C = curve.at(s)
        T = curve.tangent(s, eps=min(0.03, L * 0.02))
        Sd, U = frame(T, uref)
        r = radius(s)
        if r_prev is not None:
            b += (s - s_prev) / max(math.pi * (r + r_prev) * 0.5 * (flat[0] + flat[1]), 0.04)
        s_prev, r_prev = s, r
        pts = np.array([C + Sd * (r * flat[0] * math.sin(TAU * k / R)) - U * (r * flat[1] * math.cos(TAU * k / R))
                        for k in range(R)])
        rings.append({"pts": pts, "w": weights(s, t), "b": b, "inf": (t, L)})
    T0, T1 = curve.tangent(0.0), curve.tangent(L)
    c0 = {"p": curve.at(0.0) - T0 * radius(0.0) * 0.6, "b": -0.05} if cap0 else None
    c1 = {"p": curve.at(L) + T1 * max(radius(L), 0.004) * 0.9, "b": b + 0.05} if cap1 else None
    return loft(part, rings, lambda i, k: mat, c0, c1)


# =====================================================================
# 4. Form des Drachen (alle Masse in Metern)
# =====================================================================
# Mittellinie von der Schwanzspitze (hinten) bis zur Schnauze: (y, z)
BODY_CTRL = [(-13.0, -0.12), (-10.0, -0.22), (-7.0, -0.16), (-4.6, -0.04), (-2.1, 0.0), (0.0, 0.0),
             (1.4, 0.0), (2.5, 0.08), (3.4, 0.32), (4.4, 0.8), (5.5, 1.25), (6.6, 1.48), (7.4, 1.5),
             (8.4, 1.36), (9.9, 1.08)]
# Querschnitte: y, Breite (rx), Höhe oben (rt), Höhe unten (rb), Kantigkeit n
BODY_ST = [
    (-13.0, .012, .012, .012, 2.0), (-12.8, .045, .05, .045, 2.0), (-12.0, .085, .095, .085, 2.0),
    (-10.5, .14, .155, .14, 2.0), (-8.5, .22, .235, .21, 2.0), (-6.5, .32, .335, .30, 2.0),
    (-4.8, .46, .47, .43, 2.05), (-3.5, .63, .64, .58, 2.1), (-2.3, .84, .82, .78, 2.2),
    (-1.2, .93, .91, .90, 2.2), (0.0, 1.02, .97, 1.04, 2.2), (1.2, 1.12, 1.0, 1.22, 2.2),     # Brust (Kiel)
    (2.2, 1.02, .93, 1.12, 2.2), (2.9, .78, .73, .86, 2.1), (3.5, .53, .52, .60, 2.0),        # Halsansatz
    (4.3, .40, .41, .44, 2.0), (5.2, .32, .33, .35, 2.0), (6.0, .29, .30, .31, 2.0),
    (6.6, .32, .32, .29, 2.2), (7.0, .41, .37, .24, 2.5), (7.5, .47, .41, .20, 2.6),          # Hinterkopf
    (8.0, .42, .37, .16, 2.6), (8.5, .33, .29, .13, 2.6), (9.1, .27, .24, .11, 2.6),          # Augen, Schnauze
    (9.55, .24, .21, .10, 2.5), (9.8, .17, .15, .08, 2.3), (9.86, .12, .105, .06, 2.2), (9.9, .04, .035, .03, 2.0),
]
R_BODY = 48
BELLY_COLS = 6            # Spalten links und rechts der Bauchnaht = Bauch (bzw. Gaumen am Kopf)
HEAD_Y = 6.95             # ab hier ist der Körper-Schlauch der Oberkopf
EYE_Y, EYE_PHI = 7.95, math.pi / 2 + 0.55
SADDLE = (1.0, 3.9)       # hier keine Rückenstacheln (Platz für Sattel und Reiter im Spiel)

# Knochen entlang der Körperlinie: Name, y Anfang, y Ende, Eltern
SPINE = [
    ("root", 0.0, 1.0, None), ("chest", 1.0, 3.5, "root"),
    ("neck_01", 3.5, 4.2, "chest"), ("neck_02", 4.2, 4.9, "neck_01"), ("neck_03", 4.9, 5.6, "neck_02"),
    ("neck_04", 5.6, 6.3, "neck_03"), ("neck_05", 6.3, 7.0, "neck_04"), ("head", 7.0, 9.9, "neck_05"),
    ("hips", 0.0, -3.4, "root"), ("tail_01", -3.4, -4.4, "hips"), ("tail_02", -4.4, -5.4, "tail_01"),
    ("tail_03", -5.4, -6.4, "tail_02"), ("tail_04", -6.4, -7.4, "tail_03"), ("tail_05", -7.4, -8.4, "tail_04"),
    ("tail_06", -8.4, -9.5, "tail_05"), ("tail_07", -9.5, -10.7, "tail_06"), ("tail_08", -10.7, -13.0, "tail_07"),
]

# Unterkiefer: y, Höhe oben, Höhe unten, Breite (Anteil der Kopfbreite)
JAW_ST = [(6.95, .02, .03, .30), (7.08, .035, .12, .72), (7.3, .045, .19, .86), (7.8, .05, .19, .90),
          (8.4, .05, .155, .90), (9.0, .045, .115, .90), (9.5, .04, .085, .88), (9.72, .035, .065, .80),
          (9.82, .02, .03, .40)]
R_JAW = 32
JAW_BELLY_COLS = 5        # Kehle (unten)
JAW_MOUTH_COL = 11        # ab hier (bis zur Mitte oben) ist Maul-Innenseite
JAW_HINGE_Y = 7.3

# Beine (rechte Seite): Hüfte, Knie, Ferse, Fussballen
LEG_H, LEG_K = vec3(0.70, -2.0, -0.2), vec3(0.84, -1.35, -1.25)
LEG_A, LEG_B = vec3(0.86, -2.15, -1.95), vec3(0.86, -1.80, -2.50)
GROUND_Z = -2.66          # Boden unter den Füssen (Stand)

# Flügel (rechte Seite), wie im Spiel: Oberarm 2.94 m, Unterarm 3.64 m, 4 lange Finger
WING_S = vec3(0.78, 2.05, 0.62)
DIHEDRAL = 0.07           # Flügel leicht nach oben (V-Form)
FINGER_ANG = (-0.22, 0.38, 0.98, 1.58)
FINGER_LEN = (5.32, 4.9, 4.13, 3.22)
MEMBRANE_Y_BODY = -1.9    # hier endet die Flughaut hinten am Körper
MEM_UV = (0.4, -2.4, 12.6, 6.3)  # Flughaut-Textur: x0, y0, Breite, Höhe (Meter)


class BodyShape:
    def __init__(self):
        self.curve = Curve([vec3(0.0, y, z) for y, z in BODY_CTRL])
        st = np.array(BODY_ST)
        self.st = Pchip(st[:, 0], st[:, 1:])

    def s_of_y(self, y):
        return self.curve.s_at(1, y)

    def params(self, y):
        rx, rt, rb, n = self.st(y)
        return rx, rt, rb, n

    def frame(self, s):
        T = self.curve.tangent(s)
        Sd, U = frame(T, vec3(0, 0, 1))
        return T, Sd, U

    def point(self, s, phi, detail=True):
        C = self.curve.at(s)
        T, Sd, U = self.frame(s)
        rx, rt, rb, n = self.params(C[1])
        x, z = section(phi, rx, rt, rb, n)
        if detail:
            d = surface_detail(C[1], phi, rt)
            r = math.hypot(x, z)
            if r > 1e-9:
                x, z = x + x / r * d, z + z / r * d
        return C + Sd * x + U * z


def surface_detail(y, phi, rt):
    """Kleine Beulen und Mulden auf der Haut: Rückenkante, Brustkiel, Brauen, Augen, Nüstern."""
    d = 0.0
    top = max(0.0, -math.cos(phi))
    bottom = max(0.0, math.cos(phi))
    if y < 6.6:
        d += 0.05 * rt * top ** 14                                           # Rückenkante
    d += 0.10 * gauss(y - 1.4, 0.6) * bottom ** 8                          # Brustkiel (Flugmuskeln)
    if y > 6.4:
        for side in (1, -1):
            def dp(p0):
                return wrap(phi - (p0 if side > 0 else TAU - p0))
            d += 0.075 * gauss(y - 8.05, 0.28) * gauss(dp(math.pi - 0.9), 0.2)        # Brauenwulst
            d -= 0.045 * gauss(y - EYE_Y, 0.12) * gauss(dp(EYE_PHI), 0.16)             # Augenhöhle
            d += 0.03 * gauss(y - 9.55, 0.08) * gauss(dp(math.pi - 0.55), 0.18)       # Nüstern-Wulst
            d -= 0.028 * gauss(y - 9.6, 0.035) * gauss(dp(math.pi - 0.55), 0.07)      # Nasenloch
            d += 0.05 * gauss(y - 7.45, 0.25) * gauss(dp(math.pi / 2 - 0.1), 0.3)     # Wangenknochen
            d += 0.018 * smooth(7.3, 7.6, y) * gauss(dp(math.pi / 2 - 0.55), 0.12)    # Lippenwulst
        d += 0.02 * smooth(8.2, 8.6, y) * (1 - smooth(9.4, 9.7, y)) * gauss(wrap(phi - math.pi), 0.25)  # Nasenrücken
        d += 0.06 * gauss(y - 7.05, 0.18) * gauss(wrap(phi - math.pi), 0.2)          # Hinterhauptkamm
    return d


class JawShape:
    def __init__(self, B):
        self.B = B
        st = np.array(JAW_ST)
        self.st = Pchip(st[:, 0], st[:, 1:])

    def ring(self, y):
        """Mittelpunkt, Rahmen und Masse des Unterkiefers bei y."""
        B = self.B
        s = B.s_of_y(y)
        C = B.curve.at(s)
        T, Sd, U = B.frame(s)
        rx_h, rt_h, rb_h, _ = B.params(y)
        rt, rb, xs = self.st(y)
        center = C - U * (rb_h + rt - 0.012)      # sitzt direkt unter dem Oberkopf (etwas überlappend)
        return center, T, Sd, U, rx_h * xs, rt, rb

    def point(self, y, phi):
        c, T, Sd, U, rx, rt, rb = self.ring(y)
        x, z = section(phi, rx, rt, rb, 2.4)
        return c + Sd * x + U * z


# =====================================================================
# 5. Die einzelnen Teile bauen
# =====================================================================
def body_chain(B):
    segs = []
    for name, y0, y1, _ in SPINE:
        a, b = B.s_of_y(y0), B.s_of_y(y1)
        segs.append((name, min(a, b), max(a, b)))
    segs.sort(key=lambda x: x[1])
    return Chain(segs, blend=0.35)


def build_body(B, chain):
    part = Part("Koerper", "body")
    L = B.curve.length
    ss, s = [], 0.0
    while s < L - 0.012:
        ss.append(s)
        y = B.curve.at(s)[1]
        rx, rt, rb, _ = B.params(y)
        r = (rx + rt + rb) / 3.0
        if y > 9.75:
            ds = 0.025          # Schnauzenspitze fein rund
        elif y > 6.7:
            ds = 0.065          # Kopf: fein für Details
        else:
            ds = min(max(0.5 * r, 0.09), 0.16)
        s += ds
    ss.append(L - 0.004)
    rings, b = [], 0.0
    for i, s in enumerate(ss):
        C = B.curve.at(s)
        y = C[1]
        rx, rt, rb, _ = B.params(y)
        if i > 0:
            circ = max(math.pi * (rx + 0.5 * (rt + rb)), 0.12)
            b += (s - ss[i - 1]) / circ
        pts = np.array([B.point(s, TAU * k / R_BODY) for k in range(R_BODY)])
        rings.append({"pts": pts, "w": chain.weights(s), "b": b, "inf": (y, 0.0), "y": y})

    def mat_of(i, k):
        return "Bauch" if (k < BELLY_COLS or k >= R_BODY - BELLY_COLS) else "Haut"

    T0, T1 = B.curve.tangent(0.0), B.curve.tangent(L)
    ids = loft(part, rings, mat_of,
               cap0={"p": B.curve.at(0.0) - T0 * 0.02, "b": -0.05},
               cap1={"p": B.curve.at(L) + T1 * 0.03, "b": b + 0.02})
    # Zusätzliche Schnitte, damit die Textur-Inseln nicht zu lang werden
    # (nicht am Kopf: dort würde man die Naht sehen)
    for ycut in (-8.5, -4.6, 3.5):
        i = int(np.argmin([abs(r["y"] - ycut) for r in rings]))
        seam_ring(part, ids[i])
    return part


def build_jaw(B, J):
    part = Part("Unterkiefer", "jaw")
    ys = list(np.arange(JAW_ST[0][0], JAW_ST[-1][0], 0.05)) + [JAW_ST[-1][0]]
    rings, b = [], 0.0
    for i, y in enumerate(ys):
        c, T, Sd, U, rx, rt, rb = J.ring(y)
        if i > 0:
            b += (y - ys[i - 1]) / max(math.pi * (rx + 0.5 * (rt + rb)), 0.12)
        pts = np.array([J.point(y, TAU * k / R_JAW) for k in range(R_JAW)])
        t = smooth(7.05, 7.45, y)
        rings.append({"pts": pts, "w": {"jaw": t, "head": 1 - t}, "b": b, "inf": (y, 1.0)})

    def mat_of(i, k):
        kk = min(k, R_JAW - 1 - k)
        if kk < JAW_BELLY_COLS or kk >= JAW_MOUTH_COL:
            return "Bauch"          # Kehle unten bzw. Maul-Innenseite oben
        return "Haut"

    c0, T0, *_ = J.ring(ys[0])
    c1, T1, *_ = J.ring(ys[-1])
    loft(part, rings, mat_of, cap0={"p": c0 - T0 * 0.03, "b": -0.03}, cap1={"p": c1 + T1 * 0.02, "b": b + 0.02})
    return part


def leg_curve():
    return Curve([LEG_H + vec3(-0.04, 0.02, 0.14), LEG_H, LEG_K, LEG_A, LEG_B, LEG_B + vec3(0.0, 0.09, -0.06)])


def build_leg_R():
    part = Part("Bein_R", "limb")
    cv = leg_curve()
    sj = [cv.s_near(p) for p in (LEG_H, LEG_K, LEG_A, LEG_B)]
    chain = Chain([("thigh_R", 0.0, sj[1]), ("shin_R", sj[1], sj[2]), ("foot_R", sj[2], sj[3]),
                   ("toes_R", sj[3], cv.length + 1.0)], blend=0.18)
    xs = [0.0, sj[0] + 0.1, sj[0] + 0.45 * (sj[1] - sj[0]), sj[1] - 0.12, sj[1], sj[1] + 0.3 * (sj[2] - sj[1]),
          sj[2] - 0.12, sj[2], 0.5 * (sj[2] + sj[3]), sj[3], cv.length]
    rs = [0.40, 0.47, 0.40, 0.27, 0.25, 0.235, 0.165, 0.15, 0.12, 0.13, 0.10]
    prof = Pchip(xs, rs)

    def weights(s, t):
        w = chain.weights(s)
        u = smooth(0.0, sj[0] + 0.35, s)
        return wmix((u, w), (1 - u, {"hips": 1.0}))

    tube(part, cv, prof, 24, vec3(0, 1, 0), weights, "Haut", flat=(0.92, 1.0), step=0.06, cap0=True, cap1=True)
    return part


def claw(part, base, d, length, r0, weights, side_axis=None):
    """Gebogene Kralle: zuerst nach vorne, dann nach unten gekrümmt."""
    p0 = base - d * 0.03
    p1 = p0 + d * length * 0.6 + vec3(0, 0, 0.03)
    p2 = p0 + d * length + vec3(0, 0, -0.35 * length)
    cv = Curve(bezier(p0, p1, p2, 16), smooth=False, n=2)
    tube(part, cv, lambda s: r0 * (1 - s / cv.length) ** 0.9 + 0.003, 8, vec3(0, 0, 1),
         lambda s, t: weights, "Kralle", flat=(0.62, 1.0), n_rings=9)


def build_toes_R():
    toes, claws = Part("Zehen_R", "limb"), Part("Krallen_Fuss_R", "claw")
    base = LEG_B + vec3(0.0, 0.02, -0.03)
    for i, a in enumerate((-0.42, 0.0, 0.42)):
        d = nrm(rotz(vec3(0.05, 1.0, 0.0), a))
        L = 0.62 if i == 1 else 0.52
        pts = [base, base + d * L * 0.45 + vec3(0, 0, -0.07), base + d * L + vec3(0, 0, -0.10)]
        cv = Curve(pts)
        tube(toes, cv, Pchip([0, cv.length * 0.5, cv.length], [0.085, 0.062, 0.045]), 12, vec3(0, 0, 1),
             lambda s, t: wmix((smooth(0, 0.15, s), {"toes_R": 1.0}), (1 - smooth(0, 0.15, s), {"foot_R": 1.0})),
             "Haut", flat=(1.0, 0.8), step=0.05, cap1=True)
        claw(claws, pts[-1], d, 0.28, 0.045, {"toes_R": 1.0})
    dh = nrm(vec3(-0.3, -1.0, 0.0))        # hintere Zehe (Afterkralle)
    pts = [base + vec3(0, -0.05, 0.05), base + dh * 0.2 + vec3(0, 0, -0.08), base + dh * 0.32 + vec3(0, 0, -0.12)]
    cv = Curve(pts)
    tube(toes, cv, Pchip([0, cv.length], [0.07, 0.045]), 12, vec3(0, 0, 1), lambda s, t: {"foot_R": 1.0},
         "Haut", step=0.05, cap1=True)
    claw(claws, pts[-1], dh, 0.22, 0.04, {"foot_R": 1.0})
    return toes, claws


def wing_points():
    """Gelenke des rechten Flügels (gespreizt, leicht V-förmig nach oben)."""
    S = WING_S
    a1 = -0.22
    a2 = a1 + 0.38
    E2 = S[:2] + 2.94 * np.array([math.cos(a1), -math.sin(a1)])
    W2 = E2 + 3.64 * np.array([math.cos(a2), -math.sin(a2)])
    F2 = [W2 + L * np.array([math.cos(a2 + da), -math.sin(a2 + da)]) for da, L in zip(FINGER_ANG, FINGER_LEN)]

    def lift(p2):
        dx = p2[0] - S[0]
        return vec3(S[0] + dx * math.cos(DIHEDRAL), p2[1], S[2] + dx * math.sin(DIHEDRAL))

    W = lift(W2)
    return {"S": S, "E": lift(E2), "W": W, "F": [lift(f) for f in F2],
            "thumb": nrm(vec3(-0.3, 1.0, 0.25)), "hand_dir": nrm(lift(F2[1]) - W)}


def finger_weights(k, t):
    """Gewichte entlang Finger k (1..4) bei t = 0 (Handgelenk) .. 1 (Spitze)."""
    f1, f2 = f"finger{k}_1_R", f"finger{k}_2_R"
    if t < 0.1:
        u = smooth(0.02, 0.1, t)
        return {"hand_R": 1 - u, f1: u}
    if t < 0.42:
        return {f1: 1.0}
    if t < 0.58:
        u = smooth(0.42, 0.58, t)
        return {f1: 1 - u, f2: u}
    return {f2: 1.0}


def build_arm_R(wp):
    arm, fingers, claws = Part("Arm_R", "limb"), Part("Finger_R", "limb"), Part("Krallen_Hand_R", "claw")
    S, E, W = wp["S"], wp["E"], wp["W"]
    cv = Curve([S + vec3(-0.35, 0.0, -0.08), S, E, W, W + nrm(W - E) * 0.12])
    sS, sE, sW = cv.s_near(S), cv.s_near(E), cv.s_near(W)
    prof = Pchip([0, sS, sS + 0.35 * (sE - sS), sE - 0.2, sE, sE + 0.3, sW - 0.25, sW, cv.length],
                 [0.30, 0.29, 0.20, 0.17, 0.20, 0.16, 0.12, 0.135, 0.09])
    chain = Chain([("upperarm_R", 0.0, sE), ("forearm_R", sE, sW), ("hand_R", sW, cv.length + 1)], blend=0.2)

    def weights(s, t):
        u = smooth(0.1, sS + 0.35, s)
        return wmix((u, chain.weights(s)), (1 - u, {"chest": 1.0}))

    tube(arm, cv, prof, 20, vec3(0, 0, 1), weights, "Haut", step=0.07, cap0=True, cap1=True)
    for k, F in enumerate(wp["F"], start=1):
        d = nrm(F - W)
        fc = Curve([W - d * 0.08, F + d * 0.06], smooth=False, n=40)
        L = fc.length
        prof_f = Pchip([0, 0.15 * L, 0.6 * L, 0.95 * L, L], [0.095, 0.075, 0.045, 0.022, 0.012])
        tube(fingers, fc, prof_f, 12, vec3(0, 0, 1),
             lambda s, t, k=k, L=L: finger_weights(k, (s - 0.08) / (L - 0.14)), "Haut", step=0.12, cap1=True)
    # Daumen mit Kralle (zeigt nach vorne)
    td = wp["thumb"]
    tc = Curve([W, W + td * 0.18, W + td * 0.34])
    tube(fingers, tc, Pchip([0, tc.length], [0.085, 0.055]), 12, vec3(0, 0, 1), lambda s, t: {"thumb_R": 1.0},
         "Haut", step=0.05, cap1=True)
    claw(claws, W + td * 0.34, nrm(td + vec3(0, 0.3, 0)), 0.42, 0.055, {"thumb_R": 1.0})
    return arm, fingers, claws


def build_membrane_R(B, chain, wp):
    """Flughaut: innere Fläche (Körper–Arm–4. Finger) als Coons-Fläche, dazu 3 Felder zwischen den Fingern."""
    part = Part("Flughaut_R", "membrane", atlas="B")
    S, E, W, F = wp["S"], wp["E"], wp["W"], wp["F"]
    NT, NW, NU = 18, 9, 22
    y_S, y_B = S[1], MEMBRANE_Y_BODY
    phi_att = math.pi / 2 + 0.5

    def attach(v):
        return B.point(B.s_of_y(y_S + (y_B - y_S) * v), phi_att)

    def body_w(v):
        return chain.weights(B.s_of_y(y_S + (y_B - y_S) * v))

    Bp, F4 = attach(1.0), F[3]
    arm = Curve([attach(0.0), E, W])
    uE = arm.s_near(E) / arm.length
    M = (S + E + W) / 3.0

    def c0(u):
        return arm.at(u * arm.length)

    def c1(u):
        p = Bp + (F4 - Bp) * u
        return p + nrm(M - p) * 0.10 * np.linalg.norm(F4 - Bp) * math.sin(math.pi * u)

    def d0(v):
        return attach(v)

    def d1(v):
        return W + (F4 - W) * v

    def wa(u):          # Gewichte entlang der Vorderkante (Arm)
        if u < uE - 0.08:
            t = smooth(0.0, 0.25, u)
            return {"chest": 1 - t, "upperarm_R": t}
        if u < uE + 0.08:
            t = smooth(uE - 0.08, uE + 0.08, u)
            return {"upperarm_R": 1 - t, "forearm_R": t}
        t = smooth(0.9, 1.0, u)
        return {"forearm_R": 1 - t, "hand_R": t}

    keys = {}

    def V(p, w, uv_pat, inf):
        key = tuple(np.round(p, 5))
        if key not in keys:
            keys[key] = (part.vert(p, w), uv_pat, inf)
        return keys[key]

    def add_face(vs):
        pts = [part.v[x[0]] for x in vs]
        n = np.cross(pts[1] - pts[0], pts[-1] - pts[0])
        if n[2] < 0:
            vs = vs[::-1]
        uvs = [((part.v[x[0]][0] - MEM_UV[0]) / MEM_UV[2], (part.v[x[0]][1] - MEM_UV[1]) / MEM_UV[3]) for x in vs]
        part.face([x[0] for x in vs], "Flughaut", [x[1] for x in vs], [x[2] for x in vs], uvs)

    # --- innere Fläche (Coons-Patch) ---
    grid = {}
    for i in range(NT + 1):
        v = i / NT
        for j in range(NU + 1):
            u = j / NU
            if j == 0:
                p = d0(v)
            elif j == NU:
                p = d1(v)
            elif i == 0:
                p = c0(u)
            elif i == NT:
                p = c1(u)
            else:
                p = ((1 - v) * c0(u) + v * c1(u) + (1 - u) * d0(v) + u * d1(v)
                     - ((1 - u) * (1 - v) * c0(0) + u * (1 - v) * c0(1) + (1 - u) * v * c1(0) + u * v * c1(1)))
                p = p + vec3(0, 0, 0.16 * math.sin(math.pi * u) * math.sin(math.pi * v))   # leicht gewölbt
            w = wmix((1 - v, wa(u)), (v, wmix((1 - u, body_w(1.0)), (u, finger_weights(4, 1.0)))),
                     (1 - u, body_w(v)), (u, finger_weights(4, v)),
                     (-(1 - u) * (1 - v), wa(0.0)), (-u * (1 - v), wa(1.0)),
                     (-(1 - u) * v, body_w(1.0)), (-u * v, finger_weights(4, 1.0)))
            grid[i, j] = V(p, w, (p[0], p[1]), (0.0, v))
    for i in range(NT):
        for j in range(NU):
            add_face([grid[i, j], grid[i, j + 1], grid[i + 1, j + 1], grid[i + 1, j]])
    # --- Felder zwischen den Fingern (Fächer vom Handgelenk aus) ---
    for k in range(3):
        Fa, Fb = F[k], F[k + 1]
        chord = np.linalg.norm(Fa - Fb)
        gw = {}
        for i in range(1, NT + 1):
            t = i / NT
            for j in range(NW + 1):
                w_ = j / NW
                if j == 0:
                    p = W + (Fa - W) * t
                elif j == NW:
                    p = W + (Fb - W) * t
                else:
                    e = Fa + (Fb - Fa) * w_
                    p = (1 - w_) * (W + (Fa - W) * t) + w_ * (W + (Fb - W) * t)
                    p = p + t * 0.16 * chord * math.sin(math.pi * w_) * nrm(W - e)                  # gewellte Hinterkante
                    p = p + vec3(0, 0, 0.05 * chord * math.sin(math.pi * w_) * t ** 0.7 * (1 - 0.3 * t))
                wgt = wmix((1 - w_, finger_weights(k + 1, t)), (w_, finger_weights(k + 2, t)))
                gw[i, j] = V(p, wgt, (p[0], p[1]), (k + 1.0, t))
        cw = V(W, {"hand_R": 1.0}, (W[0], W[1]), (k + 1.0, 0.0))
        for j in range(NW):
            add_face([cw, gw[1, j], gw[1, j + 1]])
        for i in range(1, NT):
            for j in range(NW):
                add_face([gw[i, j], gw[i, j + 1], gw[i + 1, j + 1], gw[i + 1, j]])
    return part


def build_horns(B, J, chain):
    """Hörner, Stacheln am Kiefer, Rückenstacheln und die Stacheln an der Schwanzspitze."""
    part = Part("Hoerner", "horn")
    X = vec3(1, 0, 0)

    def horn(p0, p1, p2, r0, weights, R=10, n=10, flat=(1.0, 1.0), uref=vec3(0, 0, 1)):
        cv = Curve(bezier(p0, p1, p2, 20), smooth=False, n=2)
        tube(part, cv, lambda s: r0 * (1 - s / cv.length) ** 1.1 + 0.004, R, uref, lambda s, t: weights,
             "Horn", flat=flat, n_rings=n, cap0=True)

    for side in (1, -1):
        def ph(p):
            return p if side > 0 else TAU - p
        out = X * side

        def at(y, p):
            s = B.s_of_y(y)
            T, Sd, U = B.frame(s)
            return B.point(s, ph(p)), T, U
        # grosse Hörner am Hinterkopf, weit nach hinten geschwungen
        base, T, U = at(7.15, math.pi - 0.42)
        horn(base - U * 0.16 + T * 0.06, base - T * 0.75 + U * 0.45 + out * 0.2, base - T * 2.0 + U * 0.35 + out * 0.42,
             0.14, {"head": 1.0}, R=12, n=14)
        # zweites Paar, seitlich nach hinten
        base, T, U = at(7.3, math.pi / 2 + 0.75)
        horn(base - out * 0.1 + T * 0.04, base - T * 0.5 + out * 0.3 + U * 0.1, base - T * 1.25 + out * 0.55 - U * 0.05,
             0.09, {"head": 1.0})
        # Wangenstacheln
        base, T, U = at(7.35, math.pi / 2 + 0.05)
        horn(base - out * 0.04, base - T * 0.3 + out * 0.15, base - T * 0.6 + out * 0.25 - U * 0.12,
             0.055, {"head": 1.0}, R=8, n=7)
        # kleine Stacheln über den Augen (flach nach hinten)
        for y, L in ((7.75, 0.14), (8.05, 0.1)):
            base, T, U = at(y, math.pi - 0.95)
            horn(base - U * 0.03, base - T * L * 0.6 + U * L * 0.22 + out * L * 0.1, base - T * L + U * L * 0.2,
                 0.026, {"head": 1.0}, R=6, n=4)
        # Stacheln am Unterkiefer
        for y, L in ((7.35, 0.36), (7.7, 0.32), (8.05, 0.26)):
            c, T, Sd, U, rx, rt, rb = J.ring(y)
            base = J.point(y, ph(math.pi / 2 - 0.5))
            d = nrm(-T + out * 0.5 - U * 0.35)
            horn(base - d * 0.04, base + d * L * 0.5, base + d * L - U * 0.04, 0.035, {"jaw": 1.0}, R=6, n=5)
    # Rückenstacheln (flach wie Flossen), nicht im Sattel-Bereich
    y = 6.45
    while y > -12.55:
        s = B.s_of_y(y)
        rx, rt, rb, _ = B.params(y)
        h = 0.06 + 0.38 * rt
        if not (SADDLE[0] < y < SADDLE[1]):
            T, Sd, U = B.frame(s)
            top = B.point(s, math.pi)
            d = nrm(U * math.cos(0.85) - T * math.sin(0.85))
            horn(top - U * 0.3 * h, top + d * h * 0.5, top + d * h - T * 0.12 * h, 0.34 * h,
                 chain.weights(s), R=8, n=6, flat=(1.0, 0.33), uref=X)
        y -= max(0.24, 0.9 * h + 0.1)
    # Büschel an der Schwanzspitze
    for (ax, az, L) in ((0.0, 0.5, 0.5), (0.55, 0.15, 0.45), (-0.55, 0.15, 0.45), (0.3, -0.35, 0.38), (-0.3, -0.35, 0.38)):
        s = B.s_of_y(-12.7)
        T, Sd, U = B.frame(s)
        base = B.curve.at(s)
        d = nrm(-T + Sd * ax + U * az)
        horn(base, base + d * L * 0.5, base + d * L - T * 0.08, 0.05, {"tail_08": 1.0}, R=6, n=5)
    return part


def build_teeth(B, J):
    part = Part("Zaehne", "tooth")

    def tooth(p0, d, L, r0, weights, bend):
        cv = Curve(bezier(p0 - d * 0.035, p0 + d * L * 0.5, p0 + d * L + bend, 10), smooth=False, n=2)
        tube(part, cv, lambda s: r0 * (1 - s / cv.length) ** 1.2 + 0.003, 6, vec3(0, 1, 0),
             lambda s, t: weights, "Horn", n_rings=4)

    for side in (1, -1):
        def ph(p):
            return p if side > 0 else TAU - p
        for i, y in enumerate(np.linspace(8.05, 9.65, 12)):
            s = B.s_of_y(y)
            T, Sd, U = B.frame(s)
            base = B.point(s, ph(math.pi / 2 - 0.42))
            d = nrm(-U + vec3(side * 0.12, 0, 0) + T * 0.05)
            L = 0.17 if i == 9 else 0.10 + 0.02 * (i / 11)
            tooth(base, d, L, 0.03 if i != 9 else 0.036, {"head": 1.0}, -T * 0.015)
        for i, y in enumerate(np.linspace(8.12, 9.55, 11)):
            c, T, Sd, U, rx, rt, rb = J.ring(y)
            base = J.point(y, ph(math.pi / 2 + 0.55))
            d = nrm(U + vec3(side * 0.1, 0, 0))
            L = 0.14 if i == 9 else 0.08 + 0.015 * (i / 10)
            tooth(base, d, L, 0.026, {"jaw": 1.0}, -T * 0.012)
    return part


def build_eyes(B):
    part = Part("Augen", "eye")
    s = B.s_of_y(EYE_Y)
    C = B.curve.at(s)
    T, Sd, U = B.frame(s)
    for side in (1, -1):
        phi = EYE_PHI if side > 0 else TAU - EYE_PHI
        surf = B.point(s, phi)
        look = nrm(vec3(side, 0, 0) * 0.85 + T * 0.45 + U * 0.15)
        center = surf - nrm(surf - C) * 0.03
        r = 0.085
        e2 = nrm(np.cross(look, vec3(0, 0, 1)))
        e3 = np.cross(e2, look)
        nlat, nlon = 12, 16
        ids = {}
        for i in range(1, nlat):
            th = math.pi * i / nlat
            for j in range(nlon):
                ps = TAU * j / nlon
                ids[i, j] = part.vert(center + r * (math.cos(th) * look + math.sin(th) * (math.cos(ps) * e2 + math.sin(ps) * e3)),
                                      {"head": 1.0})
        front, back = part.vert(center + r * look, {"head": 1.0}), part.vert(center - r * look, {"head": 1.0})

        def pat(i, j):
            th, ps = math.pi * i / nlat, TAU * j / nlon
            return (math.sin(th) * math.cos(ps), math.sin(th) * math.sin(ps)), (math.cos(th), 0.0)

        def face(vs, ij):
            p = [part.v[x] for x in vs]
            n = np.cross(p[1] - p[0], p[-1] - p[0])
            if np.dot(n, p[0] - center) < 0:
                vs, ij = vs[::-1], ij[::-1]
            part.face(vs, "Auge", [pat(*x)[0] for x in ij], [pat(*x)[1] for x in ij])

        for j in range(nlon):
            j1 = (j + 1) % nlon
            face([front, ids[1, j], ids[1, j1]], [(0, j), (1, j), (1, j + 1)])
            face([back, ids[nlat - 1, j1], ids[nlat - 1, j]], [(nlat, j), (nlat - 1, j + 1), (nlat - 1, j)])
            for i in range(1, nlat - 1):
                face([ids[i, j], ids[i, j1], ids[i + 1, j1], ids[i + 1, j]], [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)])
            part.seam(ids[1, 0], front)
        for i in range(1, nlat - 1):
            part.seam(ids[i, 0], ids[i + 1, 0])
        part.seam(ids[nlat - 1, 0], back)
    return part


# =====================================================================
# 6. Skelett (Knochen)
# =====================================================================
def bone_list(B, J, wp):
    """(Name, Kopf, Ende, Eltern, Roll-Richtung) – alle Knochen verformen die Haut."""
    bones = []
    Z = (0, 0, 1)
    for name, y0, y1, parent in SPINE:
        bones.append((name, B.curve.at(B.s_of_y(y0)), B.curve.at(B.s_of_y(y1)), parent, Z))
    s = B.s_of_y(JAW_HINGE_Y)
    T, Sd, U = B.frame(s)
    rx, rt, rb, _ = B.params(JAW_HINGE_Y)
    hinge = B.curve.at(s) - U * (rb - 0.02)
    c, T2, Sd2, U2, rxj, rtj, rbj = J.ring(9.72)
    bones.append(("jaw", hinge, c + U2 * rtj, "head", Z))
    toe_tip = LEG_B + vec3(0.0, 0.02, -0.03) + nrm(vec3(0.05, 1, 0)) * 0.62 + vec3(0, 0, -0.1)
    bones += [("thigh_R", LEG_H, LEG_K, "hips", (0, 1, 0)), ("shin_R", LEG_K, LEG_A, "thigh_R", (0, 1, 0)),
              ("foot_R", LEG_A, LEG_B, "shin_R", (0, 1, 0)), ("toes_R", LEG_B, toe_tip, "foot_R", Z)]
    S, E, W = wp["S"], wp["E"], wp["W"]
    bones += [("upperarm_R", S, E, "chest", Z), ("forearm_R", E, W, "upperarm_R", Z),
              ("hand_R", W, W + wp["hand_dir"] * 0.35, "forearm_R", Z),
              ("thumb_R", W, W + wp["thumb"] * 0.34, "hand_R", Z)]
    for k, F in enumerate(wp["F"], start=1):
        mid = W + (F - W) * 0.5
        bones += [(f"finger{k}_1_R", W, mid, "hand_R", Z), (f"finger{k}_2_R", mid, F, f"finger{k}_1_R", Z)]
    # linke Seite = gespiegelt
    out = []
    for name, h, t, parent, up in bones:
        out.append((name, np.asarray(h), np.asarray(t), parent, up))
        if name.endswith("_R"):
            m = np.array([-1.0, 1.0, 1.0])
            out.append((side_name(name), np.asarray(h) * m, np.asarray(t) * m, side_name(parent) if parent else None, up))
    return out


# =====================================================================
# 7. Blender: Objekte, Skelett, UVs, Texturen backen, Export
# =====================================================================
MAT_ORDER = ["Haut", "Bauch", "Flughaut", "Horn", "Kralle", "Auge"]
# Standardfarben = Hautfarbe "Grau" aus src/dragon/Customization.js (sRGB-Hex)
MAT_DEF = {
    "Haut": dict(color=0x6E665C, rough=0.62),
    "Bauch": dict(color=0x9C9080, rough=0.8),
    "Flughaut": dict(color=0x5E4C42, rough=0.85, double=True),
    "Horn": dict(color=0xB8AB92, rough=0.55),
    "Kralle": dict(color=0x1E1C1A, rough=0.4, metal=0.1),
    "Auge": dict(color=0x331800, rough=0.3, emit=0xFF9A22, emit_strength=2.2),
}


def srgb2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex2lin(h):
    return tuple(srgb2lin(((h >> s) & 255) / 255.0) for s in (16, 8, 0)) + (1.0,)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prefs = bpy.context.preferences
    prefs.filepaths.use_scripts_auto_execute = False       # Sicherheit: nie Skripte aus Dateien ausführen


def use_nodes(mat):
    try:
        mat.use_nodes = True
    except Exception:
        pass
    return mat


def to_object(part, mats):
    names = [m for m in MAT_ORDER if m in set(part.fm)]
    me = bpy.data.meshes.new(part.name)
    me.from_pydata([tuple(v) for v in part.v], [], [list(f) for f in part.f])
    me.update()
    if len(me.polygons) != len(part.f):
        raise RuntimeError(f"{part.name}: Flächen gingen verloren")
    for n in names:
        me.materials.append(mats[n])
    me.polygons.foreach_set("material_index", [names.index(m) for m in part.fm])
    me.polygons.foreach_set("use_smooth", [True] * len(part.f))
    uva, uvp, uvi = (me.uv_layers.new(name=n) for n in ("UVMap", "Pattern", "Info"))
    uvp.data.foreach_set("uv", np.array([c for fp in part.fpat for uv in fp for c in uv], dtype=np.float32))
    uvi.data.foreach_set("uv", np.array([c for fi in part.finf for uv in fi for c in uv], dtype=np.float32))
    if part.fuv[0] is not None:
        uva.data.foreach_set("uv", np.array([c for fu in part.fuv for uv in fu for c in uv], dtype=np.float32))
    me.uv_layers.active = uva
    uva.active_render = True
    ev = np.zeros(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    me.edges.foreach_set("use_seam", [(min(a, b), max(a, b)) in part.seams for a, b in ev])
    obj = bpy.data.objects.new(part.name, me)
    bpy.context.scene.collection.objects.link(obj)
    groups = {}
    for i, wd in enumerate(part.w):
        for bn, w in wd.items():
            if bn not in groups:
                groups[bn] = obj.vertex_groups.new(name=bn)
            groups[bn].add([i], w, "REPLACE")
    obj["kind"], obj["atlas"] = part.kind, part.atlas
    obj["final_mats"] = names
    return obj


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def unwrap_atlas(objs):
    select_only(objs)
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.001)
    bpy.ops.uv.average_islands_scale()
    kw = dict(rotate=True, margin=0.004)
    props = {p.identifier for p in bpy.ops.uv.pack_islands.get_rna_type().properties}
    if "shape_method" in props:
        kw["shape_method"] = "CONCAVE"
    bpy.ops.uv.pack_islands(**kw)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------- Shader-Knoten für die Muster (nur zum Backen) ----------
class NB:
    """Kleiner Helfer, um Shader-Knoten per Code zu bauen."""

    def __init__(self, mat):
        self.nt = use_nodes(mat).node_tree
        self.nt.nodes.clear()

    def new(self, typ, **props):
        n = self.nt.nodes.new(typ)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            sock.default_value = v

    def m(self, op, a, b=None, clamp=False):
        n = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.put(n.inputs[0], a)
        if b is not None:
            self.put(n.inputs[1], b)
        return n.outputs[0]

    def add(self, a, b):
        return self.m("ADD", a, b)

    def sub(self, a, b):
        return self.m("SUBTRACT", a, b)

    def mul(self, a, b):
        return self.m("MULTIPLY", a, b)

    def mix(self, a, b, t):
        return self.add(a, self.mul(self.sub(b, a), t))

    def ss(self, e0, e1, x):
        n = self.new("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.put(n.inputs[0], x)
        n.inputs[1].default_value, n.inputs[2].default_value = e0, e1
        n.inputs[3].default_value, n.inputs[4].default_value = 0.0, 1.0
        return n.outputs[0]

    def uv(self, name):
        return self.new("ShaderNodeUVMap", uv_map=name).outputs["UV"]

    def sep(self, v):
        n = self.new("ShaderNodeSeparateXYZ")
        self.nt.links.new(v, n.inputs[0])
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def comb(self, x, y, z=0.0):
        n = self.new("ShaderNodeCombineXYZ")
        self.put(n.inputs[0], x)
        self.put(n.inputs[1], y)
        self.put(n.inputs[2], z)
        return n.outputs[0]

    def sepc(self, c):
        n = self.new("ShaderNodeSeparateColor")
        self.nt.links.new(c, n.inputs[0])
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def voronoi(self, vec, feature="F1", rnd=0.9):
        n = self.new("ShaderNodeTexVoronoi", voronoi_dimensions="2D", feature=feature)
        self.nt.links.new(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Randomness"].default_value = rnd
        return n

    def noise(self, vec, scale=1.0, detail=2.0, dim="2D"):
        n = self.new("ShaderNodeTexNoise", noise_dimensions=dim)
        self.nt.links.new(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        return n.outputs["Fac"]


def pat_skin(nb, na, belly_edge, mouth="none", plate_k=0.55):
    """Schuppen (Voronoi-Zellen) auf Rücken und Seiten, quer liegende Platten am Bauch."""
    a, b, _ = nb.sep(nb.uv("Pattern"))
    iy, _, _ = nb.sep(nb.uv("Info"))
    d = nb.sub(0.5, nb.m("ABSOLUTE", nb.sub(a, 0.5)))    # 0 = Bauchnaht, 0.5 = Rückenmitte
    X, Y = nb.mul(a, na), nb.mul(b, na)
    vec = nb.comb(X, Y)
    vf, ve = nb.voronoi(vec, "F1"), nb.voronoi(vec, "DISTANCE_TO_EDGE")
    edge = ve.outputs["Distance"]
    rnd = nb.sepc(vf.outputs["Color"])[0]
    _, py, _ = nb.sep(vf.outputs["Position"])
    ly = nb.sub(Y, py)
    dome = nb.ss(0.0, 0.2, edge)
    hs = nb.mul(dome, nb.add(0.75, nb.mul(ly, -0.35)))       # Schuppe hebt sich nach hinten an
    sval = nb.add(0.84, nb.add(nb.mul(dome, 0.12), nb.mul(nb.sub(rnd, 0.5), 0.16)))
    pf = nb.m("FRACT", nb.mul(b, na * plate_k))
    pdome = nb.ss(0.0, 0.07, pf)
    hp = nb.mul(pdome, nb.add(0.6, nb.mul(pf, 0.4)))
    pval = nb.add(0.82, nb.mul(pdome, 0.14))
    belly = nb.ss(belly_edge, belly_edge - 0.012, d)
    val, h = nb.mix(sval, pval, belly), nb.mix(hs, hp, belly)
    groove = nb.ss(0.006, 0.0, nb.m("ABSOLUTE", nb.sub(d, belly_edge)))
    val = nb.mul(val, nb.sub(1.0, nb.mul(groove, 0.35)))
    h = nb.sub(h, nb.mul(groove, 0.6))
    dors = nb.ss(0.28, 0.5, d)
    val = nb.mul(val, nb.sub(1.0, nb.mul(dors, 0.2)))                 # Rücken etwas dunkler
    mott = nb.noise(nb.comb(nb.mul(a, 7.0), nb.mul(b, 2.2)), 1.0, 3.0)
    val = nb.mul(val, nb.add(0.86, nb.mul(mott, 0.28)))               # grosse Flecken
    r, g, bl = val, nb.mul(val, 0.985), nb.mul(val, 0.955)
    if mouth != "none":
        if mouth == "head":      # Gaumen = Bauch-Bereich am Oberkopf
            mm = nb.mul(nb.ss(HEAD_Y - 0.02, HEAD_Y + 0.02, iy), belly)
        else:                    # Unterkiefer: Innenseite oben
            mm = nb.ss(JAW_MOUTH_COL / R_JAW - 0.004, JAW_MOUTH_COL / R_JAW + 0.004, d)
        mn = nb.noise(nb.comb(nb.mul(a, 20.0), nb.mul(b, 8.0)), 1.0, 2.0)
        r = nb.mix(r, nb.add(0.5, nb.mul(mn, 0.1)), mm)
        g = nb.mix(g, 0.14, mm)
        bl = nb.mix(bl, 0.15, mm)
        h = nb.mix(h, nb.mul(mn, 0.3), mm)
    return r, g, bl, h


def pat_horn(nb, base_dark=0.3, tip_dark=0.42, rings=0.06, ring_amp=0.06):
    a, b, _ = nb.sep(nb.uv("Pattern"))
    t, L, _ = nb.sep(nb.uv("Info"))
    wob = nb.noise(nb.comb(nb.mul(a, 3.0), nb.mul(t, 3.0)), 1.0, 2.0)
    phase = nb.add(nb.mul(nb.mul(t, L), TAU / rings), nb.mul(wob, 3.0))
    ring = nb.add(0.5, nb.mul(nb.m("SINE", phase), 0.5))
    streak = nb.noise(nb.comb(nb.mul(a, 24.0), nb.mul(t, 2.0)), 1.0, 2.0)
    val = nb.sub(0.95, nb.mul(nb.sub(1.0, nb.ss(0.0, 0.15, t)), base_dark))
    val = nb.sub(val, nb.mul(nb.ss(0.55, 1.0, t), tip_dark))
    val = nb.add(val, nb.add(nb.mul(ring, ring_amp), nb.mul(nb.sub(streak, 0.5), 0.12)))
    h = nb.add(nb.mul(ring, 0.6), nb.mul(streak, 0.4))
    return val, nb.mul(val, 0.97), nb.mul(val, 0.9), h


def pat_tooth(nb):
    a, b, _ = nb.sep(nb.uv("Pattern"))
    t, _, _ = nb.sep(nb.uv("Info"))
    base = nb.sub(1.0, nb.ss(0.0, 0.4, t))
    val = nb.sub(1.0, nb.mul(base, 0.12))
    return val, nb.sub(val, nb.mul(base, 0.05)), nb.sub(val, nb.mul(base, 0.14)), nb.mul(t, 0.0)


def pat_eye(nb):
    u, v, _ = nb.sep(nb.uv("Pattern"))
    front, _, _ = nb.sep(nb.uv("Info"))
    half = nb.mul(nb.m("SQRT", nb.m("MAXIMUM", nb.sub(1.0, nb.mul(v, v)), 0.0)), 0.13)
    pupil = nb.mul(nb.ss(0.012, -0.012, nb.sub(nb.m("ABSOLUTE", u), half)), nb.ss(0.55, 0.7, front))
    fib = nb.noise(nb.comb(nb.mul(nb.m("ARCTAN2", v, u), 6.0), nb.mul(front, 4.0)), 1.0, 2.0)
    val = nb.add(0.82, nb.mul(fib, 0.18))
    val = nb.mul(val, nb.add(0.35, nb.mul(nb.ss(0.3, 0.6, front), 0.65)))   # dunkler Rand
    val = nb.mul(val, nb.sub(1.0, nb.mul(pupil, 0.97)))
    return val, val, val, nb.mul(pupil, 0.2)


def pat_membrane(nb):
    """Flughaut: feine Adern, die grob in Flugrichtung laufen, leichte Flecken."""
    x, y, _ = nb.sep(nb.uv("Pattern"))
    wob = nb.noise(nb.comb(nb.mul(x, 0.8), nb.mul(y, 0.8)), 1.0, 2.0)
    xb, yb = nb.add(x, nb.mul(wob, 0.5)), nb.add(y, nb.mul(wob, 0.5))
    big = nb.voronoi(nb.comb(nb.mul(xb, 1.1), nb.mul(yb, 0.33)), "DISTANCE_TO_EDGE", 1.0).outputs["Distance"]
    small = nb.voronoi(nb.comb(nb.mul(xb, 3.0), nb.mul(yb, 1.2)), "DISTANCE_TO_EDGE", 1.0).outputs["Distance"]
    vb, vs = nb.ss(0.022, 0.0, big), nb.ss(0.016, 0.0, small)
    n2 = nb.noise(nb.comb(nb.mul(x, 3.0), nb.mul(y, 3.0)), 1.0, 3.0)
    val = nb.sub(nb.sub(0.92, nb.mul(vb, 0.16)), nb.mul(vs, 0.07))
    val = nb.add(val, nb.mul(nb.sub(n2, 0.5), 0.1))
    v = nb.add(vb, nb.mul(vs, 0.5))
    return (nb.add(val, nb.mul(v, 0.05)), nb.sub(val, nb.mul(v, 0.04)), nb.sub(val, nb.mul(v, 0.05)),
            nb.add(nb.mul(vb, 1.0), nb.mul(vs, 0.5)))


PATTERNS = {
    "body": (lambda nb: pat_skin(nb, 40.0, BELLY_COLS / R_BODY, "head"), 0.02),
    "jaw": (lambda nb: pat_skin(nb, 30.0, JAW_BELLY_COLS / R_JAW, "jaw"), 0.015),
    "limb": (lambda nb: pat_skin(nb, 26.0, 0.09), 0.015),
    "horn": (lambda nb: pat_horn(nb), 0.008),
    "claw": (lambda nb: pat_horn(nb, 0.0, 0.0, 0.03, 0.02), 0.004),
    "tooth": (lambda nb: pat_tooth(nb), 0.002),
    "eye": (lambda nb: pat_eye(nb), 0.002),
    "membrane": (lambda nb: pat_membrane(nb), 0.01),
}


def bake_material(kind, img_col, img_nrm):
    """Material nur zum Backen: Emission = Farbe, Diffus mit Beulen = Normal-Map."""
    mat = bpy.data.materials.new("bake_" + kind)
    nb = NB(mat)
    fn, dist = PATTERNS[kind]
    r, g, b, h = fn(nb)
    col = nb.new("ShaderNodeCombineColor")
    nb.put(col.inputs[0], r)
    nb.put(col.inputs[1], g)
    nb.put(col.inputs[2], b)
    emi = nb.new("ShaderNodeEmission")
    nb.put(emi.inputs["Color"], col.outputs[0])
    bump = nb.new("ShaderNodeBump")
    nb.put(bump.inputs["Height"], h)
    bump.inputs["Distance"].default_value = dist
    dif = nb.new("ShaderNodeBsdfDiffuse")
    nb.put(dif.inputs["Normal"], bump.outputs["Normal"])
    out = nb.new("ShaderNodeOutputMaterial")
    ic = nb.new("ShaderNodeTexImage", image=img_col)
    inn = nb.new("ShaderNodeTexImage", image=img_nrm)
    return mat, {"nb": nb, "emi": emi, "dif": dif, "out": out, "ic": ic, "in": inn}


def bake(objs, bake_mats, pass_type, samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    for mat, info in bake_mats.values():
        links = info["nb"].nt.links
        src = info["emi"] if pass_type == "EMIT" else info["dif"]
        links.new(src.outputs[0], info["out"].inputs["Surface"])
        info["nb"].nt.nodes.active = info["ic"] if pass_type == "EMIT" else info["in"]
    select_only(objs)
    if pass_type == "EMIT":
        bpy.ops.object.bake(type="EMIT", margin=8, use_clear=True)
    else:
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", margin=8, use_clear=True)


def new_image(name, w, h, non_color=False):
    img = bpy.data.images.new(name, w, h, alpha=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def gltf_material(name, img_col, img_nrm):
    """Endgültiges Material (Principled BSDF → glTF PBR): Textur × Farbe, Normal-Map, Rauheit."""
    cfg = MAT_DEF[name]
    mat = use_nodes(bpy.data.materials.new(name))
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img_col
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    a_in = next(s for s in mix.inputs if s.identifier == "A_Color")
    b_in = next(s for s in mix.inputs if s.identifier == "B_Color")
    res = next(s for s in mix.outputs if s.identifier == "Result_Color")
    nt.links.new(tex.outputs["Color"], a_in)
    b_in.default_value = hex2lin(cfg["color"])
    nt.links.new(res, bsdf.inputs["Base Color"])
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = img_nrm
    nt.links.new(uv.outputs["UV"], ntex.inputs["Vector"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.space, nmap.uv_map = "TANGENT", "UVMap"
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = cfg["rough"]
    bsdf.inputs["Metallic"].default_value = cfg.get("metal", 0.0)
    if "emit" in cfg:
        emix = nt.nodes.new("ShaderNodeMix")
        emix.data_type, emix.blend_type = "RGBA", "MULTIPLY"
        emix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], next(s for s in emix.inputs if s.identifier == "A_Color"))
        next(s for s in emix.inputs if s.identifier == "B_Color").default_value = hex2lin(cfg["emit"])
        nt.links.new(next(s for s in emix.outputs if s.identifier == "Result_Color"), bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = cfg["emit_strength"]
    mat.use_backface_culling = not cfg.get("double", False)
    return mat


def build_armature(bones):
    arm = bpy.data.armatures.new("Drache_Skelett")
    obj = bpy.data.objects.new("Drache_Skelett", arm)
    bpy.context.scene.collection.objects.link(obj)
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    for name, h, t, parent, up in bones:
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = Vector(h), Vector(t)
        eb.use_deform = True
        eb.align_roll(Vector(up))
    for name, h, t, parent, up in bones:
        if parent:
            arm.edit_bones[name].parent = arm.edit_bones[parent]
            arm.edit_bones[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def add_anchor(name, pos, arm, bone):
    """Hilfspunkt (leerer Knoten) im GLB, hängt an einem Knochen: z. B. Maul für den Feuerstrahl."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.empty_display_size = 0.2
    e.parent = arm
    e.parent_type = "BONE"
    e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(Vector(pos))
    return e


def to_gltf(p):
    """Blender (x, y, z) → glTF (x, z, -y)."""
    return [round(float(p[0]), 4), round(float(p[2]), 4), round(float(-p[1]), 4)]


def read_glb_json(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise RuntimeError("keine GLB-Datei")
    clen, ctype = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + clen].decode("utf-8"))


def export_kwargs(glb):
    want = dict(filepath=glb, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
                export_image_format="JPEG", export_image_quality=90, export_jpeg_quality=90,
                export_skins=True, export_def_bones=True, export_influence_nb=4,
                export_rest_position_armature=True, export_animations=False, export_morph=False,
                export_cameras=False, export_lights=False, export_extras=False, export_leaf_bone=False)
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    missing = sorted(k for k in want if k not in props)
    if missing:
        log("Hinweis: Export-Optionen gibt es nicht:", missing)
    return {k: v for k, v in want.items() if k in props}


def build(args):
    reset_scene()
    os.makedirs(args.work, exist_ok=True)
    B = BodyShape()
    J = JawShape(B)
    wp = wing_points()
    chain = body_chain(B)
    log("Form berechnen …")
    parts = [build_body(B, chain), build_jaw(B, J)]
    leg = build_leg_R()
    toes, claws_f = build_toes_R()
    arm, fingers, claws_h = build_arm_R(wp)
    mem = build_membrane_R(B, chain, wp)
    for p in (leg, toes, claws_f, arm, fingers, claws_h, mem):
        parts += [p, mirror_part(p, p.name[:-2] + "_L")]
    parts += [build_horns(B, J, chain), build_teeth(B, J), build_eyes(B)]
    for p in parts:
        log(f"  {p.name:18s} {len(p.v):6d} Punkte {p.ntris():6d} Dreiecke")
    log("Summe Dreiecke:", sum(p.ntris() for p in parts))

    # --- Bilder und Materialien ---
    res = args.tex
    imgs = {"A_col": new_image("drache_farbe", res, res), "A_nrm": new_image("drache_normal", res, res, True),
            "B_col": new_image("flughaut_farbe", res, res // 2),
            "B_nrm": new_image("flughaut_normal", res, res // 2, True)}
    final = {n: gltf_material(n, imgs["B_col" if n == "Flughaut" else "A_col"],
                              imgs["B_nrm" if n == "Flughaut" else "A_nrm"]) for n in MAT_ORDER}
    objs = [to_object(p, final) for p in parts]
    atlas_a = [o for o in objs if o["atlas"] == "A"]
    log("UVs auffalten und packen …")
    unwrap_atlas(atlas_a)

    # --- Texturen backen ---
    if not args.no_bake:
        bmats = {}
        for o in objs:
            kind = o["kind"]
            if kind not in bmats:
                A = o["atlas"] == "A"
                bmats[kind] = bake_material(kind, imgs["A_col" if A else "B_col"], imgs["A_nrm" if A else "B_nrm"])
            for i in range(len(o.data.materials)):
                o.data.materials[i] = bmats[kind][0]
        mem_r = [o for o in objs if o.name == "Flughaut_R"]
        groups = [("A", atlas_a, {k: v for k, v in bmats.items() if k != "membrane"}),
                  ("B", mem_r, {"membrane": bmats["membrane"]})]
        for tag, group, bm in groups:
            log(f"Backen Atlas {tag}: Farbe …")
            bake(group, bm, "EMIT", 4)
            log(f"Backen Atlas {tag}: Normal-Map …")
            bake(group, bm, "NORMAL", 8)
        for o in objs:
            for i, n in enumerate(o["final_mats"]):
                o.data.materials[i] = final[n]
        for img in imgs.values():
            img.filepath_raw = os.path.join(args.work, img.name + ".png")
            img.file_format = "PNG"
            img.save()
    else:
        for img in imgs.values():
            img.generated_color = (0.8, 0.8, 0.8, 1.0) if "farbe" in img.name else (0.5, 0.5, 1.0, 1.0)

    # --- alles zu EINEM Objekt verbinden, Hilfs-UVs entfernen ---
    for o in objs:
        for n in ("Pattern", "Info"):
            o.data.uv_layers.remove(o.data.uv_layers[n])
    body = objs[0]
    select_only(objs, body)
    bpy.ops.object.join()
    body.name = body.data.name = "Drache"
    for k in ("kind", "atlas", "final_mats"):
        if k in body:
            del body[k]

    # --- Skelett und Anker ---
    bones = bone_list(B, J, wp)
    arm_obj = build_armature(bones)
    # Das Mesh bleibt ohne Eltern-Objekt (glTF: gehäutetes Mesh soll an oberster Stelle stehen);
    # die Verbindung zum Skelett macht der Armature-Modifier.
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    s = B.s_of_y(9.6)
    T, Sd, U = B.frame(s)
    mouth = B.curve.at(B.s_of_y(9.85)) - U * 0.12 + T * 0.1
    nostril = B.point(B.s_of_y(9.55), math.pi) + U * 0.02
    saddle = B.point(B.s_of_y(2.7), math.pi) + vec3(0, 0, 0.05)
    anchors = [add_anchor("Anker_Maul", mouth, arm_obj, "head"),
               add_anchor("Anker_Nuestern", nostril, arm_obj, "head"),
               add_anchor("Anker_Sattel", saddle, arm_obj, "chest")]

    # --- Export ---
    glb = os.path.abspath(args.glb)
    os.makedirs(os.path.dirname(glb), exist_ok=True)
    select_only([arm_obj, body] + anchors, arm_obj)
    log("Export GLB …")
    bpy.ops.export_scene.gltf(**export_kwargs(glb))
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.work, "drache_bau.blend"))
    log("GLB geschrieben:", glb, f"{os.path.getsize(glb) / 1e6:.2f} MB")

    # --- Knochen-Infos als JSON ---
    if args.bones:
        write_bones_json(args.bones, glb, bones, body, anchors, {"mouth": mouth, "nostril": nostril, "saddle": saddle})
        log("Knochen-JSON geschrieben:", args.bones)


def write_bones_json(path, glb, bones, body, anchors, anchor_pos):
    gj = read_glb_json(glb)
    nodes = gj["nodes"]
    by_name = {n.get("name"): n for n in nodes}
    joints = [nodes[j]["name"] for j in gj["skins"][0]["joints"]]
    co = np.zeros(len(body.data.vertices) * 3)
    body.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    g = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
    out = {
        "beschreibung": "Knochen des Drachen 'dragon_scales.glb' in der Ruhepose. Alle Positionen in Metern, "
                        "glTF-Koordinaten: x = rechts, y = oben, z = hinten. Der Kopf zeigt nach -z.",
        "einheit": "Meter",
        "vorne": [0, 0, -1],
        "oben": [0, 1, 0],
        "rechts": [1, 0, 0],
        "ursprung": "Körpermitte (Knochen 'root'), wie beim bisherigen Drachen im Spiel-Code",
        "bounding_box": {"min": [round(float(v), 3) for v in g.min(axis=0)],
                         "max": [round(float(v), 3) for v in g.max(axis=0)]},
        "masse": {"laenge_m": round(float(g[:, 2].max() - g[:, 2].min()), 2),
                  "spannweite_m": round(float(g[:, 0].max() - g[:, 0].min()), 2),
                  "hoehe_m": round(float(g[:, 1].max() - g[:, 1].min()), 2),
                  "boden_y_im_stand": round(GROUND_Z, 3)},
        "kopf": {"schnauzenspitze": to_gltf(BodyShape().curve.at(BodyShape().curve.length)),
                 "knochen": "head", "unterkiefer": "jaw"},
        "anker": {a.name: {"knochen": a.parent_bone, "position": to_gltf(anchor_pos[k])}
                  for a, k in zip(anchors, ("mouth", "nostril", "saddle"))},
        "hinweis_drehungen": "Die Knochen haben in der Ruhepose eigene Drehungen (rest_rotation). "
                             "Zum Animieren immer relativ dazu drehen, z. B. "
                             "bone.quaternion.copy(rest).multiply(delta).",
        "knochen_anzahl": len(joints),
        "knochen": [],
    }
    info = {b[0]: b for b in bones}
    for name in joints:
        _, h, t, parent, _ = info[name]
        n = by_name.get(name, {})
        out["knochen"].append({
            "name": name, "eltern": parent,
            "kopf": to_gltf(h), "ende": to_gltf(t), "laenge": round(float(np.linalg.norm(np.asarray(t) - h)), 4),
            "rest_translation": [round(v, 5) for v in n.get("translation", [0, 0, 0])],
            "rest_rotation_xyzw": [round(v, 6) for v in n.get("rotation", [0, 0, 0, 1])],
        })
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")


# =====================================================================
# 8. Kontrolle: GLB wieder einlesen, zählen, Vorschaubilder rendern
# =====================================================================
def rotate_world(pb, axis, deg):
    """Knochen um eine Welt-Achse drehen (für Test-Posen)."""
    M = pb.bone.matrix_local.to_3x3()
    R = Matrix.Rotation(math.radians(deg), 3, Vector(axis))
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = (M.inverted() @ R @ M).to_quaternion() @ pb.rotation_quaternion


def check(args):
    reset_scene()
    glb = os.path.abspath(args.check)
    bpy.ops.import_scene.gltf(filepath=glb)
    # nur Meshes aus der GLB zählen (der Import legt zusätzlich eine "Icosphere" als Knochen-Anzeige an)
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    tris = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    gj = read_glb_json(glb)
    report = {
        "datei_mb": round(os.path.getsize(glb) / 1e6, 2),
        "meshes": [o.name for o in meshes],
        "dreiecke": tris,
        "punkte": sum(len(o.data.vertices) for o in meshes),
        "knochen": len(arms[0].data.bones) if arms else 0,
        "materialien": sorted({m.name for o in meshes for m in o.data.materials if m}),
        "bilder": [(i.name, list(i.size)) for i in bpy.data.images],
        "anker": [o.name for o in bpy.data.objects if o.type == "EMPTY"],
        "gltf_materialien": [{k: m.get(k) for k in ("name", "pbrMetallicRoughness", "emissiveFactor", "doubleSided",
                                                    "extensions")} for m in gj.get("materials", [])],
        "gltf_extensions": gj.get("extensionsUsed", []),
    }
    lo = np.array([min((o.matrix_world @ Vector(c))[i] for o in meshes for c in o.bound_box) for i in range(3)])
    hi = np.array([max((o.matrix_world @ Vector(c))[i] for o in meshes for c in o.bound_box) for i in range(3)])
    report["bbox_blender_min"], report["bbox_blender_max"] = lo.round(3).tolist(), hi.round(3).tolist()
    print(json.dumps(report, indent=1, ensure_ascii=False))
    os.makedirs(args.work, exist_ok=True)
    with open(os.path.join(args.work, "check.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)
    if args.no_render:
        return
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = args.samples
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    world = bpy.data.worlds.new("Himmel")
    sc.world = world
    wn = use_nodes(world).node_tree.nodes
    bg = next(n for n in wn if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.5, 0.6, 0.75, 1.0)
    bg.inputs["Strength"].default_value = 0.7
    sun = bpy.data.objects.new("Sonne", bpy.data.lights.new("Sonne", "SUN"))
    sun.data.energy = 3.5
    sun.data.angle = 0.08
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(sun)
    me = bpy.data.meshes.new("Boden")
    me.from_pydata([(-80, -80, GROUND_Z), (80, -80, GROUND_Z), (80, 80, GROUND_Z), (-80, 80, GROUND_Z)], [], [[0, 1, 2, 3]])
    ground = bpy.data.objects.new("Boden", me)
    gm = use_nodes(bpy.data.materials.new("Boden"))
    gp = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gp.inputs["Base Color"].default_value = (0.25, 0.27, 0.22, 1.0)
    me.materials.append(gm)
    sc.collection.objects.link(ground)
    cam = bpy.data.objects.new("Kamera", bpy.data.cameras.new("Kamera"))
    sc.collection.objects.link(cam)
    sc.camera = cam

    def shot(name, loc, target, lens=35.0):
        cam.location = Vector(loc)
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens
        sc.render.filepath = os.path.join(args.work, name + ".png")
        bpy.ops.render.render(write_still=True)
        log("Bild:", sc.render.filepath)

    views = {
        "vorschau_schraeg": ((-21, 17, 11), (0, 0, 0), 30),
        "vorschau_seite": ((34, 0.5, 2), (0, -1.5, 0), 32),
        "vorschau_oben": ((0, -0.5, 42), (0, -0.5, 0), 30),
        "vorschau_vorne": ((0, 32, 4), (0, 0, 0.5), 32),
        "vorschau_kopf": ((3.8, 12.5, 2.6), (0, 8.4, 1.2), 45),
    }
    only = set(args.views.split(",")) if args.views else None
    for name, (loc, tgt, lens) in views.items():
        if only is None or name in only:
            shot(name, loc, tgt, lens)
    if only is None or "pose" in only:
        arm = arms[0]
        pbs = arm.pose.bones
        for side, sgn in (("R", -1), ("L", 1)):
            rotate_world(pbs[f"upperarm_{side}"], (0, 1, 0), 35 * sgn)
            rotate_world(pbs[f"forearm_{side}"], (0, 1, 0), -25 * sgn)
            rotate_world(pbs[f"thigh_{side}"], (1, 0, 0), -50)
            rotate_world(pbs[f"shin_{side}"], (1, 0, 0), 60)
        rotate_world(pbs["jaw"], (1, 0, 0), -28)
        rotate_world(pbs["neck_03"], (0, 0, 1), 20)
        rotate_world(pbs["neck_04"], (0, 0, 1), 15)
        rotate_world(pbs["tail_03"], (0, 0, 1), 18)
        rotate_world(pbs["tail_05"], (0, 0, 1), 18)
        bpy.context.view_layer.update()
        shot("vorschau_pose", (-21, 17, 11), (0, 0, 0.5), 30)
        shot("vorschau_pose_kopf", (4.5, 12.0, 2.2), (0, 8.2, 1.0), 40)
        shot("vorschau_pose_vorne", (0, 32, 4), (0, 0, 1.0), 32)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description="Drachen-Modell bauen bzw. prüfen")
    ap.add_argument("--work", required=True, help="Arbeitsordner (ausserhalb des Repos)")
    ap.add_argument("--glb", help="Ziel-Datei .glb")
    ap.add_argument("--bones", help="Ziel-Datei für die Knochen-JSON")
    ap.add_argument("--tex", type=int, default=2048, help="Texturgrösse (Standard 2048)")
    ap.add_argument("--no-bake", action="store_true", help="ohne Texturen (schneller Test)")
    ap.add_argument("--save-blend", action="store_true", help="Zwischenstand als .blend im Arbeitsordner speichern")
    ap.add_argument("--check", help="GLB einlesen und prüfen (statt bauen)")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--views", default="", help="nur diese Ansichten rendern (Komma-Liste)")
    args = ap.parse_args(argv)
    if args.check:
        check(args)
    else:
        if not args.glb:
            ap.error("--glb fehlt")
        build(args)


if __name__ == "__main__":
    main()
