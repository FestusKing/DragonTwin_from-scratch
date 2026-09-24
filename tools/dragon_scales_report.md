# Bericht: Drachen-Modell „Scales“ (Sintel) – Download

**Ergebnis: ABGEBROCHEN – der Download geht nur mit Anmeldung (Login).**
Laut Sicherheitsregel 1 wurde das **nicht umgangen**.
Es wurde **kein Modell** heruntergeladen, **nichts installiert** und **nichts umgewandelt**.

Datum der Prüfung: 24.09.2026, ca. 12:51–12:53 UTC (2. Versuch)
Nochmals geprüft: 24.09.2026, 13:09 UTC (3. Versuch) – **gleiches Ergebnis**, siehe Abschnitt 6.

---

## 1. Kurz erklärt

- Beim 1. Versuch war die Blender-Seite durch den Netzwerk-Filter gesperrt.
  **Das ist jetzt gelöst:** `studio.blender.org` antwortet normal (HTTP 200).
- **Neues Problem:** Auf der Modell-Seite ist der Download-Knopf gesperrt.
  Dort steht: **„Login to Download“** (mit Schloss-Symbol).
- Das gilt für **beide** Versionen (v2 und v1).
- Regel 1 sagt: Anmeldung oder Abo nötig → **nicht umgehen, abbrechen**.
  Genau das wurde gemacht.

## 2. Geprüfte Adressen

Nur HTTPS, nur offizielle Blender-Domains. Es wurden nur Web-Seiten (HTML) gelesen.
Sie lagen nur im Arbeitsordner **ausserhalb** des Repos und wurden danach gelöscht.

| Adresse | Antwort | Was steht dort? |
|---|---|---|
| https://studio.blender.org/characters/5d403c21ee3219164b952e20/v2/ | 200 (56 KB) | Modell-Seite v2. Knopf „Login to Download“ (gesperrt) |
| https://studio.blender.org/characters/5d403c21ee3219164b952e20/v1/ | 200 (58 KB) | Modell-Seite v1. Knopf „Login to Download“ (gesperrt) |
| https://studio.blender.org/projects/sintel/ | 200 (54 KB) | Projekt-Seite Sintel. Kein freier Download des Modells |
| https://studio.blender.org/join/ | 200 (52 KB) | Abo-Seite. Zugang zu „production assets“ mit Abo |
| https://durian.blender.org/download/ | 200 (27 KB) | Offizielle Sintel-Download-Seite: nur Film, Trailer, Musik, Untertitel – **keine Modelle** |
| https://download.blender.org/durian/ | 200 (70 Bytes) | Keine Datei-Liste, nur „Please visit www.blender.org …“ |

## 3. Warum der Download nicht möglich ist (genau)

- Auf beiden Modell-Seiten ist der Knopf **deaktiviert** (`disabled`) und zeigt ein Schloss.
- Im HTML-Code gibt es für nicht angemeldete Besucher **keinen Download-Link**.
- Die Seite meldet selbst: Besucher ist **nicht angemeldet** (`"is_authenticated": false`).
- Die Abo-Seite (`/join/`) nennt bei den bezahlten Abos:
  „Full access to production assets“. Charaktere gehören zu diesen Assets.
  - monatlich: 17 $ pro Monat
  - alle drei Monate: 11.50 $ pro Monat
- **Vermutung:** Man braucht ein **Blender-ID-Konto mit bezahltem Abo**.
  Ob ein kostenloses Konto reicht, kann man ohne Konto nicht prüfen.

**Was bewusst NICHT gemacht wurde** (Regel 1):

- kein Konto angelegt, kein Login
- keine versteckten Download-Adressen erraten oder ausprobiert
- keine anderen Webseiten, keine Mirrors
- keine Tricks am Netzwerk-Filter

## 4. Infos zum Modell (von den Seiten abgelesen)

| Version | Für Blender | Veröffentlicht | Veröffentlicht von | Lizenz |
|---|---|---|---|---|
| v2 | 3.4 | 16.11.2022 | Beau Gerbrands | CC-BY 4.0 |
| v1 | 2.80 | 30.07.2019 | Andy Goralczyk | CC-BY 4.0 |

Nützlich für später (aus der Beschreibung von v2):

- Die Collection heisst **`CH-Dragon.Adult`**.
- Die Materialien sind schon **Principled BSDF** → passt gut zu glTF.
- Am Knochen **„Root“** gibt es einen Regler für die Detail-Stufe (max. 5)
  und einen Schalter **„dragon_low“** (auf 1 = einfaches Modell für Animation).
- Lizenz [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/):
  Teilen und Verändern ist erlaubt, aber man muss **Blender Studio / Blender Foundation nennen**.

## 5. Pflicht-Angaben aus dem Auftrag

| Punkt | Ergebnis |
|---|---|
| Heruntergeladene Modell-Datei | **keine** |
| Dateigrösse / SHA256 | – (keine Datei) |
| Dateityp-Prüfung (`file`, „BLENDER“ / ZIP) | – (nichts zu prüfen) |
| Text-Blöcke / Skripte in der .blend | – (keine Datei geöffnet) |
| Installationen | **keine** (`bpy` nicht installiert, `gltf-validator` nicht gestartet) |
| Exportiert (Meshes, Dreiecke, Knochen, Texturen, GLB) | **nichts** |
| Validator-Ergebnis | – (nichts zu prüfen) |

Geänderte Datei im Repo: **nur dieser Bericht**.
Es gibt also noch **keine** `public/models/dragon_scales.glb`, keine `QUELLEN.md`,
keine Knochen-JSON und kein Umwandlungs-Skript.

## 6. Alle Versuche

| Versuch | Zeit (UTC) | Ergebnis |
|---|---|---|
| 1 | ca. 12:48 | Netzwerk-Filter sperrte alle `*.blender.org`-Adressen (Proxy-Antwort 403). Inzwischen behoben. |
| 2 | ca. 12:51–12:53 | Seite erreichbar, aber „Login to Download“ bei v1 und v2 (siehe oben). |
| 3 | 13:09 | Gleich wie Versuch 2: v1 und v2 zeigen „Login to Download“, Besucher nicht angemeldet. Keine Anmelde-Daten in der Umgebung, nichts Neues im Repo. |

**Wichtig:** Nochmals versuchen hilft nicht. Das Problem ist kein Netzwerk-Fehler,
sondern eine **Anmelde-Pflicht**. Die Cloud-Sitzung hat kein Blender-Konto.
Erst wenn sich etwas ändert (siehe Abschnitt 7), kann es klappen.

## 7. Offene Punkte – Entscheidung nötig

**Möglichkeit A – Modell selbst mit eigenem Konto holen**

1. Auf https://studio.blender.org mit der eigenen Blender ID anmelden
   (vermutlich mit bezahltem Abo).
2. „Scales (adult dragon)“ **v2** herunterladen.
3. Die .blend-Datei **nicht** ins Repo legen (Regel 2).
4. Umwandeln auf dem eigenen Computer. Eine neue Sitzung kann dafür
   `tools/convert_dragon.py` schreiben und an einem Test-Modell prüfen.
5. Sicherheit beim Öffnen in Blender:
   - „Auto Run Python Scripts“ ist in Blender von Anfang an **aus**. So lassen.
   - Kommt eine Warnung zu Python-Skripten: **„Ignore“** wählen.
6. Die fertige GLB-Datei darf ins Repo (CC-BY 4.0), mit Namensnennung in
   `public/models/QUELLEN.md`.

**Möglichkeit B – anderes Drachen-Modell**

- Ein Modell wählen, das **ohne Anmeldung** frei verfügbar ist (Lizenz CC0 oder CC-BY).
- Dafür muss Regel 1 angepasst werden (sie erlaubt nur `*.blender.org`).

**Möglichkeit C – beim Drachen aus Code bleiben**

- Der bisherige Drache (Teil A, alles im Code) funktioniert weiter.
- Das Spiel braucht das Modell nicht, um zu laufen.
