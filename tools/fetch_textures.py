#!/usr/bin/env python3
"""
Lädt die Foto-Texturen von Poly Haven (https://polyhaven.com) herunter
und bereitet sie für das Spiel vor.

Alle Texturen von Poly Haven stehen unter der Lizenz CC0:
frei nutzbar, auch kommerziell, ohne Namensnennung.

Was das Skript macht (pro Textur):
  1. Infos (Name, Autoren, echte Grösse in Metern) über die Poly-Haven-API holen
  2. Die 1k-Bilder herunterladen: Farbe, Normal-Map, ARM-Map, Höhe
  3. Zuschneiden / aufräumen, falls nötig (siehe "special")
  4. Verkleinern und als kleine JPG-Dateien speichern:
       <name>_diff.jpg  Farbe (sRGB)
       <name>_nor.jpg   Normal-Map (OpenGL-Format, grün = oben)
       <name>_arh.jpg   R = Umgebungsverdeckung (AO)
                        G = Rauheit (roughness)
                        B = Höhe (für weiche Übergänge im Terrain)
  5. textures.json (für das Spiel) und QUELLEN.md (Lizenz-Liste) schreiben

Benutzung (einmalig, die Dateien liegen danach schon im Projekt):
    pip install pillow
    python3 tools/fetch_textures.py
"""
import io
import json
import os
import sys
import urllib.request

try:
    from PIL import Image, ImageFilter, ImageStat
except ImportError:
    sys.exit('Bitte zuerst Pillow installieren:  pip install pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'textures')
API = 'https://api.polyhaven.com'
# Poly Haven bittet um einen eindeutigen User-Agent
HEADERS = {'User-Agent': 'DragonTwin-TestFlight-texture-fetch/1.0'}

# Schlüssel im Spiel → (Poly-Haven-Name, Kantenlänge in Pixeln, Sonderbehandlung, Verwendung)
TEXTURES = {
    'gras': ('grass_ground', 1024, None, 'Wiesen und Felder (Terrain)'),
    'fels': ('rock_face_03', 1024, None, 'Felshänge, Felsbrocken, Felsbogen, Steinkreis'),
    'sand': ('coast_sand_01', 1024, None, 'Strand und Ufer (Terrain)'),
    'schnee': ('snow_02', 1024, 'clean_dark', 'Schnee auf den Gipfeln (Terrain)'),
    'erde': ('forest_ground_04', 1024, None, 'Wege im Dorf (Terrain)'),
    'holz': ('weathered_planks', 512, None, 'Türen, Stände, Türme, Steg, Wrack, Fachwerk-Balken'),
    'stroh': ('reed_roof_04', 512, 'crop_ridge', 'Strohdächer und Heuballen'),
    'stein': ('castle_wall_slates', 512, None, 'Burg, Kirche, Kamine'),
    'putz': ('white_plaster_02', 512, None, 'Fachwerk-Füllung (Lehmputz)'),
    'schiefer': ('roof_slates_02', 512, None, 'Schiefer- und Ziegeldächer'),
}


def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()


def get_json(url):
    return json.loads(get(url))


def load_image(url, mode):
    return Image.open(io.BytesIO(get(url))).convert(mode)


# ---------- Sonderbehandlungen ----------

def make_tileable_v(img, blend):
    """Macht ein Bild oben/unten nahtlos: die letzten Zeilen werden in den Anfang überblendet."""
    w, h = img.size
    H = h - blend
    top = img.crop((0, blend, w, h))  # Hauptteil
    out = top.copy()
    # Die letzten "blend" Zeilen von out gehen weich in die ersten Zeilen des Originals über.
    for i in range(blend):
        t = (i + 1) / (blend + 1)
        a = top.crop((0, H - blend + i, w, H - blend + i + 1))
        b = img.crop((0, i, w, i + 1))
        out.paste(Image.blend(a, b, t), (0, H - blend + i))
    return out


def even_rows(img):
    """Gleicht die Helligkeit von oben nach unten aus (sonst sieht man beim Wiederholen Streifen)."""
    w, h = img.size
    rows = img.convert('L').resize((1, h), Image.BOX).filter(ImageFilter.GaussianBlur(h / 25))
    target = ImageStat.Stat(img.convert('L')).mean[0]
    out = img.copy()
    for y in range(h):
        gain = target / max(1, rows.getpixel((0, y)))
        row = img.crop((0, y, w, y + 1)).point(lambda v, g=gain: min(255, int(v * g)))
        out.paste(row, (0, y))
    return out


def crop_ridge(maps):
    """reed_roof_04 hat oben einen Dachfirst-Streifen → abschneiden und nahtlos machen."""
    res = {}
    for k, im in maps.items():
        w, h = im.size
        cut = int(h * 0.085)
        im = im.crop((0, cut, w, h))
        if k == 'diff':
            im = even_rows(im)
        res[k] = make_tileable_v(im, int(h * 0.15))
    return res


def clean_dark(maps):
    """snow_02 hat dunkle Zweige/Spuren. Die würden sich auf den Gipfeln sichtbar wiederholen
    → dunkle Stellen werden mit der mittleren Schneefarbe übermalt."""
    d = maps['diff']
    gray = d.convert('L')
    median = ImageStat.Stat(gray).median[0]
    # Maske: 255 wo es deutlich dunkler als der Durchschnitt ist
    mask = gray.point(lambda v: max(0, min(255, int((median * 0.94 - v) * 255 / (median * 0.12)))))
    mask = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(4))
    soft = d.filter(ImageFilter.GaussianBlur(24))
    mean = tuple(int(c) for c in ImageStat.Stat(d).mean)
    fill = Image.blend(soft, Image.new('RGB', d.size, mean), 0.75)
    maps['diff'] = Image.composite(fill, d, mask)
    # auch in der Normal-Map glätten, sonst bleiben "Rillen" sichtbar
    flat = Image.blend(maps['nor'].filter(ImageFilter.GaussianBlur(8)), Image.new('RGB', d.size, (128, 128, 255)), 0.7)
    maps['nor'] = Image.composite(flat, maps['nor'], mask)
    return maps


SPECIAL = {'crop_ridge': crop_ridge, 'clean_dark': clean_dark}


def process(key, asset, size, special):
    info = get_json(f'{API}/info/{asset}')
    files = get_json(f'{API}/files/{asset}')

    def url(kind):
        return files[kind]['1k']['jpg']['url']

    print(f'  {key:9s} ← {asset} …', flush=True)
    maps = {
        'diff': load_image(url('Diffuse'), 'RGB'),
        'nor': load_image(url('nor_gl'), 'RGB'),
        'arm': load_image(url('arm'), 'RGB'),
        'disp': load_image(url('Displacement'), 'L'),
    }
    dims = info.get('dimensions') or [2000, 2000]
    w0, h0 = maps['diff'].size
    if special:
        maps = SPECIAL[special](maps)
    # echte Grösse nach dem Zuschneiden (in Metern)
    w1, h1 = maps['diff'].size
    size_m = [round(dims[0] / 1000 * w1 / w0, 3), round(dims[1] / 1000 * h1 / h0, 3)]

    def small(im):
        return im.resize((size, size), Image.LANCZOS)

    diff = small(maps['diff'])
    nor = small(maps['nor'])
    ao, rough, _metal = small(maps['arm']).split()
    height = small(maps['disp'])
    arh = Image.merge('RGB', (ao, rough, height))

    diff.save(os.path.join(OUT, f'{key}_diff.jpg'), quality=84, optimize=True, progressive=True)
    nor.save(os.path.join(OUT, f'{key}_nor.jpg'), quality=90, optimize=True, progressive=True)
    arh.save(os.path.join(OUT, f'{key}_arh.jpg'), quality=84, optimize=True, progressive=True)

    return {
        'asset': asset,
        'title': info.get('name', asset),
        'authors': list((info.get('authors') or {}).keys()),
        'url': f'https://polyhaven.com/a/{asset}',
        'size_m': size_m,
        'px': size,
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    print('Lade Texturen von Poly Haven (CC0) …')
    manifest = {
        'source': 'Poly Haven – https://polyhaven.com',
        'license': 'CC0 1.0 (Public Domain)',
        'files': '<name>_diff.jpg = Farbe, <name>_nor.jpg = Normal-Map (OpenGL), <name>_arh.jpg = R: AO, G: Rauheit, B: Höhe',
        'textures': {},
    }
    for key, (asset, size, special, use) in TEXTURES.items():
        entry = process(key, asset, size, special)
        entry['use'] = use
        manifest['textures'][key] = entry
    with open(os.path.join(OUT, 'textures.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write('\n')

    lines = [
        '# Foto-Texturen – Quellen und Lizenz',
        '',
        'Alle Texturen stammen von **[Poly Haven](https://polyhaven.com)**.',
        'Lizenz: **CC0** (gemeinfrei). Man darf sie frei nutzen, verändern und weitergeben, auch ohne Namensnennung.',
        'Trotzdem ein Dankeschön an die Autorinnen und Autoren:',
        '',
        '| Datei | Textur | Autor/in | Echte Grösse | Verwendung |',
        '| --- | --- | --- | --- | --- |',
    ]
    for key, e in manifest['textures'].items():
        lines.append(
            f"| `{key}_*.jpg` | [{e['title']}]({e['url']}) | {', '.join(e['authors'])} | "
            f"{e['size_m'][0]:.2f} × {e['size_m'][1]:.2f} m | {e['use']} |"
        )
    lines += [
        '',
        'Die Bilder wurden mit `tools/fetch_textures.py` heruntergeladen, verkleinert und neu gepackt:',
        '',
        '- `*_diff.jpg`: Farbe',
        '- `*_nor.jpg`: Normal-Map im OpenGL-Format',
        '- `*_arh.jpg`: Rot = Umgebungsverdeckung (AO), Grün = Rauheit, Blau = Höhe',
        '',
        'Änderungen: `stroh` ohne Dachfirst-Streifen (oben abgeschnitten und nahtlos gemacht),',
        '`schnee` ohne dunkle Zweige (übermalt).',
        '',
    ]
    with open(os.path.join(OUT, 'QUELLEN.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
    print(f'Fertig: {len(TEXTURES)} Texturen, {total / 1e6:.1f} MB in public/textures/')


if __name__ == '__main__':
    main()
