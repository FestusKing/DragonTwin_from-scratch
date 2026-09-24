# Foto-Texturen – Quellen und Lizenz

Alle Texturen stammen von **[Poly Haven](https://polyhaven.com)**.
Lizenz: **CC0** (gemeinfrei). Man darf sie frei nutzen, verändern und weitergeben, auch ohne Namensnennung.
Trotzdem ein Dankeschön an die Autorinnen und Autoren:

| Datei | Textur | Autor/in | Echte Grösse | Verwendung |
| --- | --- | --- | --- | --- |
| `gras_*.jpg` | [Grass Ground](https://polyhaven.com/a/grass_ground) | Charlotte Baglioni | 2.51 × 2.51 m | Wiesen und Felder (Terrain) |
| `fels_*.jpg` | [Rock Face 03](https://polyhaven.com/a/rock_face_03) | Dario Barresi, Rico Cilliers | 2.70 × 2.70 m | Felshänge, Felsbrocken, Felsbogen, Steinkreis |
| `sand_*.jpg` | [Coast Sand 01](https://polyhaven.com/a/coast_sand_01) | Rob Tuytel | 15.00 × 15.00 m | Strand und Ufer (Terrain) |
| `schnee_*.jpg` | [Snow 02](https://polyhaven.com/a/snow_02) | Rob Tuytel | 2.00 × 2.00 m | Schnee auf den Gipfeln (Terrain) |
| `erde_*.jpg` | [Forest Ground 04](https://polyhaven.com/a/forest_ground_04) | Rob Tuytel, Rico Cilliers | 3.15 × 3.15 m | Wege im Dorf (Terrain) |
| `holz_*.jpg` | [Weathered Planks](https://polyhaven.com/a/weathered_planks) | Dario Barresi, Dimitrios Savva | 2.00 × 2.00 m | Türen, Stände, Türme, Steg, Wrack, Fachwerk-Balken |
| `stroh_*.jpg` | [Reed Roof 04](https://polyhaven.com/a/reed_roof_04) | Rob Tuytel | 2.50 × 1.91 m | Strohdächer und Heuballen |
| `stein_*.jpg` | [Castle Wall Slates](https://polyhaven.com/a/castle_wall_slates) | Rob Tuytel | 2.50 × 2.50 m | Burg, Kirche, Kamine |
| `putz_*.jpg` | [White Plaster 02](https://polyhaven.com/a/white_plaster_02) | Rob Tuytel | 1.00 × 1.00 m | Fachwerk-Füllung (Lehmputz) |
| `schiefer_*.jpg` | [Roof Slates 02](https://polyhaven.com/a/roof_slates_02) | Rob Tuytel | 3.00 × 3.00 m | Schiefer- und Ziegeldächer |

Die Bilder wurden mit `tools/fetch_textures.py` heruntergeladen, verkleinert und neu gepackt:

- `*_diff.jpg`: Farbe
- `*_nor.jpg`: Normal-Map im OpenGL-Format
- `*_arh.jpg`: Rot = Umgebungsverdeckung (AO), Grün = Rauheit, Blau = Höhe

Änderungen: `stroh` ohne Dachfirst-Streifen (oben abgeschnitten und nahtlos gemacht),
`schnee` ohne dunkle Zweige (übermalt).
