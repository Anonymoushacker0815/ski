# Ski

Statische Webapp (HTML/CSS/JS, kein Build): deine Skigebiete auf einen Blick – Schneehöhe, offene Lifte und Pisten, 7-Tage-Wetter, Webcams und historischer Schneestand.

Beim ersten Besuch zeigt die Seite die 10 größten Skigebiete Österreichs (nach Pisten-km). Über das Suchfeld lassen sich beliebige Skigebiete aus dem LiftRadar-Bestand (ganz Europa) hinzufügen, mit ✕ entfernen und die Liste wieder auf die Top 10 zurücksetzen. Die Liste wird im `localStorage` des Browsers gespeichert.

Über „Anzeigen“ lässt sich statt der eigenen Liste ein Skipass wählen, z. B. der Kärntner Skipass, Dolomiti Superski, Ski amadé oder der Zillertaler Superskipass. Die Pässe kommen aus [LiftRadar](https://liftradar.eu/json/groups.json); der Kärntner Skipass ist in `app.js` (`CUSTOM_PASSES`) nach [kaerntner-skipass.com](https://www.kaerntner-skipass.com/skigebiete/) gepflegt. Einzelne Gebiete eines Passes lassen sich mit ＋ in die eigene Liste übernehmen. Jede Pass-Ansicht hat einen eigenen Link zum Teilen, z. B. `…/ski/#kaerntner-skipass`.

## Karte mit Liften und Pisten

Ein Klick auf „Lifte offen“ öffnet die Detailansicht: Karte (OpenTopoMap, wahlweise OpenStreetMap) mit dem Gebietsumriss, allen Pisten nach Schwierigkeit eingefärbt und allen Liften, dazu eine Liftliste mit Typ, Länge, Tal-/Bergstation, Förderleistung und Ausstattung. Ein Klick auf einen Lift zeigt ihn auf der Karte.

- Geometrie: [OpenSkiData](https://openskimap.org) (© OpenStreetMap-Mitwirkende, ODbL), von LiftRadar als Kacheln (`/ski/v1/10/x/y.json`) aufbereitet und jedem Gebiet zugeordnet; geladen werden die Kachel des Gebietspunkts und ihre 8 Nachbarn.
- Betrieb: LiftRadar meldet nur, wie viele Lifte je Typ offen sind (Gondelbahnen, Sessellifte, Schlepplifte, Förderbänder …), nicht welche. Die Karte leitet daraus ab: alle des Typs offen → grün, keiner → hellgrau (ebenso bei geschlossenem Gebiet), sonst schwarz als „unklar“ mit Hinweis in der Legende (z. B. „2 von 7 Sesselliften offen“).
- [Leaflet](https://leafletjs.com) 1.9.4 wird erst beim ersten Öffnen von cdnjs geladen (mit SRI-Prüfsumme).

## Webcams

Mit 📷 klappen Webcams in der Nähe eines Skigebiets auf. Die Zuordnung erzeugt `scripts/build_webcams.py` (Kameras bis 5 km um den Gebietspunkt, bis 12 km, wenn der Gebietsname im Kameranamen vorkommt) und schreibt sie nach `data/webcams.json`:

- **[Panomax](https://www.panomax.com):** 360°-Panoramen, direkt eingebettet. Aufnahmezeit und Archivbilder kommen aus der offenen Panomax-API; bei einem vergangenen Datum zeigt die Seite das Bild von ca. 12 Uhr. Klick öffnet die 360°-Ansicht bei Panomax.
- **[foto-webcam.eu](https://www.foto-webcam.eu):** nur als Link (die Bilder dürfen laut Betreiber nicht übernommen werden), historisch direkt ins Archiv um 12 Uhr.
- **[Windy](https://api.windy.com/webcams/docs):** größte Sammlung, u. a. feratel-Kameras (Nassfeld, Katschberg-Aineck, Gerlitzen, Serfaus-Fiss-Ladis …). Wird beim Aufklappen live abgefragt (Umkreis 5 km, max. 6 Bilder), weil die Bildadressen der Gratis-Stufe nur ca. 10 Minuten gelten. Nur aktuelle Bilder, kein Archiv. Laut [Nutzungsbedingungen](https://api.windy.com/webcams/terms) verlinkt jedes Bild auf die Windy-Seite der Kamera, die Bilder werden nicht größer als 400 px gezeigt und der Hinweis „Webcams provided by windy.com“ steht darunter. Der API-Schlüssel steht in `app.js` (`WINDY_KEY`) – bei einer statischen Seite zwangsläufig öffentlich; leer lassen schaltet Windy ab.

Zuordnung für Panomax und foto-webcam.eu neu erzeugen:

```bash
python3 scripts/build_webcams.py
```

Der GitHub-Workflow macht das bei jeder Erfassung mit.

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
- [GeoSphere Austria](https://data.hub.geosphere.at) (CC BY 4.0): gemessene Schneehöhe der TAWES-Wetterstationen. Meldet ein österreichisches Skigebiet keine Schneehöhe, zeigt die Seite den Naturschnee der nächsten Bergstation (ab 1400 m, höchstens 6 km entfernt, z. B. Kanzelhöhe für die Gerlitzen) statt des Modellwerts. Kunstschnee auf den Pisten ist darin nicht enthalten – offene Gebiete ohne Meldung bekommen deshalb den Hinweis „Piste: nicht gemeldet“.
