# Drachen-Spiel für s&box

Hier liegt die **s&box-Version** des Drachen-Spiels (Spiel-Plattform von Facepunch, Source 2, C#).
Ziel: auf **sbox.game** hochladen. Später vielleicht Geld über den **Play Fund**: Facepunch zahlt
nach Spielzeit. Dafür muss das Spiel Spass machen, und die Leute müssen es oft wieder spielen.

- Stand: **Fliegen + Ringrennen** mit Gegner-Drachen, Geist, Medaillen und Bestzeiten.
- Das Browser-Spiel und die Unreal-Vorbereitung (`unreal/`) bleiben unverändert.

## Was ist fertig?

| Datei | Was sie macht | Stand |
|---|---|---|
| `Code/Flight/DragonFlightModel.cs` | Flugphysik, **1:1** aus `src/dragon/FlightPhysics.js` | **getestet**: 12 Test-Flüge gleich wie im Browser-Spiel |
| `Code/Flight/DMath.cs`, `DragonSpace.cs` | Vektor/Quaternion (double), Umrechnung Physik-Raum ↔ s&box | getestet |
| `Code/Game/RaceCourse.cs` | 3 Ring-Strecken (Leicht, Mittel, Schwer), Medaillen-Zeiten | **getestet**: jede Strecke mit Autopilot abgeflogen |
| `Code/Game/RingRace.cs` | Ringrennen: Countdown, Ringe, Zwischenzeiten, Platz, Medaille, Bestzeit | getestet |
| `Code/Game/GhostReplay.cs` | Geist: deine Bestzeit fliegt als zweiter Drache mit | getestet |
| `Code/Game/DragonAutopilot.cs` | KI-Pilot mit derselben Physik wie du (für Gegner-Drachen) | getestet |
| `Code/DragonController.cs` | s&box: Tasten, Boden (Trace), Kamera, Anzeige | **nur gegen eine Nachbildung** kompiliert |
| `Code/RaceComponent.cs` | s&box: Ringe, Gegner, Geist, Anzeige, Speichern | **nur gegen eine Nachbildung** kompiliert |
| `Assets/models/ring.obj` | Ring-Modell (Torus, Achse +X). Erzeugt von `tools/make_ring_obj.py` | – |
| `Tests/` | Tests (nicht nach s&box kopieren!) | – |

**Ehrlich:** Die zwei s&box-Komponenten wurden nie mit echtem s&box kompiliert (in der Cloud gibt es
kein s&box). Beim ersten Start kann s&box Fehler zeigen, wenn ein Name anders heisst
(z. B. `DebugOverlay.ScreenText`, `Scene.Trace`, `Scene.CreateObject`, `FileSystem.Data`).
Dann dort anpassen. **Die Dateien in `Code/Flight/` und `Code/Game/` nicht ändern**, sie sind getestet.

**Noch nicht drin:** Flügelschlag-Animation (Drachen sind starr), schöne Anzeige (bis jetzt nur
Text-Zeilen), Töne, leuchtende Ringe, Gelände, Hindernisse, Online-Bestenliste.

## Physik-Raum und s&box

Die Physik rechnet wie das Browser-Spiel. Umgerechnet wird nur in den s&box-Komponenten.

| | Einheit | vorne | oben | rechts |
|---|---|---|---|---|
| Physik-Raum (Browser-Spiel) | Meter | −Z | +Y | +X |
| s&box | Zoll (1 m = 39,37) | +X | +Z | −Y (+Y = links) |

- Beide Räume sind rechtshändig → Quaternion (x, y, z, w) wird zu (−z, −x, y, w).
- Der Drache ist ca. **21 m lang** (≈ 830 s&box-Einheiten) und hat **35,5 m Spannweite** (≈ 1400).

## Einrichten (macht Claude auf Andrejs PC)

1. **s&box** über Steam installieren (Andrej). Einmal den s&box-Editor öffnen und ein **neues Spiel-Projekt**
   anlegen, z. B. `C:\Projekte\DragonSbox` (das ist der einzige Klick-Schritt).
2. Aus diesem Ordner nach `<Projekt>\Code\` kopieren: `Code\Flight\`, `Code\Game\`, `Code\DragonController.cs`,
   `Code\RaceComponent.cs`. **Nicht** `Tests\` kopieren.
3. **Tasten** (Projekt-Einstellungen → Input, Datei `ProjectSettings/Input.config` – Format dort ansehen).
   Diese Aktionen gibt es normalerweise schon: `Jump` (Leertaste), `Run` (Shift), `Reload` (R),
   `Slot1` … `Slot5` (Tasten 1–5). Nachsehen, ob es stimmt. Neu anlegen:

   | Aktion | Taste | Gamepad |
   |---|---|---|
   | `Boost` | E | rechter Trigger |
   | `Hover` | V | linker Trigger |
   | `Land` | L | Steuerkreuz links |

   W/S/A/D und der linke Stick kommen aus `Input.AnalogMove` (nichts anlegen).
4. **Modelle:**
   - `public/models/dragon_scales.glb` nach `<Projekt>\Assets\models\` kopieren. s&box macht daraus ein
     Modell (`.vmdl`). Klappt GLB nicht: in Blender im Hintergrund per Skript nach FBX umwandeln.
     Grösse prüfen: ca. 830 Einheiten lang. Falls zu klein: Import-Skalierung 39,37 (Meter → Zoll).
   - `sbox/Assets/models/ring.obj` nach `<Projekt>\Assets\models\` kopieren → `models/ring.vmdl`.
     Heisst es anders: in der Komponente `RaceComponent` das Feld `RingModel` setzen.
     Schöner: ein leuchtendes Material (Emission) für den Ring.
5. **Szene:**
   - GameObject `Drache` ca. **300 m über dem Boden** (≈ 11 800 Einheiten) mit der Komponente `DragonController`.
     Darunter ein Kind `Modell` mit `SkinnedModelRenderer` (der Drache). Der **Kopf muss nach +X zeigen**
     (roter Pfeil). Sonst das Kind `Modell` drehen (z. B. 90° oder 180° um Z).
   - GameObject `Rennen` mit der Komponente `RaceComponent`: `Dragon` = der `Drache`, `DragonModel` = das Kind `Modell`
     (davon werden Gegner und Geist kopiert, mit derselben Drehung und Grösse).
   - Ein grosser Boden **mit Kollision** (sonst findet der Trace keinen Boden, und der Drache „landet“ auf
     Meereshöhe 0). Die Strecken brauchen ca. **2 km × 2 km** rund um die Mitte (0, 0).
   - Die Haupt-Kamera (ohne eigene Steuer-Komponente).
6. **Play** drücken und testen (siehe Steuerung).

## Steuerung

| Taste | Im Flug | Am Boden / Schweben |
|---|---|---|
| W / S | Nase hoch / runter | vorwärts / rückwärts |
| A / D | Kurve links / rechts | drehen |
| Leertaste | Flügelschlag | abheben / steigen |
| Shift | Sturzflug | sinken |
| E | Boost (braucht Ausdauer) | rennen |
| V | bremsen, dann schweben | – |
| L | Landeanflug (unter 150 m) | – |
| **R** | **Ringrennen starten / neu starten** | |
| **1 / 2 / 3** | Strecke wählen: Übungsrunde (Leicht), Slalom (Mittel), Sturzflug (Schwer) | |
| **4 / 5** | Gegner-Drachen an/aus, Geist an/aus | |

## Das Ringrennen

- Countdown 3-2-1, dann durch die Ringe in der richtigen Reihenfolge. Nächster Ring = orange, Ziel = grün.
- **Gegner:** Glutschwinge (leicht), Sturmkralle (mittel), Nebelzahn (schwer). Sie fliegen mit
  **derselben Physik** wie du (KI-Pilot), sie schummeln nicht. Anzeige: dein Platz.
- **Medaillen** Gold/Silber/Bronze nach Zeit (wie im Browser-Spiel: Streckenlänge ÷ 52 / 42 / 33 m/s).
- **Bestzeit + Geist** werden gespeichert (`FileSystem.Data`, Datei `rennen_<strecke>.json`).
  Beim nächsten Rennen zeigt die Anzeige, wie viel du vor oder hinter deiner Bestzeit bist.
- Test-Zeiten des Autopiloten (Browser-Physik): Übungsrunde ca. 55–58 s, Slalom ca. 74–76 s,
  Sturzflug ca. 69 s. Nebelzahn ist etwa gleich schnell, Glutschwinge viel langsamer.

## Hochladen auf sbox.game

- Im s&box-Editor gibt es einen Knopf zum **Veröffentlichen** (Publish). Zuerst **nicht öffentlich**
  hochladen und testen.
- **Eigener Name nötig:** „DragonTwin“ gehört einem anderen Spiel. Den Namen **vor** dem ersten Hochladen
  festlegen (der Paket-Name lässt sich später schwer ändern).
- Nur eigene Inhalte oder freie Lizenzen (CC0/CC-BY, siehe `public/models/QUELLEN.md`).

## Test (nach jeder Änderung an `Code/Flight/` oder `Code/Game/`)

```
sh sbox/Tests/run_all.sh
```

- Braucht **Node** und das **.NET-SDK** (Version 8 oder neuer).
- Rechnet die 12 Test-Flüge aus `unreal/Tests/` mit JS und C# und vergleicht sie
  (Grenzen: 5 cm, 0,1°, gleiche Ereignisse). Muss überall „gleich ✔“ zeigen.
- Ringrennen: Ring-Treffer, jede Strecke mit dem Autopiloten (flach + welliges Gelände, ohne Aufprall),
  Bestzeit + Geist, Gegner (alle im Ziel, leicht < mittel < schwer).
- Kompiliert die s&box-Komponenten gegen die Nachbildung `Tests/ControllerCheck/SboxStub.cs`.
- `sh unreal/Tests/run_all.sh` macht das automatisch mit, wenn `dotnet` installiert ist.
- Die Flugphysik gibt es **dreimal** (JS, C++, C#). Eine Änderung immer in allen drei machen.
- Strecke ändern: Zahlen in `RaceCourses.All` (`Code/Game/RaceCourse.cs`), dann Test laufen lassen.

## Nächste Schritte (Ideen für mehr Spielzeit)

1. In s&box zum Laufen bringen (Fehler beheben), Andrej testet.
2. Schöne Anzeige (Razor-Oberfläche), leuchtende Ringe, Töne, Flügelschlag-Animation.
3. **Online-Bestenliste** (s&box-Statistiken) → Spieler wollen die Bestzeit der anderen schlagen.
4. Gelände (Insel, Berge) statt flachem Boden, mehr Strecken.
5. **Aufgaben** (z. B. Schafe fangen, Feuer legen, Türme zerstören) und **Gegner** (Armbrust-Türme,
   feindlicher Drachenreiter) – aus dem Browser-Spiel übertragen.
6. Mehrspieler: Rennen gegen echte Freunde (s&box kann Mehrspieler).
