# DragonTwin – Hinweise für Claude

## Wer arbeitet hier?

- Andrej, ICT-Fachmann in Ausbildung (1. Lehrjahr). Antworten auf **Deutsch (Schweiz: „ss“ statt „ß“)**.
- Legasthenie, ADHS, Dyskalkulie → **einfache Sprache, kurze Absätze, Stichpunkte, Schritt für Schritt**.
- Kritisch und sachlich auf Fehler hinweisen, nichts beschönigen.

## Projekt

- Drachen-Flugspiel im Browser: **Three.js + Vite**. Starten: `npm install`, dann `npm run dev`
  (http://localhost:5173). Prüfen: `npm run build`.
- Wichtige Ordner: `src/dragon/` (Drache, Feuer, Flugphysik), `src/core/` (Spiel, Kamera, Ton),
  `src/fx/` (Effekte), `src/gameplay/` (Rennen, Brände, Armbrust-Türme), `src/world/` (Welt).
- Der Drache ist `public/models/dragon_scales.glb`. Er wird von `tools/build_dragon.py` gebaut
  (Blender als Python-Modul `bpy`). Bericht: `tools/dragon_scales_report.md`,
  Skelett-Daten: `tools/dragon_scales_bones.json`.

## Sicherheit (vom Nutzer so gewollt)

- Nichts Ausführbares aus dem Internet ausführen. Keine fremden Add-ons oder Pakete installieren,
  ohne vorher zu fragen.
- Fremde 3D-Modelle nur mit freier Lizenz (CC0 oder CC-BY). Quelle und Autor in
  `public/models/QUELLEN.md` eintragen. Downloads, die eine Anmeldung brauchen, nicht umgehen.
- Keine Dateien über 100 MB committen. Blender-Arbeitsdateien (`*.blend`, Test-Bilder) gehören nach
  `tools/arbeit/` – der Ordner wird von Git ignoriert.
- Bei Blender MCP: `execute_blender_code` führt beliebigen Python-Code aus → vor jedem Schritt kurz
  erklären, was der Code macht, und nur im Projektordner lesen/schreiben.

## Der Drache: was das Spiel vom GLB erwartet

Ein neues Modell muss diese Regeln einhalten, sonst funktioniert `src/dragon/Dragon.js` nicht:

- **Masse und Richtung:** Meter. Im GLB (glTF): +Y oben, der Kopf zeigt nach **−Z**, rechts ist +X.
  In Blender: +Y vorne, +Z oben. Ursprung = Körpermitte (Knochen `root`).
  Die Füsse stehen bei **y = −2.66** (glTF) → passt zu `STAND_HEIGHT = 2.62` in `Dragon.js`.
- **Skelett: genau diese 50 Knochen** (Namen und Eltern wie im heutigen GLB, alle verformend):
  `root chest neck_01 … neck_05 head jaw hips tail_01 … tail_08`,
  `upperarm_ forearm_ hand_ thumb_ finger1_1_ finger1_2_ … finger4_1_ finger4_2_` (+ `R`/`L`),
  `thigh_ shin_ foot_ toes_` (+ `R`/`L`).
  Am einfachsten: das heutige GLB importieren und sein Skelett `Drache_Skelett` unverändert übernehmen.
  Das Spiel dreht die Knochen relativ zur Ruhepose in Modell-Achsen → wichtig sind nur
  **Gelenk-Positionen, Namen und Eltern**, nicht die Knochen-Drehung (Roll).
- **Ruhepose:** Flügel gespreizt, Beine stehend, Maul zu, Hals in S-Form.
  Stehen die Flügel anders als heute, müssen `FOLD_UPPER`, `FOLD_FORE`, `FOLD_FINGERS`
  in `Dragon.js` angepasst werden (Flügel anlegen).
- **Anker** (leere Objekte, am Knochen hängend): `Anker_Maul` (an `head`, Feuer),
  `Anker_Nuestern` (an `head`, Rauch), `Anker_Sattel` (an `chest`, Reiter; dort keine Rückenstacheln).
- **Materialien, genau diese Namen:** `Haut`, `Bauch`, `Flughaut` (doppelseitig), `Horn` (auch die Zähne),
  `Stachel` (Rücken- und Schwanzstacheln), `Kralle`, `Auge` (Emission).
  Die Farb-Texturen sind **fast farblos**; die Farbe kommt aus der Materialfarbe
  (glTF `baseColorFactor`), weil der Spieler sie in `src/dragon/Customization.js` wählt.
- **Grenzen:** höchstens 80 000 Dreiecke, Texturen höchstens 2048 px, GLB unter 15 MB,
  höchstens 4 Knochen pro Punkt, keine Animationen. Das Mesh ist **kein Kind** des Skeletts
  (nur Armature-Modifier), sonst warnt das Prüfprogramm.
- **Prüfen:** Khronos glTF-Validator (0 Fehler). Im Spiel testen: Fliegen, Landen (Flügel anlegen),
  Feuer (F), Reiter-Sicht (C), Brüllen (Q).
- Neue Modelle zuerst als `public/models/dragon_scales_neu.glb` ablegen, nicht das alte überschreiben.

## Bekannte Fallen in Blender-Python

- Nach `mesh.uv_layers.new()` werden **ältere Verweise auf UV-Ebenen ungültig** → zufällige Abstürze.
  Immer neu per Name holen: `me.uv_layers["UVMap"]`.
- Automatische Gewichte: Knochen `jaw` dabei kurz auf `use_deform = False`, danach den Unterkiefer
  zu 100 % an `jaw` hängen (sonst zieht er die Schnauze mit).
- Basisfarbe als Image Texture → Mix (Multiply, Farbe B) → Base Color: so schreibt der
  glTF-Exporter einen `baseColorFactor`. Augen: Emission Strength > 1
  (→ `KHR_materials_emissive_strength`).
- Namen der glTF-Export-Optionen im Code prüfen (`bpy.ops.export_scene.gltf.get_rna_type().properties`),
  sie ändern sich zwischen Blender-Versionen.

## Git

- Commit-Nachrichten auf Deutsch. Keine Pull Requests ohne ausdrückliche Bitte.
