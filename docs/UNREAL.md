# 🐉 Umstieg auf Unreal Engine 5

Die Pläne (die „Stretch Goals“) werden mit **Unreal Engine 5** gebaut.

- Das Unreal-Spiel ist ein **neues Projekt**. Es startet bei null.
- Das Browser-Spiel (dieses Repository) bleibt als **Vorlage**: Flugphysik, Ideen, Zahlen, Drachen-Modell.
- Unreal läuft **auf deinem PC**. Claudes Cloud-Umgebung kommt nicht an deinen PC.

---

## Warum Unreal? Was es für die Pläne schon mitbringt

| # | Plan | Werkzeug in Unreal | Einfach erklärt |
| --- | --- | --- | --- |
| 1 | Zerstörbare Gebäude | **Chaos Destruction** | Gebäude im Editor in Stücke „brechen“, echte Physik beim Einsturz |
| 2 | Rüstung | **Sockets** | Helm und Panzer an Knochen hängen |
| 3 | Drachen-Editor | **Morph Targets** + Knochen skalieren | Formen (aus Blender) stufenlos mischen |
| 4 | Begehbare Höhle | **Modeling Mode** oder Blender-Modell | echte Kollision mit Wänden und Decke |
| 5 | Quests mit Geschichte | **Data Tables** + **UMG** | Aufträge als Tabelle, Dialog-Fenster |
| 6 | Weltkarte mit Regionen | **World Partition** | riesige Welt, lädt automatisch nach |
| 7 | Strategie-Modus | **UMG** + **SaveGame** | Karten-Bildschirm, Spielstand speichern |
| 8 | Armeen und feindliche Drachen | **Mass** + **Physics Asset** + **Niagara** | tausende Soldaten, Ragdolls, Feuer |
| 9 | Mehrspieler | **Replication** + **Epic Online Services** | Netzwerk ist eingebaut, Online-Dienste gratis |

---

## Wer macht was?

**Du:**
- installierst Unreal und Visual Studio (mit deinem eigenen Epic-Konto)
- öffnest den Editor, spielst und testest
- sagst, was sich falsch anfühlt (Screenshots helfen sehr!)
- machst Dinge, die nur mit der Maus gehen – Claude erklärt jeden Klick

**Claude:**
- schreibt den C++-Code (Flugphysik, Feuer, Schlacht …)
- schreibt Python-Skripte für den Editor (Modelle importieren, Level bauen)
- erklärt Schritt für Schritt
- sucht Fehler

---

## Damit Claude direkt auf deinem PC arbeiten kann (empfohlen)

Claudes Cloud-Umgebung kann deinen PC nicht erreichen. Darum braucht es eine Sitzung **auf deinem PC**:

- **Weg A:** die **Claude Desktop-App** auf deinem PC, dort Claude Code im Projektordner öffnen.
- **Weg B:** im Projektordner ein Terminal öffnen und `claude remote-control` eingeben.
  Die Sitzung erscheint dann in der Claude-Code-App (auch auf dem Handy).

Dann kann Claude dort selbst kompilieren, Fehlermeldungen lesen und Skripte starten.
Ohne das musst du jede Fehlermeldung kopieren und schicken – das geht auch, ist aber langsamer.

---

## Schritt für Schritt einrichten

### Schritt 1: PC prüfen

Ungefähre Werte für Unreal Engine 5:

- Windows 10 oder 11 (64 Bit)
- Arbeitsspeicher: **32 GB** empfohlen (16 GB geht, ist aber langsam)
- Grafikkarte: DirectX 12, am besten **8 GB** Grafikspeicher oder mehr
- Speicherplatz: etwa **150 GB** frei, am besten auf einer SSD

So findest du die Werte:

- Arbeitsspeicher: Windows-Taste → „Systeminformationen“
- Grafikkarte: Task-Manager (Strg + Shift + Esc) → „Leistung“ → „GPU“

### Schritt 2: Installieren (nur offizielle Seiten!)

1. **Epic Games Launcher** von **epicgames.com** herunterladen und mit deinem Konto anmelden.
2. Im Launcher: **Unreal Engine** → **Bibliothek** → die neueste Version **5.x** installieren.
3. **Visual Studio Community** (gratis) von **visualstudio.microsoft.com**.
   - Beim Installieren anhaken: **„Spieleentwicklung mit C++“** („Game development with C++“).
   - Welche Visual-Studio-Version passt, steht in der Unreal-Dokumentation unter
     „Setting Up Visual Studio“ für deine Unreal-Version.

### Schritt 3: Projekt anlegen

1. Unreal Engine starten.
2. **Games** → **Blank** wählen.
3. Rechts: **C++** (nicht „Blueprint“) – sonst kann Claude keinen Code dafür schreiben.
4. Starter Content: **aus**.
5. Name: **DragonTwinUE** (genau so, der Code rechnet mit diesem Namen).
6. Speicherort: ein kurzer Pfad **ohne Umlaute und Leerzeichen**, z. B. `C:\Projekte\`.
   (Lange Pfade machen in Unreal Probleme.)

### Schritt 4: Speichern mit Git

- Für das Unreal-Projekt ein **eigenes, neues Repository** anlegen (nicht dieses hier).
  Unreal-Dateien sind gross und binär.
- In die Datei `.gitignore` gehören diese Ordner (die baut Unreal jedes Mal neu):

  ```
  Binaries/
  Intermediate/
  Saved/
  DerivedDataCache/
  .vs/
  *.sln
  ```

- Für die grossen Unreal-Dateien (`.uasset`, `.umap`) braucht es **Git LFS**.
  Achtung: GitHub gibt dafür nur begrenzt Gratis-Speicher.
- Die Regel bleibt: **keine Dateien über 100 MB** committen.

### Schritt 5: Sicherheitsregeln für Unreal (Vorschlag)

- Unreal nur von **epicgames.com** / **unrealengine.com** laden, Visual Studio nur von **visualstudio.microsoft.com**.
- Plugins und Modelle aus dem **Fab**-Marktplatz nur nach Absprache.
  Lizenz prüfen und Quelle in einer `QUELLEN.md` eintragen.
- Keine fremden Plugins oder Skripte ungeprüft ausführen.

---

## Reihenfolge (Meilensteine)

Jeder Schritt: bauen → auf deinem PC testen → speichern (Commit).

1. **Drache fliegt:** Drachen-Modell (GLB) importieren, Flugphysik nach C++ übertragen, Kamera, Tastatur und Gamepad
2. **Feuer und Landschaft:** Feuerstrahl (Niagara), Landschaft, Himmel, Wetter
3. **Dorf und zerstörbare Gebäude** (Chaos Destruction)
4. **Schlacht:** Armeen, Ragdolls, Drachenhorn
5. **Drachenreiter-Boss**
6. **Rüstung und Drachen-Editor**
7. **Höhle** (der Hort)
8. **Quests mit Geschichte**
9. **Regionen und Strategie-Modus**
10. **Mehrspieler**

---

## Was wir aus dem Browser-Spiel mitnehmen

- **Drache:** `public/models/dragon_scales.glb` – Unreal kann GLB (glTF) mit Skelett importieren.
- **Flugphysik:** `src/dragon/FlightPhysics.js` wird nach C++ übertragen.
  Die Zahlen bleiben gleich → **gleiches Fluggefühl**.
- **Foto-Texturen** (CC0 von Poly Haven, dürfen weiterverwendet werden).
- **Spielregeln und Zahlen:** Schlacht, Aufträge, Punkte, Ränge.

Nicht direkt übertragbar:

- **Töne:** Sie werden im Browser mit Code erzeugt. In Unreal baut man sie mit **MetaSounds** neu.
- **Shader** (Wasser, Himmel, Wolken): Unreal hat eigene, bessere.

### Technik-Notizen (für den Import)

- Unreal rechnet in **Zentimetern**, das GLB in **Metern**. Der Import rechnet das normalerweise
  selbst um. Danach die Grösse prüfen: ca. 35 m Spannweite = ca. 3500 Unreal-Einheiten.
- Achsen: Unreal hat **Z oben** und **X vorne**, glTF hat **Y oben** und den Kopf nach **−Z**.
  Der glTF-Import dreht das Modell um. Danach prüfen: Kopf zeigt nach vorne (+X).

---

## Ehrlich: Das wird schwierig

- Unreal ist gross und kompliziert. Am Anfang dauert alles länger.
- Claude sieht den Editor nicht. **Screenshots von dir** helfen sehr.
- Der Neubau braucht viele Sitzungen, bis er so viel kann wie das Browser-Spiel.
- Das Browser-Spiel bleibt die ganze Zeit spielbar.
