# Übergabe: Stand des Projekts (für Claude auf Andrejs PC)

Diese Datei ist für eine **neue Claude-Sitzung auf Andrejs PC**. Sie kennt den bisherigen Chat nicht.
Hier steht, was fertig ist, was als Nächstes kommt und worauf man achten muss.
Zuerst auch `CLAUDE.md` (Regeln, Sicherheit) und `docs/UNREAL.md` (Plan) lesen.

## Wer und wie

- **Andrej**, ICT-Fachmann in Ausbildung (1. Lehrjahr). Legasthenie, ADHS, Dyskalkulie.
- **Antworten auf Deutsch (Schweiz, „ss“ statt „ß“)**: einfach, kurz, Stichpunkte, Schritt für Schritt.
  Kritisch und ehrlich auf Fehler hinweisen, nichts beschönigen.
- **Andrej will, dass Claude ALLES selbst macht** – auch im Unreal-Editor und in Blender.
  Er selbst gibt nur Erlaubnis, testet (fliegen, anschauen) und sagt, was sich falsch anfühlt.
  Also keine Klick-Anleitungen, sondern **Skripte**:
  - **Unreal-Editor:** Python-Editor-Skripte (Plugins „Python Editor Script Plugin“ und
    „Editor Scripting Utilities“ – offizielle Epic-Plugins; falls aus, in der `.uproject` einschalten und
    Andrej kurz sagen). Ausführen z. B. mit
    `UnrealEditor-Cmd.exe <Projekt>.uproject -run=pythonscript -script="<Datei>.py"`
    oder beim Start mit `-ExecutePythonScript=`. Damit: GLB importieren, Blueprint anlegen,
    Level bauen, Actor platzieren, Einstellungen setzen.
  - **Blender:** im Hintergrund per Skript (`blender --background --python <Datei>.py`) oder über
    Andrejs Blender-MCP-Server.
  - Nur wenn etwas wirklich nur mit der Maus geht: ganz kurz erklären, welcher Klick.
- Er schickt gern **Screenshots** – die helfen sehr. Zum Testen ihm genau sagen, was er ausprobieren soll.
- **Sicherheit** (so gewollt): nichts Ausführbares aus dem Internet ausführen, keine fremden Pakete,
  Plugins oder Add-ons ohne Nachfrage. Vor jedem Befehl kurz sagen, was er tut.
  Nur in `C:\Projekte` lesen und schreiben.

## Andrejs PC

- Windows, 32 GB RAM, NVIDIA GeForce RTX 3000er-Reihe mit 8 GB, DirectX 12, SSD (C:), 212 GB frei.
- **Unreal Engine 5.8.3** (Epic Games Launcher), **Visual Studio** mit „Spieleentwicklung mit C++“.
- Ordner:
  - `C:\Projekte\DragonTwinUE` – das neue Unreal-Projekt (C++, Vorlage „Leer“, ohne Starter-Inhalte).
    Es ist angelegt und startet.
  - `C:\Projekte\DragonTwin_from-scratch` – dieses Repository (Browser-Spiel + Vorlage),
    Branch `claude/optimistic-dirac-1w4cgo` (enthält alles Neue, ist nicht in `main`).

## Was fertig ist

**Browser-Spiel** (Three.js, läuft im Browser und als Desktop-Programm mit Electron, bei Andrej ~150 FPS):
- Drache mit 50 Knochen (`public/models/dragon_scales.glb`), Flugphysik, Feuer, Brüllen, Biss, Ausweichrolle.
- Welt: Insel mit Dorf, Burg, Vulkan mit Hort, Schlucht mit Wasserfall, Wetter, Tag/Nacht.
- Schlacht mit zwei Armeen, feindlicher Drachenreiter, zerstörbare Gebäude, Aufträge, Rennen.
- Neu: Sonnenstrahlen, orange Lava, Gras im Wind, W = Nase hoch, Landen mit L, Laufen/Rennen,
  Todes-Animation (Absturz → Aufwachen im Hort).

**Unreal-Vorbereitung** (Ordner `unreal/`, Anleitung `unreal/README.md`):
- `unreal/Source/DragonTwinUE/Flight/` – Flugphysik in C++, **1:1** aus `src/dragon/FlightPhysics.js`.
  Rechnet im Physik-Raum des Browser-Spiels (Meter, Y oben, −Z vorne);
  Umrechnung nach Unreal in `Flight/DragonSpace.h`.
  **Getestet:** 12 Test-Flüge fliegen in JS und C++ gleich (`sh unreal/Tests/run_all.sh`, braucht Node + g++).
- `unreal/Source/DragonTwinUE/DragonPawn.h/.cpp` – der Drache in Unreal: Modell, Kamera (Federarm),
  Tasten/Gamepad über Enhanced Input (im Code angelegt), Boden per Line Trace, Anzeige oben links.
  **Nur gegen eine Nachbildung von Unreal geprüft, nie echt kompiliert** → beim ersten Kompilieren
  mit Unreal 5.8 sind kleine Fehler möglich (API-Änderungen, z. B. bei Enhanced Input).

## Meilenstein 1 „Der Drache fliegt“ – ERLEDIGT

Der Claude auf Andrejs PC hat das gemacht: kompiliert ohne Fehler, der Drache fliegt in UE 5.8.3.
Die Schritte bleiben hier zum Nachschauen. **Als Nächstes:** Git mit LFS (Schritt 6, falls noch nicht
gemacht), dann Meilenstein 1b (unten).

1. Aus `DragonTwin_from-scratch\unreal\Source\DragonTwinUE\` nach `C:\Projekte\DragonTwinUE\Source\DragonTwinUE\` kopieren:
   den Ordner `Flight\` sowie `DragonPawn.h` und `DragonPawn.cpp`.
2. `DragonTwinUE.Build.cs` **nicht ersetzen**, nur prüfen, ob `"EnhancedInput"` in
   `PublicDependencyModuleNames` steht.
3. Kompilieren, **Editor dabei geschlossen**. Zum Beispiel so (Pfad der Engine prüfen):
   ```
   "C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" DragonTwinUEEditor Win64 Development -Project="C:\Projekte\DragonTwinUE\DragonTwinUE.uproject" -WaitMutex
   ```
4. Fehler beheben. Die **Flugphysik** (`Flight\`) nur ändern, wenn sie nicht kompiliert – dann die
   gleiche Änderung auch hier im Repository machen und `sh unreal/Tests/run_all.sh` laufen lassen
   (auf Windows z. B. in Git Bash; braucht Node und g++).
5. **Per Python-Editor-Skript** (nicht per Klick-Anleitung, siehe oben) das machen, was in
   `unreal/README.md` (Abschnitte 3–5) als Klicks beschrieben ist: Drachen-GLB importieren
   (`public/models/dragon_scales.glb`), Blueprint `BP_Drache` von `DragonPawn` ableiten, Modell
   einstellen (Kopf zeigt nach +X), ein Test-Level mit Boden und `BP_Drache` in ~300 m Höhe,
   als Start-Level setzen. Danach Andrej nur noch sagen: Editor öffnen, Play, so steuern.
6. Danach Git für das Unreal-Projekt einrichten: **eigenes, neues Repository**, `.gitignore` für
   `Binaries/ Intermediate/ Saved/ DerivedDataCache/ .vs/ *.sln`, **Git LFS** für `.uasset`/`.umap`.
   Keine Dateien über 100 MB.

## s&box-Version (für sbox.game)

Andrej will das Spiel auf **sbox.game** hochladen (evtl. später Geld über den Play Fund). Ordner `sbox/`,
Anleitung **`sbox/README.md`** (Einrichten, Tasten, Szene):
- `sbox/Code/Flight/` – Flugphysik in **C#**, 1:1 wie JS und C++. **Getestet**.
- `sbox/Code/Game/` – **Ringrennen** (3 Strecken, Countdown, Medaillen, Bestzeit, Geist) und
  **3 Gegner-Drachen** mit KI-Pilot (gleiche Physik). **Getestet** (`sh sbox/Tests/run_all.sh`, braucht
  Node + .NET-SDK 8): jede Strecke wird vom Autopiloten ohne Fehler abgeflogen.
- `sbox/Code/DragonController.cs`, `sbox/Code/RaceComponent.cs` – s&box-Komponenten.
  **Nie mit echtem s&box kompiliert** → beim ersten Start Fehler möglich (Namen in s&box prüfen).
  `Code/Flight/` und `Code/Game/` dabei nicht ändern.
- Ring-Modell: `sbox/Assets/models/ring.obj` (von `tools/make_ring_obj.py`).
- Einrichten ohne Klick-Anleitung, soweit möglich: Dateien kopieren, `ProjectSettings/Input.config`
  ergänzen (Format vorher ansehen), Szene/GameObjects per Datei oder Editor-Werkzeug. Nur das Anlegen
  des s&box-Projekts selbst macht Andrej im Editor.
- s&box-Projekt z. B. in `C:\Projekte\DragonSbox`. **Eigener Spielname** vor dem ersten Hochladen.
- Die Flugphysik gibt es jetzt dreimal (JS, C++, C#): Änderungen immer in allen drei, danach
  `sh unreal/Tests/run_all.sh`.

## Offen (später)

- **Meilenstein 1b:** Flügel-Animation (aus `src/dragon/Dragon.js`), Feuer (Niagara), Töne, Anzeige.
- **Menschen und Armeen** neu in Unreal (Andrej findet die Klotz-Figuren im Browser-Spiel nicht gut
  und will mehr Menschen). Nicht mehr im Browser-Spiel verbessern.
- **Blender-MCP**: Andrej hat einen Blender-MCP-Server. Für neue Modelle nutzen
  (Menschen, Rüstung, Drachen-Editor, Höhle). Regeln in `CLAUDE.md` beachten
  (`execute_blender_code` = beliebiger Python-Code → jeden Schritt erklären, nur im Projektordner).
- **Steam**: Das Spiel braucht einen **eigenen Namen** („DragonTwin“ gehört einem anderen Spiel).
- Reihenfolge der weiteren Meilensteine: `docs/UNREAL.md`.
