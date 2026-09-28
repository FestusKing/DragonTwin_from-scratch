# Unreal: vorbereitete Dateien für Meilenstein 1 („Der Drache fliegt“)

Diese Dateien gehören ins **Unreal-Projekt `DragonTwinUE`** (siehe [docs/UNREAL.md](../docs/UNREAL.md)).
Sie liegen hier, bis das Unreal-Projekt auf deinem PC existiert.

```
unreal/
  Source/DragonTwinUE/
    DragonTwinUE.Build.cs        Bau-Einstellungen (braucht "EnhancedInput")
    DragonPawn.h / .cpp          der Drache in Unreal: Modell, Kamera, Tasten, Boden, Anzeige
    Flight/
      DragonFlightModel.h / .cpp Flugphysik – 1:1 aus dem Browser-Spiel übertragen
      DragonSpace.h              Umrechnung Unreal (cm, Z oben) ↔ Flugphysik (m, Y oben)
  Tests/                         Vergleichstest (läuft ohne Unreal, nicht ins Projekt kopieren)
```

---

## Was schon geprüft ist

| Teil | Geprüft? | Wie |
| --- | --- | --- |
| Flugphysik (C++) | ✅ ja | 10 Test-Flüge gegen das Browser-Spiel: Gleiten, Kurven, Looping, Flattern, Boost, Schweben, Landen, Laufen, Abheben, Wind, Wasser, Hindernis, Kartenrand. Grösste Abweichung: 0,1 mm. |
| Umrechnung Unreal ↔ Physik | ✅ ja | 8 Prüfungen, z. B. „Linkskurve bleibt Linkskurve“, 1000 Zufallsdrehungen |
| Test merkt Fehler? | ✅ ja | Absichtlich 2 % an einer Zahl verändert → Test meldet „ANDERS“ |
| DragonPawn (Unreal-Teil) | ⚠️ nur Syntax | gegen eine vereinfachte Unreal-Nachbildung geprüft. **Erst auf deinem PC wirklich kompiliert.** Kleine Fehler sind möglich. |

Test selbst starten (braucht Node und g++, kein Unreal): `sh unreal/Tests/run_all.sh`

---

## Einbauen – Schritt für Schritt

**Vorher:** Unreal Engine 5, Visual Studio und das C++-Projekt **DragonTwinUE** sind eingerichtet
([docs/UNREAL.md](../docs/UNREAL.md), Schritt 1–3).

### 1. Dateien kopieren
1. Unreal-Editor **schliessen**.
2. Diese Dateien nach `DragonTwinUE/Source/DragonTwinUE/` kopieren:
   - den Ordner `Flight/`
   - `DragonPawn.h` und `DragonPawn.cpp`
3. `DragonTwinUE.Build.cs` ersetzen (oder in der vorhandenen Datei `"EnhancedInput"` ergänzen).

### 2. Kompilieren
1. Doppelklick auf `DragonTwinUE.uproject`.
2. Frage „Module fehlen / neu bauen?“ → **Ja**.
3. Klappt es nicht: Fehlermeldung kopieren und schicken (oder Claude auf deinem PC nachsehen lassen).

### 3. Drachen importieren
1. Im Content Browser einen Ordner **Drache** anlegen.
2. Die Datei `public/models/dragon_scales.glb` aus diesem Repository hineinziehen → **Import**.
3. Prüfen: Es gibt ein **Skeletal Mesh** (mit Skelett).

### 4. Blueprint anlegen
1. Content Browser → Rechtsklick → **Blueprint Class** → unten „All Classes“ → **DragonPawn** suchen.
2. Name: **BP_Drache**. Öffnen.
3. Links die Komponente **DrachenModell** anklicken → rechts **Skeletal Mesh Asset** = der importierte Drache.
4. Prüfen: Der Kopf zeigt in Richtung des **roten Pfeils** (X). Wenn nicht: beim DrachenModell
   **Rotation Z** auf 90, −90 oder 180 stellen.
5. Speichern (Compile + Save).

### 5. Ausprobieren
1. Ein Level mit Boden öffnen (z. B. neues Level „Basic“ oder eine Landschaft).
2. **BP_Drache** ins Level ziehen, etwa **300 m hoch** (Z = 30000).
3. **Play** (Alt + P).

---

## Steuerung (wie im Browser-Spiel)

| Aktion | Tastatur | Gamepad |
| --- | --- | --- |
| Nase hoch / runter | S / W (oder ↓ / ↑) | linker Stick |
| Rollen / Kurve | A / D (oder ← / →) | linker Stick |
| Flügelschlag, am Boden: abheben | Leertaste | A |
| Sturzflug | Shift | B |
| Boost | E oder Strg | RT |
| Bremsen / Schweben | V | LT |

Oben links steht: Tempo, Höhe, Ausdauer und was der Drache gerade macht.

---

## Einstellungen im Blueprint (Details-Fenster)

- **Flight Assist:** Flughilfe an/aus (aus = Loopings und Fassrollen von Hand)
- **Start Speed:** Tempo beim Start (m/s)
- **World Radius:** Kartenrand in Metern (für grosse Karten erhöhen)
- **Wind:** Wind in m/s
- **Show Flight Info:** Anzeige oben links

## Wichtig zu wissen

- Das **Meer** liegt bei **Z = 0**. Ist darunter kein Boden, gilt es als Wasser.
- Boden = alles, was **WorldStatic** ist (Landschaft, Felsen, Dächer).
- **Gebäude von der Seite** (Hindernisse) kommen in Meilenstein 3.

## Nächste Schritte (Meilenstein 1b)

- **Flügel-Animation:** Flügelschlag, Anlegen im Sturzflug, Beine, Hals, Schwanz – aus `src/dragon/Dragon.js`
- **Feuer** (Niagara) und **Töne**
- **Anzeige** wie im Browser-Spiel (Tempo, Höhe, Ausdauer als Balken)
