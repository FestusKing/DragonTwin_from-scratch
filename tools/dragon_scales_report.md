# Bericht: Drachen-Modell „Scales“ (Sintel) – Download

**Ergebnis: ABGEBROCHEN – der Download war nicht möglich.**
Es wurde nichts heruntergeladen, nichts installiert und nichts umgewandelt.

Datum der Prüfung: 24.09.2026, ca. 12:48 UTC

---

## 1. Was versucht wurde

Aufgerufene Adressen (nur HTTPS, nur offizielle Blender-Domains):

| Adresse | Ergebnis |
|---|---|
| https://studio.blender.org/characters/5d403c21ee3219164b952e20/v2/ | gesperrt (403) |
| https://studio.blender.org/characters/5d403c21ee3219164b952e20/v1/ | gesperrt (403) |
| https://studio.blender.org/ (Startseite) | gesperrt (403) |
| https://www.blender.org/ | gesperrt (403) |
| https://download.blender.org/ | gesperrt (403) |
| https://cloud.blender.org/ | gesperrt (403) |

Zum Vergleich funktionieren (Antwort 200):

- https://pypi.org/simple/bpy/ (für das Blender-Python-Paket)
- https://registry.npmjs.org/gltf-validator (für den Khronos-Validator)

## 2. Warum es nicht ging (genau)

- Die Fehlermeldung war: `CONNECT tunnel failed, response 403`.
- Das heisst: **Nicht die Blender-Webseite** hat abgelehnt, sondern der
  **Netzwerk-Filter der Cloud-Umgebung** (Proxy). Die Verbindung wurde gar
  nicht erst aufgebaut.
- Der Proxy meldet dazu: „gateway answered 403 to CONNECT (policy denial)“
  für `studio.blender.org:443`.
- Alle Blender-Domains sind betroffen, nicht nur eine.
- Gemäss Sicherheitsregel 1 wurde das **nicht umgangen** (keine Mirrors,
  keine anderen Seiten, keine Tricks am Proxy).

**Vermutliche Ursache:** Die neue Netzwerk-Einstellung der Umgebung ist in
dieser Sitzung noch nicht aktiv. Die Regeln werden meistens beim Start des
Containers geladen. Eine Änderung gilt dann erst für eine **neue Sitzung**.

## 3. Dateien, Prüfsummen, Dateityp-Prüfung

- Heruntergeladene Dateien: **keine**
- Dateigrösse / SHA256: – (nichts heruntergeladen)
- Dateityp-Prüfung (`file`, Magic-Bytes „BLENDER“ / ZIP): – (nichts zu prüfen)
- Text-Blöcke / Skripte in der .blend: – (keine Datei geöffnet)

## 4. Installationen

- **Keine.** `bpy` wurde nicht installiert, weil es ohne Modell nichts
  umzuwandeln gibt. `gltf-validator` wurde ebenfalls nicht gestartet.

## 5. Was exportiert wurde

- **Nichts.** Es gibt keine `public/models/dragon_scales.glb`,
  keine `QUELLEN.md`, keine Knochen-JSON und kein Umwandlungs-Skript.
- Einzige neue Datei: dieser Bericht.

## 6. Offene Punkte / nächste Schritte

1. **Netzwerk freigeben:** In den Einstellungen der Cloud-Umgebung
   (Umgebungs-Menü oben in der Sitzung → Bearbeiten → *Network access*)
   `studio.blender.org` erlauben (bei Bedarf auch `blender.org` bzw.
   `*.blender.org`, falls der Download über eine Unter-Domain läuft).
   Infos: https://code.claude.com/docs/en/claude-code-on-the-web
2. Danach eine **neue Sitzung** starten und den Auftrag wiederholen.
3. **Achtung Abo:** Auf Blender Studio sind viele Charakter-Downloads nur
   für zahlende Mitglieder freigeschaltet. Das konnte hier nicht geprüft
   werden. Falls der Download eine Anmeldung verlangt, muss der Auftrag
   laut Regel 1 wieder abgebrochen werden. Mögliche Lösung dann: das
   Modell selbst (mit eigenem Konto) herunterladen und bereitstellen, oder
   ein anderes frei verfügbares Modell (z. B. CC0/CC-BY) wählen.
