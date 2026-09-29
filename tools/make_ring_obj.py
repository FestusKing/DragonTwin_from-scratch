"""Erzeugt das Ring-Modell für das Ringrennen in s&box: sbox/Assets/models/ring.obj

Ein Torus (Donut): Ring-Radius 1, Rohr-Radius 0.06, die Öffnung zeigt entlang +X
(in s&box = vorne). RaceComponent.cs skaliert ihn auf den Radius der Strecke.
Ohne fremde Pakete: nur Python. Aufruf: python3 tools/make_ring_obj.py
"""
import math
import os

MAJOR = 1.0    # Ring-Radius
MINOR = 0.06   # Rohr-Radius (wie im Browser-Spiel: 0.85 m bei 14 m Ring)
SEG = 64       # Teile rund um den Ring
SIDES = 12     # Teile rund um das Rohr

out = os.path.join(os.path.dirname(__file__), '..', 'sbox', 'Assets', 'models', 'ring.obj')
os.makedirs(os.path.dirname(out), exist_ok=True)
lines = ['# Ring für das Ringrennen (DragonTwin, s&box). Erzeugt von tools/make_ring_obj.py',
         '# Achse = +X, Ring-Radius 1, Rohr-Radius 0.06', 'o Ring']
for i in range(SEG):
    a = 2 * math.pi * i / SEG
    ca, sa = math.cos(a), math.sin(a)
    for j in range(SIDES):
        b = 2 * math.pi * j / SIDES
        cb, sb = math.cos(b), math.sin(b)
        # Ring liegt in der Y-Z-Ebene, Rohr-Querschnitt in Richtung (radial, X)
        r = MAJOR + MINOR * cb
        lines.append(f'v {MINOR * sb:.6f} {r * ca:.6f} {r * sa:.6f}')
for i in range(SEG + 1):
    for j in range(SIDES + 1):
        lines.append(f'vt {i / SEG:.6f} {j / SIDES:.6f}')
for i in range(SEG):
    a = 2 * math.pi * i / SEG
    ca, sa = math.cos(a), math.sin(a)
    for j in range(SIDES):
        b = 2 * math.pi * j / SIDES
        cb, sb = math.cos(b), math.sin(b)
        lines.append(f'vn {sb:.6f} {cb * ca:.6f} {cb * sa:.6f}')


def v(i, j):
    return (i % SEG) * SIDES + (j % SIDES) + 1


def t(i, j):
    return i * (SIDES + 1) + j + 1


for i in range(SEG):
    for j in range(SIDES):
        a, b, c, d = v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)
        ta, tb, tc, td = t(i, j), t(i + 1, j), t(i + 1, j + 1), t(i, j + 1)
        lines.append(f'f {a}/{ta}/{a} {b}/{tb}/{b} {c}/{tc}/{c}')
        lines.append(f'f {a}/{ta}/{a} {c}/{tc}/{c} {d}/{td}/{d}')
with open(out, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(lines) + '\n')
print(f'{out}: {SEG * SIDES} Punkte, {SEG * SIDES * 2} Dreiecke')
