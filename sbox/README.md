# Drachen-Flug-Demo für s&box

Hier liegt eine **kleine Flug-Demo** für **s&box** (Spiel-Plattform von Facepunch, Source 2, C#).
Ziel: den Drachen schon früh auf **sbox.game** hochladen und fliegen lassen.

- **Hauptprojekt bleibt Unreal** (`unreal/`, `docs/UNREAL.md`). s&box ist ein Nebenprojekt.
- Die Demo ist **nicht** das ganze Browser-Spiel. Nur: fliegen, schweben, landen, laufen.

## Was ist fertig?

| Datei | Was sie macht | Stand |
|---|---|---|
| `Code/Flight/DragonFlightModel.cs` | Flugphysik, **1:1** aus `src/dragon/FlightPhysics.js` (über die C++-Version) | **getestet**: 12 Test-Flüge gleich wie im Browser-Spiel |
| `Code/Flight/DMath.cs` | Vektor + Quaternion mit `double` (genau wie JS) | getestet |
| `Code/Flight/DragonSpace.cs` | Umrechnung Physik-Raum ↔ s&box | getestet |
| `Code/DragonController.cs` | s&box-Komponente: Tasten, Boden (Trace), Kamera, Anzeige | **nur gegen eine Nachbildung** von s&box kompiliert |
| `Tests/` | Vergleichstest (nicht nach s&box kopieren!) | – |

**Ehrlich:** `DragonController.cs` wurde nie mit dem echten s&box kompiliert (in der Cloud gibt es
kein s&box). Beim ersten Start kann s&box Fehler zeigen, wenn ein Name anders heisst
(z. B. `DebugOverlay.ScreenText`, `Scene.Trace`). Dann dort anpassen – **die Flugphysik nicht ändern**.

**Noch nicht drin:** Flügelschlag-Animation (der Drache ist starr), Feuer, Töne, Hindernisse
(man fliegt durch Häuser), Menschen, Welt.

## Physik-Raum und s&box

Die Flugphysik rechnet wie das Browser-Spiel. Umgerechnet wird nur im `DragonController`.

| | Einheit | vorne | oben | rechts |
|---|---|---|---|---|
| Physik-Raum (Browser-Spiel) | Meter | −Z | +Y | +X |
| s&box | Zoll (1 m = 39,37) | +X | +Z | −Y (+Y = links) |

- Beide Räume sind rechtshändig → Quaternion (x, y, z, w) wird zu (−z, −x, y, w).
- Der Drache ist ca. **21 m lang** (≈ 830 s&box-Einheiten) und hat **35,5 m Spannweite** (≈ 1400).

## Einrichten (macht Claude auf Andrejs PC)

1. **s&box** über Steam installieren (Andrej). Einmal den s&box-Editor öffnen und ein **neues Spiel-Projekt**
   anlegen, z. B. `C:\Projekte\DragonSbox` (das ist der einzige Klick-Schritt).
2. Aus diesem Ordner nach `<Projekt>\Code\` kopieren: `Code\Flight\` und `Code\DragonController.cs`.
   **Nicht** `Tests\` kopieren.
3. **Tasten** (Projekt-Einstellungen → Input, Datei `ProjectSettings/Input.config` – Format dort ansehen):
   `Jump` (Leertaste) und `Run` (Shift) gibt es schon. Neu anlegen:

   | Aktion | Taste | Gamepad |
   |---|---|---|
   | `Boost` | E | rechter Trigger |
   | `Hover` | V | linker Trigger |
   | `Land` | L | Steuerkreuz links |

   W/S/A/D und der linke Stick kommen aus `Input.AnalogMove` (nichts anlegen).
4. **Modell:** `public/models/dragon_scales.glb` nach `<Projekt>\Assets\models\` kopieren.
   s&box macht daraus ein Modell (`.vmdl`). Klappt GLB nicht: in Blender im Hintergrund per Skript
   nach FBX umwandeln (`blender --background --python …`). Grösse prüfen: ca. 830 Einheiten lang.
   Falls zu klein: Import-Skalierung 39,37 (Meter → Zoll).
5. **Szene:** ein GameObject `Drache` ca. **300 m über dem Boden** (≈ 11 800 Einheiten) mit der Komponente
   `DragonController`. Darunter ein Kind `Modell` mit `SkinnedModelRenderer` (der Drache).
   Der **Kopf muss nach +X zeigen** (roter Pfeil). Sonst das Kind `Modell` drehen (z. B. 90° oder 180° um Z).
   Dazu ein grosser Boden **mit Kollision** (sonst findet der Trace keinen Boden → der Drache „landet“
   auf Meereshöhe 0) und die Haupt-Kamera (ohne eigene Steuer-Komponente).
6. **Play** drücken und testen (siehe Steuerung).

## Steuerung (wie im Browser-Spiel)

| Taste | Im Flug | Am Boden / Schweben |
|---|---|---|
| W / S | Nase hoch / runter | vorwärts / rückwärts |
| A / D | Kurve links / rechts | drehen |
| Leertaste | Flügelschlag | abheben / steigen |
| Shift | Sturzflug | sinken |
| E | Boost (braucht Ausdauer) | rennen |
| V | bremsen, dann schweben | – |
| L | Landeanflug (unter 150 m) | – |

Einstellungen der Komponente im Editor: Start-Tempo, Flughilfe, Flugzeug-Steuerung (W/S tauschen),
Kamera-Abstand, Namen der Tasten-Aktionen, Anzeige oben links.

## Hochladen auf sbox.game

- Im s&box-Editor gibt es einen Knopf zum **Veröffentlichen** (Publish). Zuerst **nicht öffentlich**
  hochladen und testen.
- **Eigener Name nötig:** „DragonTwin“ gehört einem anderen Spiel. Den Namen **vor** dem ersten Hochladen
  festlegen (der Paket-Name lässt sich später schwer ändern).
- Nur eigene Inhalte oder freie Lizenzen (CC0/CC-BY, siehe `public/models/QUELLEN.md`).

## Test (nach jeder Änderung an der Flugphysik)

```
sh sbox/Tests/run_all.sh
```

- Braucht **Node** und das **.NET-SDK** (Version 8 oder neuer).
- Rechnet die 12 Test-Flüge aus `unreal/Tests/` mit JS und C# und vergleicht sie
  (Grenzen: 5 cm, 0,1°, gleiche Ereignisse). Muss überall „gleich ✔“ zeigen.
- Kompiliert `DragonController.cs` gegen die Nachbildung `Tests/ControllerCheck/SboxStub.cs`.
- `sh unreal/Tests/run_all.sh` macht das automatisch mit, wenn `dotnet` installiert ist.
- Wichtig: Die Flugphysik gibt es jetzt **dreimal** (JS, C++, C#). Eine Änderung immer in allen drei machen.
