# Bericht: Drache „Scales“ für DragonTwin

**Ergebnis: ERLEDIGT – mit einem selbst gebauten Drachen.**

- Das Sintel-Modell „Scales (adult dragon)“ gibt es nur **mit Anmeldung / Abo**.
  Darum wurde es nicht heruntergeladen (Teil A).
- Stattdessen wurde ein **eigener Wyvern komplett per Skript in Blender gebaut**
  und als GLB exportiert (Teil B).
- Neue Dateien: `public/models/dragon_scales.glb`, `public/models/QUELLEN.md`,
  `tools/build_dragon.py`, `tools/dragon_scales_bones.json`, dieser Bericht.

Datum: 24.09.2026

---

## Teil A – Download des Sintel-Modells (abgebrochen)

| Versuch | Zeit (UTC) | Ergebnis |
|---|---|---|
| 1 | ca. 12:48 | Netzwerk-Filter sperrte alle `*.blender.org`-Adressen (Proxy-Antwort 403). |
| 2 | 12:51–12:53 | Seite erreichbar (HTTP 200), aber Knopf **„Login to Download“** bei v1 und v2 (gesperrt). |
| 3 | 13:09 | Gleich wie Versuch 2. |

- Geprüfte Seiten: `studio.blender.org/characters/5d403c21ee3219164b952e20/v2/` und `/v1/`,
  `studio.blender.org/projects/sintel/`, `studio.blender.org/join/`,
  `durian.blender.org/download/`, `download.blender.org/durian/`.
- Die Abo-Seite nennt „Full access to production assets“ nur bei bezahlten Abos
  (ab 11.50 $ pro Monat).
- Die offizielle Sintel-Download-Seite bietet nur Film, Trailer, Musik und
  Untertitel an, **keine Modelle**.
- Laut Regel 1 **nicht umgangen**: kein Konto, keine erratenen Download-Adressen,
  keine anderen Webseiten.
- Heruntergeladene Modell-Datei: **keine**. Darum gibt es keine SHA256, keine
  Dateityp-Prüfung und keine Liste von Text-Blöcken. Es wurde nie eine
  fremde `.blend`-Datei geöffnet.

---

## Teil B – eigener Drache per Skript

### Was gebaut wurde

Ein **Wyvern** wie Scales: Die Flügel sind die Arme, dazu zwei Hinterbeine.
Die Masse stammen vom bisherigen Drachen im Spiel-Code (ca. 23 m lang, 25 m Spannweite).

**Version 3** (aktuell) – weil der Drache „noch nicht so gut aussah“:

- **Eine Haut statt einzelner Röhren:** Rumpf, Kopf, Beine, Arme und Muskeln
  (Brust, Schultern, Schulterblätter, Oberschenkel, Brauen, Wangen, Kaumuskeln,
  Nüstern) werden in Blender mit *Voxel-Remesh* zu einer geschlossenen Haut
  verschmolzen und geglättet. Keine Nähte mehr zwischen Körper und Beinen/Armen.
- **Kräftiger:** dickerer Rumpf mit tiefer Brust, dickerer Hals und Schwanzansatz,
  stärkere Arme und Beine.
- **Kopf:** kürzer und höher (weniger „Krokodil“), tieferer Unterkiefer,
  sichtbare Brauenwülste, mandelförmige Augen unter den Brauen.
- **Schuppen in Reihen:** Am Rumpf, Hals, Kopf und Schwanz liegen die Schuppen in
  versetzten Reihen, wie bei echten Reptilien. Ihre Grösse passt sich dem Umfang an
  (Kopf fein, Brust grob). Weniger Farb-Kontrast, die Form kommt aus der Normal-Map.
- **Flughaut:** Die Adern laufen fächerförmig vom Handgelenk weg, dazu ein feines
  Adernetz und Falten. Vorher sah das Muster wie trockene, rissige Erde aus.
- **Gewichte automatisch:** Blender rechnet selbst aus, welcher Hautpunkt an
  welchem Knochen hängt („Bone Heat“). Der Unterkiefer bleibt ein eigenes Teil.

| Teil | Dreiecke |
|---|---|
| Haut: Rumpf, Hals, Oberkopf, Schwanz, Beine, Arme, Muskeln (verschmolzen) | 42 000 |
| Unterkiefer (klappbar) | 3 776 |
| Zehen + Fusskrallen (beide Seiten) | 3 328 |
| Finger + Daumen + Daumenkrallen (beide Seiten) | 8 104 |
| 2 Flughäute | 3 990 |
| Hörner, Kiefer-, Rücken- und Schwanzstacheln | 6 464 |
| Zähne (oben und unten) | 2 484 |
| Augen (mit Schlitz-Pupille) | 704 |
| **Summe** | **70 850** |

Alles wird im Skript aus Formeln berechnet: Querschnitte entlang einer Mittellinie,
Röhren für Beine, Finger und Hörner, Ellipsoide für Muskeln, eine gewölbte
Flughaut mit gewellter Hinterkante.

### Sicherheit

- **Keine** fremden Modelle, Texturen oder Bilder. Nichts aus dem Internet
  ausser den zwei Werkzeugen unten.
- Installiert wurde nur im Arbeitsordner **ausserhalb des Repos**:
  1. `bpy==5.0.1` (Blender als Python-Paket, Blender Foundation) von PyPI in einem venv.
     Datei `bpy-5.0.1-cp311-cp311-manylinux_2_28_x86_64.whl`, 374 257 847 Bytes,
     SHA256 laut PyPI `79c6e421f53ea24a5961d86eefb8141798eee708682415eb4f5a952c2abdeb8b`.
     pip prüft diese Prüfsumme automatisch. Mit installiert (Abhängigkeiten von bpy):
     numpy, requests, cython, zstandard, urllib3, idna, certifi, charset_normalizer.
  2. `gltf-validator@2.0.0-dev.3.10` (Khronos Group, Apache-2.0) von npm.
     Das Paket ist nur eine Bibliothek ohne Befehl, darum geht `npx gltf-validator`
     nicht direkt. Es wurde mit `npm install --ignore-scripts` geladen
     (keine Installations-Skripte, keine weiteren Pakete).
     npm prüft die Prüfsumme `sha512-odJ4k0tR…ascH2LAEQ==`.
- Im Skript: `use_scripts_auto_execute = False`. Es wird keine fremde Datei geöffnet.
- Die GLB enthält nur Daten (Geometrie, Skelett, Bilder), keinen Code.

### Ergebnis

| Punkt | Wert |
|---|---|
| Datei | `public/models/dragon_scales.glb` |
| Grösse | 4 996 192 Bytes (ca. 5,0 MB) |
| SHA256 | `aaa5e1e41d13c933207e9bedbac1acb1fba4307f76791223d74410b7a3f02e33` |
| Meshes | 1 (`Drache`), 6 Materialien → 6 Draw-Calls |
| Dreiecke / Punkte | 70 850 / 40 779 |
| Knochen | 50, alle verformend, max. 4 Knochen pro Punkt |
| Texturen (JPEG in der GLB) | Haut: Farbe + Normal-Map je 2048 × 2048; Flughaut: Farbe + Normal-Map je 2048 × 1024 |
| Extras | Tangenten (für die Normal-Maps), 3 Ankerpunkte, Erweiterung `KHR_materials_emissive_strength` (leuchtende Augen) |
| Animationen | keine |
| Masse | Länge 22,66 m, Spannweite 25,53 m, Höhe 5,30 m |

### Prüfungen

- **Khronos glTF-Validator:** **0 Fehler, 0 Warnungen**, 3 Infos.
  Die 3 Infos heissen „leerer Knoten“. Das sind die gewollten Ankerpunkte.
- **Wieder eingelesen mit Blender (bpy):** 1 Mesh, 70 850 Dreiecke, 50 Knochen,
  6 Materialien, 4 Bilder, 3 Anker. Das passt zum Export.
- **Vorschaubilder mit Cycles** (schräg, Seite, oben, vorne, hinten, Kopf, Schulter,
  von unten): Form, Texturen und Farben stimmen, keine Löcher in der Haut.
- **Test-Pose:** Flügel hoch, Maul auf, Hals und Schwanz zur Seite, Beine angezogen.
  Die Haut verformt sich sauber, und die Flughaut bleibt am Körper.
- Die Vorschaubilder sind **nicht** im Repo (sie gehören nicht zur Liste der Dateien).

---

## Teil C – Einbau ins Spiel (erledigt)

- `src/dragon/Dragon.js` lädt die GLB und bewegt die Knochen. Der alte Code-Drache ist ersetzt.
- Flügelschlag, Flügel anlegen, Hals, Kopf, Kiefer, Schwanz und Beine funktionieren wie vorher.
- Reiter, Feuer, Rauch und der Geister-Drache im Rennen benutzen die Anker.
- Die Flughaut scheint im Gegenlicht rötlich durch (eigener Shader-Zusatz).
- Version 2 des Modells: kräftigere Adern, dickere (dunklere) Haut an den Knochen,
  dunkle Flecken auf dem Rücken.
- Version 3 des Modells (siehe Teil B): Am Spiel-Code musste nichts geändert werden.
  Knochen-Namen, Anker und die Füsse (y = −2,66) sind gleich geblieben.
  Geprüft mit Bildschirmfotos: Fliegen, Gegenlicht, Reiter-Sicht, Feuer, Stehen und Laufen.
- Getestet mit Bildschirmfotos im echten Spiel (Chromium ohne Grafikkarte).
  Dafür wurden die Projekt-Pakete mit `npm ci --ignore-scripts` installiert
  (Prüfsummen aus `package-lock.json`, keine Installations-Skripte).

## Technische Hinweise zum Modell

- **Richtung und Grösse:** Meter, +Y oben, der Kopf zeigt nach **−Z**, rechts ist +X.
  Das Modell ist schon so gross wie der bisherige Drache im Spiel (Skalierung 1).
  Die Schnauzenspitze liegt bei z = −9,41.
- **Ursprung:** Körpermitte (Knochen `root`), wie bisher im Spiel-Code.
  Die Füsse stehen bei y = −2,66.
- **Knochen:** Namen, Eltern, Positionen und Ruhe-Drehungen stehen in
  `tools/dragon_scales_bones.json`. Wichtig: Die Knochen haben eine eigene
  Ruhe-Drehung, darum immer **relativ dazu** drehen.
  - Wirbelsäule: `root`, `chest`, `neck_01`–`neck_05`, `head`, `jaw`, `hips`, `tail_01`–`tail_08`
  - Beine: `thigh_`, `shin_`, `foot_`, `toes_` + `L`/`R`
  - Flügel: `upperarm_`, `forearm_`, `hand_`, `thumb_`, `finger1_1_` … `finger4_2_` + `L`/`R`
- **Ruhepose:** Flügel gespreizt, Beine stehend, Maul zu.
  Flügel anlegen = Finger- und Armknochen drehen.
- **Anker (leere Knoten im GLB):** `Anker_Maul` (Feuer, am Kopf), `Anker_Nuestern`
  (Rauch, am Kopf), `Anker_Sattel` (Reiter, an der Brust).
  Rund um den Sattel gibt es keine Rückenstacheln.
- **Farben ändern (Customization.js):** Die Texturen sind fast farblos. Die Farbe
  kommt aus der Materialfarbe. Also einfach `material.color` setzen:
  - `Haut` ← `skin.body`, `Bauch` ← `skin.belly` (auch Gaumen und Kehle),
    `Flughaut` ← `skin.membrane`, `Horn` ← `skin.horn` (auch Zähne),
    `Kralle` bleibt dunkel, `Auge` → `emissive` ← `skin.eye`.
  - Standard ist der Skin „Grau“.
- **Flughaut** ist eine einzelne, beidseitige Fläche (`doubleSided`). Das Durchscheinen
  wie im alten Code (etwas `emissive`) kann man im Spiel dazugeben.
- Der **Reiter** und das **Leuchten im Maul** sind nicht im Modell.
  Beides macht der Spiel-Code wie bisher.

---

## Probleme und offene Punkte

- Das ist **nicht** der Sintel-Drache. Ein von Hand modellierter Drache hat mehr
  Details (Hautfalten, einzeln geformte Schuppen). Das Maul-Innere ist schlicht,
  die Flughaut ist eine dünne Fläche.
- Die Bildrate auf einem echten Computer mit Grafikkarte konnte hier nicht
  gemessen werden (Test lief mit Software-Grafik). Das Modell hat etwa 12 % mehr
  Dreiecke als Version 2, die Datei ist aber kleiner (5,0 statt 5,6 MB).
- An Armen und Beinen sind die Schuppen ein 3D-Muster ohne Reihen (dort gibt es keine
  saubere Längsrichtung). Am Übergang zum Rumpf gehen die zwei Muster weich ineinander über.
- An einer kleinen Stelle der Flughaut am Ellbogen ist die Normal-Map fehlerhaft. Sie
  liegt im Arm und ist nicht zu sehen.
- Normal-Maps als JPEG haben leichte Kompressions-Spuren. Aus der Spiel-Entfernung
  sieht man das nicht.
- Beim Bauen gab es einen Absturz von Blender (Speicherfehler), etwa bei jedem zweiten Bau.
  Ursache war ein Fehler im Skript: Nach dem Anlegen neuer UV-Ebenen wurde ein alter
  Verweis auf eine UV-Ebene weiterbenutzt. Behoben (Ebenen werden jetzt immer frisch über
  den Namen geholt), danach 12 von 12 Testläufen und 2 ganze Bauten ohne Absturz.
- Zwei Bauten ergeben das gleiche Modell, aber nicht Byte für Byte die gleiche Datei
  (Cycles rechnet beim Backen mit mehreren Threads). Darum ändert sich die SHA256.
- Das Skript heisst `tools/build_dragon.py` statt `convert_dragon.py`,
  weil es nichts umwandelt, sondern baut.
- Neu bauen dauert ca. 3 Minuten (4 CPU-Kerne), Anleitung im Kopf des Skripts.
