# Skigebiete Kärnten

Statische Webapp (HTML/CSS/JS, kein Build), die alle von LiftRadar erfassten Kärntner Skigebiete mit Schneehöhe, offenen Liften und Pisten zeigt.

Über das Suchfeld lassen sich beliebige weitere Skigebiete aus dem LiftRadar-Bestand (ganz Europa) hinzufügen und wieder entfernen; die Auswahl wird im `localStorage` des Browsers gespeichert.

## Starten

```bash
python3 -m http.server 8080
```

Dann http://localhost:8080 öffnen. `index.html` funktioniert auch direkt per Doppelklick (dann aber ohne die eigene Erfassung, weil der Browser `data/` per `file://` nicht laden darf).

## Historischer Schneestand

Über „Schneestand am“ lässt sich ein vergangenes Datum wählen. Die Werte kommen in dieser Reihenfolge aus:

1. **Eigene Erfassung** – `data/history/JJJJ-MM-TT.json`, ein täglicher Snapshot aller Skigebiete (Status, Schneehöhen, Lifte, Pisten).
2. **LiftRadar-Verlauf** – gemeldete Werte der letzten 365 Tage (Daten gibt es seit 24.10.2026).
3. **Open-Meteo-Archiv** – nur Modell-Schneehöhe und Neuschnee, dafür für jedes Datum ab 1940.

Snapshot von Hand speichern:

```bash
python3 scripts/record_snow.py
```

Täglich automatisch erfassen (macOS-LaunchAgent, läuft um 09:30 und 14:30; Log in `data/recorder.log`):

```bash
sh scripts/install_recorder.sh
```

Wieder entfernen:

```bash
sh scripts/install_recorder.sh --uninstall
```

Ein Snapshot ist ca. 120 KB groß (alle ~930 Skigebiete), also rund 45 MB pro Jahr.

## Online (GitHub Pages)

`.github/workflows/snow.yml` erledigt beides in der Cloud:

- **Erfassen:** täglich um 08:30 und 13:30 UTC (09:30/14:30 Winterzeit) `scripts/record_snow.py` ausführen und den Snapshot nach `data/history/` committen.
- **Veröffentlichen:** nach jeder Erfassung und bei jedem Push auf `main` die Seite auf GitHub Pages deployen.

Manuell starten: im Repo unter *Actions → Schnee erfassen & Seite veröffentlichen → Run workflow*.
Lokal die neuesten Snapshots holen: `git pull`.

## Datenquellen

- [LiftRadar](https://liftradar.eu/api): offenes JSON ohne API-Key (Status, Schneehöhen, Lifte, Pisten, Verlauf). Die Daten werden ca. um 08:40 und 13:40 aktualisiert.
- [Open-Meteo](https://open-meteo.com): 7-Tage-Wetterprognose pro Gebiet (Temperatur max/min, Sonnenstunden, Niederschlag und Wahrscheinlichkeit, Neuschnee, Wind und Böen) und Modell-Schneehöhe als Fallback (mit „≈“ markiert), wenn ein Gebiet selbst keine meldet. Für vergangene Tage das [Archiv](https://open-meteo.com/en/docs/historical-weather-api).
