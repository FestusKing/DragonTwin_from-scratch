# 3D-Modelle – Quellen und Lizenz

## `dragon_scales.glb` – der Drache

**Selbst erstellt für DragonTwin.** Das Modell wurde komplett per Skript in
Blender gebaut: `tools/build_dragon.py`.

- Es wurden **keine fremden Modelle, Texturen oder Bilder** verwendet.
- Form, Muskeln, Skelett und Texturen (Schuppen, Bauchplatten, Adern) entstehen
  nur aus Formeln im Skript.
- **Keine Namensnennung nötig.** Das Modell darf im Projekt frei benutzt und
  verändert werden. Wenn das Projekt eine eigene Lizenz bekommt, gilt diese
  auch für das Modell.

### Wichtig: Das ist NICHT der Drache aus dem Film „Sintel“

- Geplant war zuerst das Modell „Scales (adult dragon)“ aus dem Blender-Film
  *Sintel* (© Blender Foundation, CC-BY 4.0).
- Dieses Modell kann man auf studio.blender.org nur **mit Anmeldung / Abo**
  herunterladen. Darum wurde es **nicht** benutzt
  (Details: `tools/dragon_scales_report.md`).
- Der Dateiname `dragon_scales` blieb gleich, damit der Einbau ins Spiel wie
  geplant funktioniert. „Scales“ heisst auf Deutsch einfach „Schuppen“.
- Die Idee „Wyvern“ (Flügel = Arme, zwei Hinterbeine) und die ungefähre Grösse
  stammen vom bisherigen Drachen im Spiel-Code (`src/dragon/Dragon.js`, `Wing.js`).

### Werkzeuge

| Werkzeug | Wofür | Lizenz |
|---|---|---|
| Blender 5.0.1 als Python-Paket `bpy` (von PyPI, Blender Foundation) | Modell bauen, Texturen backen, GLB exportieren | GPL (gilt nur für das Programm, **nicht** für damit erstellte Dateien) |
| Khronos glTF-Validator 2.0.0-dev.3.10 (npm-Paket `gltf-validator`) | GLB-Datei prüfen | Apache-2.0 |

### Kurz-Steckbrief

- Format: glTF 2.0 binär (GLB), ca. 5,6 MB
- ca. 74 200 Dreiecke, 1 Mesh mit 6 Materialien, 50 Knochen (Skinning)
- Texturen: 2 × 2048 × 2048 (Haut: Farbe + Normal-Map), 2 × 2048 × 1024 (Flughaut)
- Meter, +Y oben, Kopf zeigt nach −Z (wie im Spiel)
- Neu bauen: siehe Kopf von `tools/build_dragon.py`
