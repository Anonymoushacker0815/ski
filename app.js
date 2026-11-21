(function () {
  "use strict";

  const LIFTRADAR = "https://liftradar.eu";
  const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
  const FORECAST_DAYS = 7;

  // Startliste beim ersten Besuch: die 10 größten Skigebiete Österreichs nach Pisten-km (LiftRadar, Nov. 2026)
  const DEFAULT_LIST = [
    "at/ski-arlberg",
    "at/skiwelt",
    "at/skicircus-saalbach",
    "at/ischgl-silvretta-arena",
    "at/kitzbuehel",
    "at/serfaus-fiss-ladis",
    "at/zillertal-arena",
    "at/silvretta-montafon",
    "at/soelden",
    "at/mayrhofen",
  ];
  const LIST_KEY = "ski.list";
  const VIEW_KEY = "ski.view";

  // Skipässe, die LiftRadar nicht als Gruppe führt (weitere kommen aus liftradar.eu/json/groups.json)
  const CUSTOM_PASSES = [
    {
      id: "kaerntner-skipass",
      name: "Kärntner Skipass",
      kind: "region",
      website: "https://www.kaerntner-skipass.com/skigebiete/",
      // Mitgliedsgebiete laut kaerntner-skipass.com (Stand Nov. 2026), zugeordnet zu LiftRadar
      members: [
        "at/ankogel-mallnitz",
        "at/bad-kleinkirchheim",
        "at/dreilaendereck",
        "at/gerlitzen",
        "at/goldeck",
        "at/heiligenblut",
        "at/dorfberg-kartitsch",
        "at/katschberg-aineck",
        "at/klippitztoerl",
        "at/koralpe",
        "at/lienz-zettersfeld-hochstein",
        "at/grossglockner-resort-kals-matrei",
        "at/moelltaler-gletscher",
        "at/nassfeld",
        "at/obertilliacher-bergbahnen",
        "at/petzen",
        "at/bichllifte-praegraten",
        "at/skizentrum-sillian-hochpustertal",
        "at/simonhoehe",
        "at/skizentrum-st-jakob",
        "at/turracher-hoehe",
        "at/weissensee",
      ],
      // im Pass enthalten, aber ohne Daten bei LiftRadar
      missing: [
        "Bodental", "Emberger Alm", "Flattnitz", "Heidi-Alm Falkert", "Hochrindl",
        "Skieldorado Hrast", "Kötschach-Mauthen", "Weinebene", "Weißbriach/Gitschtal",
      ],
    },
  ];

  const STATUS = {
    open: { label: "Geöffnet", rank: 0 },
    closed: { label: "Geschlossen", rank: 1 },
    no_report: { label: "Kein Bericht", rank: 2 },
    unknown: { label: "Keine Meldung", rank: 3 }, // historisch: für den Tag nichts gemeldet
  };

  // Ab wann es gemeldete Verlaufsdaten bei LiftRadar gibt (365 Tage rollierend)
  const LIFTRADAR_HISTORY_DAYS = 366;
  // Open-Meteo-Archiv (Modell) reicht bis 1940 zurück
  const ARCHIVE_MIN = "1940-01-01";
  const OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

  // Gemessene Naturschneehöhe, wenn ein österreichisches Skigebiet selbst keine meldet:
  // GeoSphere-Austria-Bergstationen (TAWES, CC BY 4.0) ab 1400 m, höchstens 6 km entfernt
  const GEOSPHERE = "https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min";
  const STATION_MIN_ALT = 1400; // Talstationen sagen über den Schnee am Berg wenig
  const STATION_MAX_KM = 6;

  // Webcams: Zuordnung Skigebiet -> Kameras kommt aus data/webcams.json (scripts/build_webcams.py).
  // Panomax-Panoramen werden eingebettet (Aufnahmezeit und Archiv über die offene API),
  // foto-webcam.eu nur verlinkt (deren Bilder dürfen nicht übernommen werden).
  const PANOMAX_API = "https://api.panomax.com/1.0";
  const PANOMAX_LIVE = "https://live-image.panomax.com/cams";
  // Windy-Webcams (u. a. feratel-Kameras): werden beim Aufklappen live abgefragt, weil die
  // Bildadressen in der Gratis-Stufe nur ~10 Minuten gelten. Der Schlüssel ist zwangsläufig
  // öffentlich (statische Seite). Leer = Windy aus.
  const WINDY_KEY = "rcuSqjkSoPQBEPssI4TafzJrHoe7iGV0";
  const WINDY_API = "https://api.windy.com/webcams/api/v3/webcams";
  const WINDY_RADIUS_KM = 5;
  const WINDY_MAX = 6;
  const WINDY_TTL = 8 * 60 * 1000;

  // WMO-Wettercodes (Open-Meteo) -> Symbol + Text
  const WMO = [
    [[0], "☀️", "Klar"],
    [[1], "🌤️", "Überwiegend sonnig"],
    [[2], "⛅", "Teils bewölkt"],
    [[3], "☁️", "Bewölkt"],
    [[45, 48], "🌫️", "Nebel"],
    [[51, 53, 55], "🌦️", "Nieselregen"],
    [[56, 57], "🌧️", "Gefrierender Nieselregen"],
    [[61, 63, 65], "🌧️", "Regen"],
    [[66, 67], "🌧️", "Gefrierender Regen"],
    [[71, 73, 75], "🌨️", "Schneefall"],
    [[77], "🌨️", "Schneegriesel"],
    [[80, 81, 82], "🌦️", "Regenschauer"],
    [[85, 86], "🌨️", "Schneeschauer"],
    [[95], "⛈️", "Gewitter"],
    [[96, 99], "⛈️", "Gewitter mit Hagel"],
  ];

  const els = {
    rows: document.getElementById("resort-rows"),
    summary: document.getElementById("summary"),
    dataTime: document.getElementById("data-time"),
    error: document.getElementById("error"),
    onlyOpen: document.getElementById("only-open"),
    showWeather: document.getElementById("show-weather"),
    sort: document.getElementById("sort"),
    reload: document.getElementById("reload"),
    search: document.getElementById("search"),
    searchResults: document.getElementById("search-results"),
    searchHint: document.getElementById("search-hint"),
    histDate: document.getElementById("hist-date"),
    histChips: document.getElementById("hist-chips"),
    histInfo: document.getElementById("hist-info"),
    lastColHead: document.getElementById("last-col-head"),
    view: document.getElementById("view"),
    passInfo: document.getElementById("pass-info"),
    detail: document.getElementById("detail"),
  };

  const state = {
    all: [], // alle Skigebiete von LiftRadar (Europa)
    resorts: [], // angezeigte Skigebiete (eigene Liste oder Skipass)
    list: new Set(loadList() || DEFAULT_LIST), // Schlüssel "land/id" der eigenen Liste
    passes: [], // { id, name, kind, website, members: [...], missing: [...] }
    view: "list", // "list" = eigene Liste, sonst Skipass-id
    details: {}, // Schlüssel -> volle Einzelmeldung (LiftRadar)
    weather: {}, // Schlüssel -> { snowCm, elevation, tempNow, days: [...] }
    expanded: new Set(), // Schlüssel mit aufgeklappter Prognose
    generatedAt: null,

    // Historischer Schneestand
    histDate: null, // "JJJJ-MM-TT" oder null = aktuell
    histLoading: false,
    ownIndex: undefined, // { dates: [...] } aus data/history/index.json, null = keine Erfassung
    ownDays: {}, // Datum -> eigener Snapshot (oder null)
    lrHistory: {}, // Schlüssel -> LiftRadar-Verlauf (Spalten) oder null
    archive: {}, // Datum -> { Schlüssel -> { snowCm, snowfallCm, elevation } }

    // Webcams
    webcams: null, // { cams: { id -> Kamera }, resorts: { Schlüssel -> [[id, km], ...] } }
    camsOpen: new Set(), // Schlüssel mit aufgeklappten Webcams
    camData: {}, // "camId|live" bzw. "camId|JJJJ-MM-TT" -> { date, time, small, opt, reduced } oder null
    camStamp: 0, // 5-Minuten-Takt, damit "Aktualisieren" frische Livebilder holt
    windy: {}, // Schlüssel -> { t, cams: [...], error } (Windy, nur aktuell)

    // Messstationen (Naturschnee)
    stations: null, // GeoSphere-Bergstationen (Metadaten)
    stationOf: {}, // Schlüssel -> { id, name, alt, km } oder null
    stationSnow: {}, // Stations-id -> { cm, time } oder null
  };

  // Eindeutiger Schlüssel pro Skigebiet (auch Adresse der Einzelmeldung)
  const key = (r) => `${r.country}/${r.id}`;
  const inList = (r) => state.list.has(key(r));

  // Gespeicherte Liste; null = noch nie geändert (dann gilt die Startliste)
  function loadList() {
    try {
      const raw = localStorage.getItem(LIST_KEY);
      if (raw == null) return null;
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
    } catch (_) {
      return null;
    }
  }
  function saveList() {
    try { localStorage.setItem(LIST_KEY, JSON.stringify([...state.list])); } catch (_) { /* egal */ }
  }
  const isDefaultList = () =>
    state.list.size === DEFAULT_LIST.length && DEFAULT_LIST.every((k) => state.list.has(k));

  // ---------- Ansicht: eigene Liste oder Skipass ----------

  const currentPass = () => state.passes.find((p) => p.id === state.view) || null;

  // Skigebiete der aktuellen Ansicht neu bestimmen
  function refreshResorts() {
    const pass = currentPass();
    const keys = pass ? new Set(pass.members) : state.list;
    state.resorts = state.all.filter((r) => keys.has(key(r)));
    if (els.showWeather.checked) state.resorts.forEach((r) => state.expanded.add(key(r)));
  }

  // Details, Wetter und ggf. Verlauf für Gebiete nachladen, die noch fehlen
  async function ensureData(list) {
    const need = list.filter((r) => !state.details[key(r)] || !state.weather[key(r)]);
    await Promise.all([
      need.length ? loadDetails(need) : null,
      need.length ? loadWeather(need) : null,
      loadStationSnow(list),
      loadHistory(list),
    ]);
  }

  async function loadPasses() {
    let groups = {};
    try {
      groups = (await getJSON(`${LIFTRADAR}/json/groups.json`)).groups || {};
    } catch (err) {
      console.warn("Skipass-Gruppen nicht ladbar:", err);
    }
    const fromLR = Object.entries(groups).map(([id, g]) => ({
      id, name: g.name, kind: g.kind, website: g.website, members: g.members || [], missing: [],
    }));
    state.passes = [...CUSTOM_PASSES, ...fromLR.filter((p) => !CUSTOM_PASSES.some((c) => c.id === p.id))];
    buildViewSelect();
  }

  function passCountries(p) {
    return [...new Set(p.members.map((m) => m.split("/")[0]))].map(countryName).join(", ");
  }

  function buildViewSelect() {
    // Österreich zuerst, dann alphabetisch; eigene Pässe ganz oben
    const rank = (p) => (CUSTOM_PASSES.some((c) => c.id === p.id) ? 0
      : p.members.some((m) => m.startsWith("at/")) ? 1 : 2);
    const sortP = (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "de");
    const opt = (p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(passCountries(p))}</option>`;
    const passes = state.passes.filter((p) => p.kind !== "linked").sort(sortP);
    const linked = state.passes.filter((p) => p.kind === "linked").sort(sortP);
    els.view.innerHTML =
      '<option value="list">Meine Liste</option>' +
      (passes.length ? `<optgroup label="Skipässe">${passes.map(opt).join("")}</optgroup>` : "") +
      (linked.length ? `<optgroup label="Verbundene Skigebiete">${linked.map(opt).join("")}</optgroup>` : "");
    els.view.value = state.view;
  }

  // Ansicht wechseln; merkt sich die Wahl und schreibt sie in die Adresse (#pass-id) zum Teilen
  async function setView(view, { remember = true } = {}) {
    if (view !== "list" && !state.passes.some((p) => p.id === view)) view = "list";
    state.view = view;
    els.view.value = view;
    if (remember) storageSet(VIEW_KEY, view);
    const hash = view === "list" ? "" : `#${view}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", location.pathname + location.search + hash);
    }
    refreshResorts();
    render();
    searchHint();
    await ensureData(state.resorts);
    if (state.view === view) render();
  }

  function renderPassInfo() {
    const pass = currentPass();
    if (!pass) { els.passInfo.hidden = true; els.passInfo.innerHTML = ""; return; }
    const shown = state.resorts.length;
    const unknownKeys = pass.members.filter((k) => !state.all.some((r) => key(r) === k));
    const missing = [...pass.missing, ...unknownKeys];
    const notInList = state.resorts.filter((r) => !inList(r)).length;
    els.passInfo.hidden = false;
    els.passInfo.innerHTML =
      `<strong>${esc(pass.name)}</strong>: ${shown} ${shown === 1 ? "Skigebiet" : "Skigebiete"} mit Live-Daten` +
      (pass.website ? ` · <a href="${esc(pass.website)}" target="_blank" rel="noopener">Website</a>` : "") +
      (notInList
        ? ` · <button type="button" class="link-btn" data-action="add-all">Alle ${notInList} zu meiner Liste hinzufügen</button>`
        : ` · <span class="muted">Alle sind in deiner Liste.</span>`) +
      (missing.length
        ? `<br><span class="muted">Ebenfalls im Pass, aber ohne Daten: ${esc(missing.join(", "))}.</span>`
        : "");
  }

  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["de"], { type: "region" }); } catch (_) { /* alter Browser */ }
  function countryName(code) {
    try { return (regionNames && regionNames.of(code.toUpperCase())) || code.toUpperCase(); }
    catch (_) { return code.toUpperCase(); }
  }
  function placeLabel(r) {
    return [r.region, countryName(r.country)].filter(Boolean).join(", ");
  }

  // ---------- Hilfsfunktionen ----------

  const nf = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 1 });
  const fmt = (n) => (n == null ? "–" : nf.format(n));
  const fmtTemp = (t) => (t == null ? "–" : `${Math.round(t)}°`);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function wmo(code) {
    const e = WMO.find(([codes]) => codes.includes(code));
    return e ? { icon: e[1], label: e[2] } : { icon: "❔", label: "Unbekannt" };
  }

  function fmtDateTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleString("de-AT", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      timeZone: "Europe/Vienna",
    });
  }

  function fmtSnowfall(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate + "T12:00:00");
    if (isNaN(d)) return null;
    const days = Math.round((Date.now() - d.getTime()) / 86400000);
    const rel = days <= 0 ? "heute" : days === 1 ? "gestern" : `vor ${days} Tagen`;
    const date = d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
    return { date, rel };
  }

  function dayLabel(isoDate, i) {
    const d = new Date(isoDate + "T12:00:00");
    const name = i === 0 ? "Heute" : i === 1 ? "Morgen"
      : d.toLocaleDateString("de-AT", { weekday: "short" });
    const date = d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
    return { name, date };
  }

  // Windrichtung (woher der Wind kommt) -> Himmelsrichtung
  function compass(deg) {
    if (deg == null) return null;
    return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
  }

  // Böen ab 60 km/h: viele Seilbahnen schränken den Betrieb ein
  const STRONG_GUST = 60;

  function windHTML(d) {
    if (d.wind == null) return '<div class="wx-wind none">–</div>';
    const dir = compass(d.windDir);
    // Pfeil zeigt, wohin der Wind weht
    const arrow = d.windDir != null
      ? `<span class="wx-arrow" style="transform:rotate(${Math.round(d.windDir)}deg)" aria-hidden="true">↓</span>`
      : "💨";
    const strong = d.gust != null && d.gust >= STRONG_GUST;
    const title = `Wind${dir ? " aus " + dir : ""}: bis ${Math.round(d.wind)} km/h` +
      (d.gust != null ? `, Böen bis ${Math.round(d.gust)} km/h` : "");
    return `<div class="wx-wind${strong ? " strong" : ""}" title="${esc(title)}">
        ${arrow} ${fmt(Math.round(d.wind))} <small>km/h</small>
        ${d.gust != null ? `<small class="wx-gust">Böen ${fmt(Math.round(d.gust))}</small>` : ""}
      </div>`;
  }

  // Sekunden -> Stunden mit einer Nachkommastelle
  const hours = (sec) => (sec == null ? null : Math.round(sec / 360) / 10);

  function sunHTML(d) {
    const h = hours(d.sun);
    if (h == null) return '<div class="wx-sun none">–</div>';
    const day = hours(d.daylight);
    const title = `${fmt(h)} Sonnenstunden` + (day != null ? ` von ${fmt(day)} h Tageslicht` : "");
    return `<div class="wx-sun${h < 0.5 ? " none" : ""}" title="${esc(title)}">
        ☀ ${fmt(h)} <small>h</small>
      </div>`;
  }

  function pct(open, total) {
    if (open == null || !total) return 0;
    return Math.max(0, Math.min(100, (open / total) * 100));
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* egal */ }
  }

  async function getJSON(url) {
    // "no-cache" = Browser fragt mit ETag nach, unveränderte Dateien kosten nichts.
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} bei ${url}`);
    return res.json();
  }

  // Modell-Schneehöhe: aktuell aus der Prognose, historisch aus dem Archiv
  const modelOf = (r) => (r.hist ? r.hist.model : state.weather[key(r)]) || null;

  // Gemeldete Schneehöhe Berg, sonst gemessener Naturschnee, sonst Modellwert (für Sortierung)
  function snowValue(r) {
    if (r.snow && r.snow.mountain_cm != null) return r.snow.mountain_cm;
    const st = stationSnowOf(r);
    if (st) return st.cm;
    const m = modelOf(r);
    return m && m.snowCm != null ? m.snowCm : null;
  }

  // ---------- Gemessener Naturschnee (GeoSphere Austria) ----------

  // "KANZELHOEHE" -> "Kanzelhöhe", "HAHNENKAMM/EHRENBACHHOEHE" -> "Hahnenkamm/Ehrenbachhöhe"
  const stationName = (s) =>
    String(s || "").toLowerCase()
      .replace(/(^|[^aeiou])oe/g, "$1ö").replace(/(^|[^aeiou])ue/g, "$1ü")
      .replace(/(^|[\s/(.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

  async function loadStationSnow(list) {
    const at = list.filter((r) => r.country === "at" && r.location);
    if (!at.length) return;
    try {
      if (!state.stations) {
        const meta = await getJSON(`${GEOSPHERE}/metadata`);
        state.stations = (meta.stations || []).filter((s) => s.is_active && s.altitude >= STATION_MIN_ALT);
      }
      for (const r of at) {
        const k = key(r);
        if (k in state.stationOf) continue;
        let best = null;
        let bestKm = STATION_MAX_KM;
        for (const s of state.stations) {
          const km = distKm(r.location, s);
          if (km <= bestKm) { best = s; bestKm = km; }
        }
        state.stationOf[k] = best
          ? { id: String(best.id), name: stationName(best.name), alt: best.altitude, km: bestKm }
          : null;
      }
      const ids = [...new Set(at.map((r) => state.stationOf[key(r)]).filter(Boolean).map((s) => s.id))]
        .filter((id) => !(id in state.stationSnow));
      if (!ids.length) return;
      const d = await getJSON(`${GEOSPHERE}?parameters=SCHNEE&station_ids=${ids.join(",")}`);
      const time = d.timestamps ? d.timestamps[d.timestamps.length - 1] : null;
      for (const f of d.features || []) {
        const p = f.properties || {};
        const data = p.parameters && p.parameters.SCHNEE ? p.parameters.SCHNEE.data : null;
        const v = data && data.length ? data[data.length - 1] : null;
        state.stationSnow[String(p.station)] = v != null && v >= 0 ? { cm: Math.round(v), time } : null;
      }
      for (const id of ids) if (!(id in state.stationSnow)) state.stationSnow[id] = null;
    } catch (err) {
      // Messwerte sind ein Zusatz – sonst bleibt der Modellwert
      console.warn("GeoSphere-Stationen nicht erreichbar:", err);
    }
  }

  // Aktuelle Messung der zugeordneten Station (historisch nicht)
  function stationSnowOf(r) {
    if (r.hist) return null;
    const s = state.stationOf[key(r)];
    const v = s ? state.stationSnow[s.id] : null;
    return v ? { ...s, ...v } : null;
  }

  // Neuschnee: aktuell Summe der 7-Tage-Prognose, historisch der Neuschnee des Tages (cm)
  function newSnow(r) {
    if (r.hist) return r.hist.model ? r.hist.model.snowfallCm : null;
    const w = state.weather[key(r)];
    if (!w || !w.days.length) return null;
    return w.days.reduce((s, d) => s + (d.snow || 0), 0);
  }

  // ---------- Historischer Schneestand ----------
  // Reihenfolge der Quellen für einen Tag:
  //   1. eigene Erfassung (data/history/JJJJ-MM-TT.json, scripts/record_snow.py)
  //   2. LiftRadar-Verlauf (gemeldete Werte, letzte 365 Tage)
  //   3. Open-Meteo-Archiv (Modell, ab 1940) – nur Schneehöhe und Neuschnee

  const viennaDay = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
  const todayStr = () => viennaDay(Date.now());
  const fmtDay = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

  function shiftDate(iso, days, years) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y + (years || 0), m - 1, d + (days || 0))).toISOString().slice(0, 10);
  }

  const HIST_FIELDS = [
    "status", "mountain_cm", "valley_cm", "fresh_cm",
    "lifts_open", "lifts_total", "slopes_open", "slopes_total", "slopes_open_km",
  ];

  async function loadOwnIndex() {
    try {
      const idx = await getJSON("data/history/index.json");
      state.ownIndex = idx && Array.isArray(idx.dates) ? idx : null;
    } catch (_) {
      state.ownIndex = null; // keine Erfassung vorhanden (oder Seite per file:// geöffnet)
    }
  }

  async function loadOwnDay(day) {
    if (day in state.ownDays) return;
    const has = state.ownIndex && state.ownIndex.dates.includes(day);
    state.ownDays[day] = has ? await getJSON(`data/history/${day}.json`).catch(() => null) : null;
  }

  async function loadLiftradarHistory(list, day) {
    const age = (Date.parse(todayStr()) - Date.parse(day)) / 86400000;
    if (age > LIFTRADAR_HISTORY_DAYS) return; // so weit reicht der Verlauf nicht zurück
    const todo = list.filter((r) => !(key(r) in state.lrHistory));
    const results = await Promise.allSettled(
      todo.map((r) => getJSON(`${LIFTRADAR}/history/${key(r)}.json`))
    );
    results.forEach((res, i) => {
      const runs = res.status === "fulfilled" ? res.value.runs : null;
      if (runs && runs.time) runs.day = runs.time.map(viennaDay); // einmal umrechnen
      state.lrHistory[key(todo[i])] = runs;
    });
  }

  // Stand am Ende des Tages; fehlende Werte aus früheren Läufen desselben Tages ergänzen
  function lrRecord(k, day) {
    const runs = state.lrHistory[k];
    if (!runs || !runs.day) return null;
    let rec = null;
    runs.day.forEach((d, i) => {
      if (d !== day) return;
      rec = rec || {};
      rec.time = runs.time[i];
      for (const f of HIST_FIELDS) {
        const v = runs[f] ? runs[f][i] : null;
        if (v != null) rec[f] = v;
      }
    });
    return rec;
  }

  async function loadArchive(list, day) {
    const cache = (state.archive[day] = state.archive[day] || {});
    const todo = list.filter((r) => r.location && !(key(r) in cache));
    if (!todo.length) return;
    const params = new URLSearchParams({
      latitude: todo.map((r) => r.location.lat).join(","),
      longitude: todo.map((r) => r.location.lon).join(","),
      start_date: day,
      end_date: day,
      daily: "snow_depth_mean,snowfall_sum",
      timezone: "auto",
    });
    try {
      let data = await getJSON(`${OPEN_METEO_ARCHIVE}?${params}`);
      if (!Array.isArray(data)) data = [data];
      data.forEach((loc, i) => {
        const dy = (loc && loc.daily) || {};
        const depth = dy.snow_depth_mean ? dy.snow_depth_mean[0] : null;
        const fall = dy.snowfall_sum ? dy.snowfall_sum[0] : null;
        cache[key(todo[i])] = {
          snowCm: depth != null ? Math.round(depth * 100) : null,
          snowfallCm: fall,
          elevation: loc ? loc.elevation : null,
        };
      });
    } catch (err) {
      console.warn("Open-Meteo-Archiv nicht erreichbar:", err);
    }
  }

  async function loadHistory(list) {
    const day = state.histDate;
    if (!day) return;
    await Promise.all([loadOwnDay(day), loadLiftradarHistory(list, day), loadArchive(list, day)]);
  }

  // Skigebiet so, wie es am gewählten Tag gemeldet war
  function histView(r) {
    const day = state.histDate;
    const k = key(r);
    const ownDay = state.ownDays[day];
    const own = ownDay && ownDay.resorts ? ownDay.resorts[k] : null;
    const rec = own || lrRecord(k, day);
    const model = state.archive[day] ? state.archive[day][k] : null;
    const val = (f) => (rec && rec[f] != null ? rec[f] : null);
    return {
      ...r,
      status: val("status") || "unknown",
      snow: { mountain_cm: val("mountain_cm"), valley_cm: val("valley_cm") },
      lifts: val("lifts_total") != null ? { open: val("lifts_open"), total: val("lifts_total") } : null,
      slopes: rec
        ? {
            open: val("slopes_open"),
            total: val("slopes_total"),
            open_km: val("slopes_open_km"),
            total_km: r.slopes ? r.slopes.total_km : null,
          }
        : null,
      hist: {
        source: own ? "own" : rec ? "liftradar" : model && model.snowCm != null ? "model" : "none",
        time: rec ? rec.time : null,
        model,
      },
    };
  }

  async function setDate(day) {
    const today = todayStr();
    if (!day || day >= today) {
      state.histDate = null;
      state.histLoading = false;
      els.histDate.value = today;
      render();
      return;
    }
    if (day < ARCHIVE_MIN) day = ARCHIVE_MIN;
    state.histDate = day;
    els.histDate.value = day;
    state.histLoading = true;
    render();
    await loadHistory(state.resorts);
    if (state.histDate !== day) return; // inzwischen anderes Datum gewählt
    state.histLoading = false;
    render();
  }

  // ---------- Daten laden ----------

  async function load() {
    els.reload.disabled = true;
    els.error.hidden = true;
    els.dataTime.textContent = "Lade Daten …";

    try {
      const [index] = await Promise.all([
        getJSON(`${LIFTRADAR}/json/index.json`),
        state.passes.length ? null : loadPasses(),
      ]);
      state.generatedAt = index.generated_at;
      state.all = index.resorts;

      // Ansicht: Adresse (#pass-id, z. B. geteilter Link) vor gespeicherter Wahl
      const wanted = decodeURIComponent(location.hash.slice(1)) || storageGet(VIEW_KEY) || "list";
      state.view = state.passes.some((p) => p.id === wanted) ? wanted : "list";
      els.view.value = state.view;
      refreshResorts();
      els.search.disabled = false;
      searchIndex = null; // neu aufbauen mit frischen Daten
      searchHint();
      state.camStamp = Math.floor(Date.now() / 300000);
      state.windy = {};
      state.stationSnow = {};
      for (const k of Object.keys(state.camData)) if (k.endsWith("|live")) delete state.camData[k];
      render();

      // Details, Wetter, Webcams und (falls ein Datum gewählt ist) Verlauf parallel nachladen
      state.ownDays = {};
      state.lrHistory = {};
      await Promise.all([
        loadDetails(state.resorts),
        loadWeather(state.resorts),
        loadStationSnow(state.resorts),
        loadWebcams(),
        loadOwnIndex().then(() => loadHistory(state.resorts)),
      ]);
      state.histLoading = false;
      render();
    } catch (err) {
      console.error(err);
      els.error.textContent =
        "Die Daten konnten nicht geladen werden. Bitte später erneut versuchen. (" + err.message + ")";
      els.error.hidden = false;
      if (!state.resorts.length) {
        els.rows.innerHTML = '<tr class="placeholder"><td colspan="6">Keine Daten verfügbar.</td></tr>';
      }
    } finally {
      els.reload.disabled = false;
    }
  }

  async function loadDetails(list) {
    const results = await Promise.allSettled(
      list.map((r) => getJSON(`${LIFTRADAR}/json/${key(r)}.json`))
    );
    results.forEach((res, i) => {
      if (res.status === "fulfilled") state.details[key(list[i])] = res.value;
    });
  }

  // Ein Aufruf für alle Gebiete: aktuelle Modell-Schneehöhe + 7-Tage-Prognose
  async function loadWeather(list) {
    const withLoc = list.filter((r) => r.location);
    if (!withLoc.length) return;
    const params = new URLSearchParams({
      latitude: withLoc.map((r) => r.location.lat).join(","),
      longitude: withLoc.map((r) => r.location.lon).join(","),
      current: "snow_depth,temperature_2m,wind_speed_10m,wind_gusts_10m",
      daily: [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "precipitation_probability_max",
        "snowfall_sum",
        "wind_speed_10m_max",
        "wind_gusts_10m_max",
        "wind_direction_10m_dominant",
        "sunshine_duration",
        "daylight_duration",
      ].join(","),
      forecast_days: String(FORECAST_DAYS),
      timezone: "auto", // Ortszeit je Gebiet (wichtig für hinzugefügte, z. B. Finnland)
    });
    try {
      let data = await getJSON(`${OPEN_METEO}?${params}`);
      if (!Array.isArray(data)) data = [data];
      data.forEach((loc, i) => {
        if (!loc) return;
        const cur = loc.current || {};
        const dy = loc.daily || {};
        const days = (dy.time || []).map((date, j) => ({
          date,
          code: dy.weather_code?.[j],
          tmax: dy.temperature_2m_max?.[j],
          tmin: dy.temperature_2m_min?.[j],
          precip: dy.precipitation_sum?.[j],
          prob: dy.precipitation_probability_max?.[j],
          snow: dy.snowfall_sum?.[j],
          wind: dy.wind_speed_10m_max?.[j],
          gust: dy.wind_gusts_10m_max?.[j],
          windDir: dy.wind_direction_10m_dominant?.[j],
          sun: dy.sunshine_duration?.[j], // Sekunden
          daylight: dy.daylight_duration?.[j], // Sekunden
        }));
        state.weather[key(withLoc[i])] = {
          snowCm: cur.snow_depth != null ? Math.round(cur.snow_depth * 100) : null,
          tempNow: cur.temperature_2m,
          windNow: cur.wind_speed_10m,
          gustNow: cur.wind_gusts_10m,
          elevation: loc.elevation,
          days,
        };
      });
    } catch (err) {
      // Wetter ist ein Zusatz – ohne läuft die Seite weiter.
      console.warn("Open-Meteo nicht erreichbar:", err);
    }
  }

  // ---------- Darstellung ----------

  function sorted(list) {
    const by = els.sort.value;
    const byName = (a, b) => a.name.localeCompare(b.name, "de");
    const desc = (get) => (a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return byName(a, b);
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va || byName(a, b);
    };
    const cmp = {
      name: byName,
      status: (a, b) =>
        (STATUS[a.status]?.rank ?? 9) - (STATUS[b.status]?.rank ?? 9) ||
        desc((r) => (r.lifts ? r.lifts.open : null))(a, b),
      snow: desc(snowValue),
      newsnow: desc(newSnow),
      lifts: desc((r) => (r.lifts ? r.lifts.open : null)),
      slopes: desc((r) => (r.slopes ? r.slopes.open_km : null)),
    }[by] || byName;
    return [...list].sort(cmp);
  }

  function render() {
    const hist = !!state.histDate;
    const view = hist ? state.resorts.map(histView) : state.resorts;
    renderHeader();
    renderPassInfo();
    renderHistory(view);
    renderSummary(view);
    els.lastColHead.textContent = hist ? "Neuschnee am Tag" : "Letzter Schneefall";

    if (hist && state.histLoading) {
      els.rows.innerHTML =
        `<tr class="placeholder"><td colspan="6">Lade Schneestand vom ${esc(fmtDay(state.histDate))} …</td></tr>`;
      return;
    }
    if (!state.resorts.length && state.all.length && state.view === "list") {
      els.rows.innerHTML = `<tr class="placeholder"><td colspan="6">
          Deine Liste ist leer. Oben ein Skigebiet suchen und hinzufügen –
          oder <button type="button" class="link-btn" data-action="reset-list">die 10 größten Gebiete Österreichs laden</button>.
        </td></tr>`;
      return;
    }
    const list = sorted(view.filter((r) => !els.onlyOpen.checked || r.status === "open"));
    if (!list.length) {
      const msg = !els.onlyOpen.checked ? "Keine Skigebiete gefunden."
        : hist ? "An diesem Tag war laut Meldungen kein Skigebiet geöffnet."
        : "Derzeit ist kein Skigebiet geöffnet.";
      els.rows.innerHTML = `<tr class="placeholder"><td colspan="6">${msg}</td></tr>`;
      return;
    }
    els.rows.innerHTML = list.map(rowHTML).join("");
    requestCamData(list);
  }

  function renderHeader() {
    if (state.histDate) {
      els.dataTime.textContent = `Historischer Stand: ${fmtDay(state.histDate)}`;
      return;
    }
    const t = fmtDateTime(state.generatedAt);
    els.dataTime.textContent = t
      ? `Datenstand ${t} Uhr · Quelle aktualisiert ca. 08:40 und 13:40`
      : "";
  }

  // Hinweis unter der Datumsauswahl: woher die Werte für den Tag stammen
  function renderHistory(view) {
    const today = todayStr();
    const day = state.histDate || today;
    els.histChips.querySelectorAll(".chip").forEach((c) => {
      c.classList.toggle("active", shiftDate(today, +c.dataset.days || 0, +c.dataset.years || 0) === day);
    });

    const idx = state.ownIndex;
    const since = idx && idx.dates.length
      ? `Eigene Erfassung seit ${fmtDay(idx.dates[0])} (${idx.dates.length} ${idx.dates.length === 1 ? "Tag" : "Tage"}).`
      : idx === null
        ? "Eigene Erfassung läuft noch nicht (scripts/record_snow.py)."
        : "";

    if (!state.histDate) {
      els.histInfo.textContent = `Datum wählen, um den Schneestand eines vergangenen Tages zu sehen. ${since}`;
      return;
    }
    if (state.histLoading) { els.histInfo.textContent = "Lade …"; return; }

    const count = (s) => view.filter((r) => r.hist.source === s).length;
    const own = count("own"), lr = count("liftradar"), model = count("model");
    const parts = [];
    if (own) parts.push(`${own} aus eigener Erfassung`);
    if (lr) parts.push(`${lr} aus dem LiftRadar-Verlauf`);
    let text = parts.length
      ? `Gemeldete Werte: ${parts.join(", ")}.`
      : `Für den ${fmtDay(state.histDate)} gibt es keine gemeldeten Werte.`;
    if (model) {
      text += ` ${parts.length ? "Übrige" : "Angezeigt werden"} Schneehöhen als Modellwert (≈, Open-Meteo-Archiv, ohne Kunstschnee).`;
    }
    els.histInfo.textContent = `${text} ${since}`;
  }

  function renderSummary(rs) {
    if (!rs.length) { els.summary.innerHTML = ""; return; }
    const open = rs.filter((r) => r.status === "open");
    const liftsOpen = rs.reduce((s, r) => s + (r.lifts?.open || 0), 0);
    const liftsTotal = rs.reduce((s, r) => s + (r.lifts?.total || 0), 0);
    const kmOpen = rs.reduce((s, r) => s + (r.slopes?.open_km || 0), 0);
    const best = rs
      .filter((r) => r.snow && r.snow.mountain_cm != null)
      .sort((a, b) => b.snow.mountain_cm - a.snow.mountain_cm)[0];
    const snowiest = state.histDate ? null : rs
      .filter((r) => newSnow(r) != null)
      .sort((a, b) => newSnow(b) - newSnow(a))[0];

    const stat = (value, label) =>
      `<div class="stat"><div class="value">${value}</div><div class="label">${label}</div></div>`;

    // Historisch ohne jede Meldung: Betriebszahlen sind unbekannt, nicht 0
    const reported = rs.filter((r) => r.status !== "unknown");
    const noReports = !reported.length;
    // Ohne gemeldete Schneehöhe: höchsten Modellwert zeigen (klar als ≈ markiert)
    const bestModel = best ? null : rs
      .filter((r) => snowValue(r) != null)
      .sort((a, b) => snowValue(b) - snowValue(a))[0];

    const stats = [
      noReports
        ? stat("–", "Keine Betriebsmeldungen")
        : stat(`${open.length} / ${reported.length}`, "Skigebiete geöffnet"),
      stat(noReports ? "–" : `${fmt(liftsOpen)} / ${fmt(liftsTotal)}`, "Lifte in Betrieb"),
      stat(noReports ? "–" : `${fmt(kmOpen)} km`, "Pisten offen"),
      best
        ? stat(`${fmt(best.snow.mountain_cm)} cm`, `Höchste Schneehöhe: ${esc(best.name)}`)
        : bestModel
          ? stat(`${stationSnowOf(bestModel) ? "" : "≈ "}${fmt(snowValue(bestModel))} cm`,
            `Am meisten Naturschnee (keine Meldung): ${esc(bestModel.name)}`)
          : stat("–", "Keine Schneehöhen gemeldet"),
    ];
    if (snowiest) {
      const cm = Math.round(newSnow(snowiest));
      stats.push(stat(
        `${fmt(cm)} cm`,
        cm > 0 ? `Am meisten Neuschnee (7 Tage): ${esc(snowiest.name)}` : "Kein Neuschnee in Sicht (7 Tage)"
      ));
    }
    els.summary.innerHTML = stats.join("");
  }

  function snowCell(r, which) {
    const v = r.snow ? r.snow[which] : null;
    if (v != null) return `<span class="snow">${fmt(v)} cm</span>`;
    if (which !== "mountain_cm") return '<span class="na">–</span>';

    // Keine Meldung: nur Naturschnee bekannt – bei offenen Pisten liegt meist Kunstschnee drauf
    const piste = r.status === "open"
      ? '<span class="snow-src" title="Das Skigebiet hat offen, meldet aber keine Schneehöhe auf den Pisten (meist Kunstschnee)">Piste: nicht gemeldet</span>'
      : "";
    const st = stationSnowOf(r);
    if (st) {
      const t = fmtDateTime(st.time);
      const km = st.km < 1 ? "< 1" : fmt(Math.round(st.km));
      return `<span class="station" title="Gemessene Naturschneehöhe der GeoSphere-Station ${esc(st.name)} (${fmt(Math.round(st.alt))} m, ${km} km entfernt)${t ? `, Stand ${esc(t)}` : ""} – vom Skigebiet nicht gemeldet">${fmt(st.cm)} cm</span>
        <span class="snow-src">Naturschnee, ${esc(st.name)} ${fmt(Math.round(st.alt))} m</span>${piste}`;
    }
    const m = modelOf(r);
    if (m && m.snowCm != null) {
      const elev = m.elevation != null ? ` für ${fmt(Math.round(m.elevation))} m` : "";
      const src = r.hist ? `Open-Meteo-Archiv, Tagesmittel ${fmtDay(state.histDate)}` : "Open-Meteo";
      return `<span class="model" title="Modellwert ${src}${elev}, ohne Kunstschnee – vom Skigebiet nicht gemeldet">≈ ${fmt(m.snowCm)} cm</span>
        <span class="snow-src">Naturschnee, Modell</span>${piste}`;
    }
    return '<span class="na">–</span>';
  }

  // Klickbar: öffnet die Karte mit Liften und Pisten
  function liftsCell(r) {
    const l = r.lifts;
    const inner = !l || l.total == null
      ? '<span class="na">–</span>'
      : `<span class="count">${fmt(l.open)} <small>/ ${fmt(l.total)}</small></span>
        <span class="bar" aria-hidden="true"><span style="width:${pct(l.open, l.total)}%"></span></span>`;
    if (!r.location) return inner;
    return `<button type="button" class="lift-btn" data-key="${esc(key(r))}"
        title="Karte mit Liften und Pisten" aria-label="${esc(r.name)}: Lifte und Pisten auf der Karte">
        ${inner}<span class="lift-map">Karte ›</span>
      </button>`;
  }

  function slopesCell(r) {
    const s = r.slopes;
    if (!s) return '<span class="na">–</span>';
    let text, p;
    if (s.total_km != null) {
      text = `${fmt(s.open_km)} <small>/ ${fmt(s.total_km)} km</small>`;
      p = pct(s.open_km, s.total_km);
    } else if (s.total != null) {
      text = `${fmt(s.open)} <small>/ ${fmt(s.total)} Pisten</small>`;
      p = pct(s.open, s.total);
    } else {
      return '<span class="na">–</span>';
    }
    const extra = s.total_km != null && s.open != null && s.total != null
      ? ` title="${s.open} von ${s.total} Pisten"` : "";
    return `<div class="count"${extra}>${text}</div>
      <div class="bar" aria-hidden="true"><span style="width:${p}%"></span></div>`;
  }

  // Knopf mit Kurzfassung von heute, klappt die 7-Tage-Prognose auf
  function weatherButton(r, isOpen) {
    const w = state.weather[key(r)];
    if (!w || !w.days.length) return "";
    const today = w.days[0];
    const wx = wmo(today.code);
    const total = Math.round(newSnow(r));
    return `<button type="button" class="wx-toggle" data-key="${esc(key(r))}" aria-expanded="${isOpen}">
        <span aria-hidden="true">${wx.icon}</span>
        <span>${fmtTemp(today.tmax)} / ${fmtTemp(today.tmin)}</span>
        ${total > 0 ? `<span class="wx-snowsum">❄ ${fmt(total)} cm</span>` : ""}
        <span class="wx-more">7 Tage ${isOpen ? "▴" : "▾"}</span>
      </button>`;
  }

  function weatherRowHTML(r, joined) {
    const w = state.weather[key(r)];
    if (!w || !w.days.length) return "";
    const elev = w.elevation != null ? ` für ${fmt(Math.round(w.elevation))} m` : "";
    const nowParts = [];
    if (w.tempNow != null) nowParts.push(fmtTemp(w.tempNow));
    if (w.windNow != null) {
      nowParts.push(`Wind ${fmt(Math.round(w.windNow))} km/h` +
        (w.gustNow != null ? ` (Böen ${fmt(Math.round(w.gustNow))})` : ""));
    }
    const now = nowParts.length ? ` · jetzt ${nowParts.join(", ")}` : "";
    const days = w.days.map((d, i) => {
      const lbl = dayLabel(d.date, i);
      const wx = wmo(d.code);
      const snow = d.snow != null && d.snow >= 0.5
        ? `<div class="wx-snow">❄ ${fmt(Math.round(d.snow))} cm</div>`
        : '<div class="wx-snow none">–</div>';
      return `<div class="wx-day">
          <div class="wx-date"><strong>${esc(lbl.name)}</strong> <span>${esc(lbl.date)}</span></div>
          <div class="wx-icon" title="${esc(wx.label)}" aria-label="${esc(wx.label)}">${wx.icon}</div>
          <div class="wx-temp"><span class="tmax">${fmtTemp(d.tmax)}</span> <span class="tmin">${fmtTemp(d.tmin)}</span></div>
          ${sunHTML(d)}
          <div class="wx-precip${d.precip ? "" : " none"}" title="Niederschlag${d.prob != null ? `, Wahrscheinlichkeit ${d.prob} %` : ""}">
            💧 ${fmt(d.precip != null ? Math.round(d.precip * 10) / 10 : null)} mm
            ${d.prob != null ? `<small>${d.prob} %</small>` : ""}
          </div>
          ${snow}
          ${windHTML(d)}
        </div>`;
    }).join("");
    return `<tr class="wx-row${joined ? " joined" : ""}">
        <td colspan="6">
          <div class="wx-head">7-Tage-Prognose${elev}${now}</div>
          <div class="wx-days">${days}</div>
        </td>
      </tr>`;
  }

  // ---------- Webcams ----------

  async function loadWebcams() {
    if (state.webcams) return;
    try {
      state.webcams = await getJSON("data/webcams.json");
    } catch (_) {
      state.webcams = { cams: {}, resorts: {} }; // z. B. per file:// geöffnet
    }
  }

  // Kameras eines Gebiets, Panomax zuerst (so liefert sie build_webcams.py)
  function camsOf(r) {
    const w = state.webcams;
    const list = (w && w.resorts && w.resorts[key(r)]) || [];
    return list.map(([id, km]) => ({ ...w.cams[id], id, km })).filter((c) => c.s);
  }

  // Windy nur für aktuelle Bilder (kein Archiv) und nur mit Schlüssel
  const windyOn = (r) => !!WINDY_KEY && !state.histDate && !!r.location;
  const hasCams = (r) => camsOf(r).length > 0 || windyOn(r);

  function camLabel(r) {
    const w = windyOn(r) ? state.windy[key(r)] : null;
    const n = camsOf(r).length + (w && w.cams ? w.cams.length : 0);
    return n ? `${n} Webcam${n > 1 ? "s" : ""}` : "Webcams";
  }

  function camButton(r, isOpen) {
    if (!hasCams(r)) return "";
    return `<button type="button" class="cam-toggle" data-key="${esc(key(r))}" aria-expanded="${isOpen}">
        <span aria-hidden="true">📷</span>
        <span class="cam-count">${camLabel(r)}</span>
        <span class="wx-more">${isOpen ? "▴" : "▾"}</span>
      </button>`;
  }

  function distKm(a, b) {
    const p = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * p) / 2) ** 2 +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x));
  }

  // Kameras, die schon über Panomax/foto-webcam.eu kommen, nicht doppelt zeigen
  const KNOWN_PROVIDERS = /panomax\.com|foto-webcam\.eu/i;

  function parseWindy(r, d) {
    return ((d && d.webcams) || [])
      .filter((w) => (!w.status || w.status === "active") && w.images && w.images.current && w.images.current.preview)
      .filter((w) => !KNOWN_PROVIDERS.test((w.urls && w.urls.provider) || ""))
      .map((w) => {
        const size = (w.images.sizes && w.images.sizes.preview) || {};
        const loc = w.location || {};
        const t = w.lastUpdatedOn ? new Date(w.lastUpdatedOn) : null;
        // Titel "Gemeinde › Richtung: Name" -> "Name"
        const title = w.title || loc.city || "Webcam";
        const cut = title.indexOf(": ");
        let name = cut > 0 ? title.slice(cut + 2) : title;
        // manche Betreiber tragen statt eines Namens eine Mitteilung ein -> dann den Ort zeigen
        if (/sehr geehrte|dear (customer|user)/i.test(name)) name = cut > 0 ? title.slice(0, cut) : loc.city || "Webcam";
        return {
          id: w.webcamId,
          title,
          name,
          img: w.images.current.preview,
          w: size.width || 400,
          h: size.height || 224,
          link: (w.urls && w.urls.detail) || `https://www.windy.com/webcams/${w.webcamId}`,
          date: t && !isNaN(t) ? viennaDay(t) : null,
          time: t && !isNaN(t)
            ? t.toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" })
            : null,
          km: loc.latitude != null ? distKm(r.location, { lat: loc.latitude, lon: loc.longitude }) : null,
        };
      })
      .sort((a, b) => (a.km ?? 99) - (b.km ?? 99))
      // dieselbe Kamera kommt oft über zwei Anbieter (z. B. feratel und Skigebiet): nach Kameranamen ausdünnen
      .filter(function (c) {
        const id = c.name.split(" - ").pop().trim().toLowerCase();
        if (this.has(id)) return false;
        this.add(id);
        return true;
      }, new Set())
      .slice(0, WINDY_MAX);
  }

  const windyPending = new Set();
  function fetchWindy(r) {
    const k = key(r);
    const have = state.windy[k];
    if (windyPending.has(k) || (have && Date.now() - have.t < WINDY_TTL)) return;
    windyPending.add(k);
    const params = new URLSearchParams({
      nearby: `${r.location.lat},${r.location.lon},${WINDY_RADIUS_KM}`,
      include: "images,location,urls",
      limit: "25",
    });
    fetch(`${WINDY_API}?${params}`, { headers: { "x-windy-api-key": WINDY_KEY } })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} bei Windy`);
        return res.json();
      })
      .then(
        (d) => ({ t: Date.now(), cams: parseWindy(r, d) }),
        (err) => {
          console.warn("Windy-Webcams nicht ladbar:", err);
          return { t: Date.now(), cams: [], error: true };
        }
      )
      .then((v) => {
        windyPending.delete(k);
        state.windy[k] = v;
        updateWindy(r);
      });
  }

  // Windy-Teil und Zähler im Knopf an Ort und Stelle erneuern
  function updateWindy(r) {
    const sel = `[data-key="${CSS.escape(key(r))}"]`;
    const sec = els.rows.querySelector(`.windy-sec${sel}`);
    if (sec) sec.outerHTML = windySectionHTML(r);
    const cnt = els.rows.querySelector(`.cam-toggle${sel} .cam-count`);
    if (cnt) cnt.textContent = camLabel(r);
  }

  function windyTileHTML(c) {
    const dist = c.km == null ? null : c.km < 1 ? "< 1 km" : `${fmt(Math.round(c.km))} km`;
    return `<a class="cam" href="${esc(c.link)}" target="_blank" rel="noopener" title="${esc(c.title)} – bei Windy öffnen">
        <span class="cam-media"><img src="${esc(c.img)}" alt="${esc(`Webcam ${c.name}`)}" loading="lazy"
          width="${esc(c.w)}" height="${esc(c.h)}"></span>
        <span class="cam-cap">
          <span class="cam-name">${esc(c.name)}</span>
          <span class="cam-sub">${dist || ""}${c.date ? liveTimeHTML(c.date, c.time) : ""}</span>
        </span>
      </a>`;
  }

  function windySectionHTML(r) {
    const w = state.windy[key(r)];
    let body = "";
    if (!w) body = '<div class="cam-empty">Lade Webcams von Windy …</div>';
    else if (w.error) body = '<div class="cam-empty">Windy-Webcams gerade nicht erreichbar.</div>';
    else if (w.cams.length) {
      body = `<div class="cams windy">${w.cams.map(windyTileHTML).join("")}</div>
        <div class="cam-note">Webcams provided by <a href="https://www.windy.com/" target="_blank" rel="noopener">windy.com</a>
          — <a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener">add a webcam</a></div>`;
    } else if (!camsOf(r).length) body = '<div class="cam-empty">Keine Webcams in der Nähe gefunden.</div>';
    return `<div class="windy-sec" data-key="${esc(key(r))}">${body}</div>`;
  }

  const camDataKey = (cam, day) => `${cam}|${day || "live"}`;
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  // Bilderliste eines Tages (Panomax) -> neuestes Bild bzw. historisch das um 12 Uhr
  function parseCamDay(cam, d, day) {
    const imgs = (d && Array.isArray(d.images) ? d.images : []).filter((i) => i.time && i.available !== false);
    if (!d || !d.date || !d.storage || !imgs.length || (day && d.date !== day)) return null;
    const pick = day
      ? imgs.reduce((a, b) => (Math.abs(toMinutes(b.time) - 720) < Math.abs(toMinutes(a.time) - 720) ? b : a))
      : imgs[imgs.length - 1];
    const [y, m, dd] = d.date.split("-");
    const base = `https://panodata${d.storage}.panomax.com/cams/${cam}/${y}/${m}/${dd}/${pick.time.replace(/:/g, "-")}`;
    return {
      date: d.date,
      time: pick.time.slice(0, 5),
      small: `${base}_small.jpg`,
      opt: `${base}_optimized.jpg`,
      reduced: `${base}_reduced.jpg`,
    };
  }

  const camPending = new Set();
  function fetchCam(cam, day) {
    const k = camDataKey(cam, day);
    if (k in state.camData || camPending.has(k)) return;
    if (day && day < "2010-01-01") { // vor den ersten Panomax-Bildern: gar nicht erst fragen
      state.camData[k] = null;
      return;
    }
    camPending.add(k);
    getJSON(`${PANOMAX_API}/cams/${cam}/images/day${day ? `/${day}` : ""}`)
      .then((d) => parseCamDay(cam, d, day), () => null) // z. B. 422 = an dem Tag keine Bilder
      .then((v) => {
        camPending.delete(k);
        state.camData[k] = v;
        updateCamTiles(cam);
      });
  }

  // Aufnahmezeiten (und historisch die Bild-Adressen) der aufgeklappten Kameras laden
  function requestCamData(list) {
    if (!state.camsOpen.size) return;
    for (const r of list) {
      if (!state.camsOpen.has(key(r))) continue;
      for (const c of camsOf(r)) if (c.s === "p") fetchCam(c.cam, state.histDate);
      if (windyOn(r)) fetchWindy(r);
    }
  }

  // Nur die betroffenen Kacheln anpassen, ohne die Tabelle (und alle Bilder) neu aufzubauen
  function updateCamTiles(cam) {
    const c = state.webcams && state.webcams.cams[`p${cam}`];
    if (!c) return;
    els.rows.querySelectorAll(`.cam[data-cam="${cam}"]`).forEach((el) => {
      if (state.histDate) el.querySelector(".cam-media").innerHTML = camMediaHTML(c, state.histDate);
      el.querySelector(".cam-time").innerHTML = camTimeHTML(c, state.histDate);
    });
  }

  const CAM_SIZES = "(max-width: 760px) 100vw, 360px";
  function camImg(alt, small, opt, reduced) {
    return `<img src="${esc(small)}" srcset="${esc(small)} 515w, ${esc(opt)} 1030w, ${esc(reduced)} 1545w"
      sizes="${CAM_SIZES}" alt="${esc(alt)}" loading="lazy" width="515" height="150">`;
  }

  function camMediaHTML(c, day) {
    const alt = `Webcam ${c.n}`;
    if (!day) {
      const u = (size) => `${PANOMAX_LIVE}/${c.cam}/recent_${size}.jpg?t=${state.camStamp}`;
      return camImg(alt, u("small"), u("optimized"), u("reduced"));
    }
    const d = state.camData[camDataKey(c.cam, day)];
    if (d === undefined) return '<span class="cam-empty">Lade Bild …</span>';
    if (!d) return '<span class="cam-empty">Kein Bild von diesem Tag</span>';
    return camImg(alt, d.small, d.opt, d.reduced);
  }

  function camTimeHTML(c, day) {
    const d = state.camData[camDataKey(c.cam, day)];
    if (!d) return "";
    if (day) return ` · ${d.time} Uhr`;
    return liveTimeHTML(d.date, d.time);
  }

  // Aufnahmezeit eines Livebilds; älter als gestern = Kamera hängt vermutlich
  function liveTimeHTML(date, time) {
    const today = todayStr();
    if (date === today) return ` · heute ${time}`;
    if (date === shiftDate(today, -1)) return ` · gestern ${time}`;
    const [, m, dd] = date.split("-");
    return ` · <span class="cam-stale" title="Die Kamera liefert derzeit keine neuen Bilder">zuletzt ${dd}.${m}. ${time}</span>`;
  }

  function camTileHTML(c, day) {
    const dist = c.km < 1 ? "< 1 km" : `${fmt(Math.round(c.km))} km`;
    const sub = [c.e ? `${fmt(c.e)} m` : null, dist].filter(Boolean).join(" · ");
    return `<a class="cam" data-cam="${esc(c.cam)}" href="${esc(c.u)}" target="_blank" rel="noopener"
        title="${esc(c.n)} – 360°-Ansicht bei Panomax öffnen">
        <span class="cam-media">${camMediaHTML(c, day)}</span>
        <span class="cam-cap">
          <span class="cam-name">${esc(c.n)}</span>
          <span class="cam-sub">${sub}<span class="cam-time">${camTimeHTML(c, day)}</span></span>
        </span>
      </a>`;
  }

  function camRowHTML(r) {
    const day = state.histDate;
    const cams = camsOf(r);
    const pano = cams.filter((c) => c.s === "p");
    const fw = cams.filter((c) => c.s === "f");
    // foto-webcam.eu hat ein Archiv mit Adressen der Form /webcam/<id>/JJJJ/MM/TT/HHMM
    const fwLink = (c) => (day ? `https://www.foto-webcam.eu/webcam/${encodeURIComponent(c.fid)}/${day.replace(/-/g, "/")}/1200` : c.u);
    const links = fw.map((c) =>
      `<a href="${esc(fwLink(c))}" target="_blank" rel="noopener" title="${esc(c.t || c.n)}">${esc(c.n)}</a>` +
      (c.e ? ` <small>${fmt(c.e)} m</small>` : "")
    ).join(" · ");
    const windy = windyOn(r);
    const head = day ? `Webcams am ${esc(fmtDay(day))} – Bild um ca. 12 Uhr`
      : pano.length || windy ? "Webcams in der Nähe – aktuelles Bild" : "Webcams in der Nähe";
    return `<tr class="cam-row">
        <td colspan="6">
          <div class="wx-head">${head}</div>
          ${pano.length ? `<div class="cams">${pano.map((c) => camTileHTML(c, day)).join("")}</div>` : ""}
          ${pano.length ? '<div class="cam-note">Panoramen: Panomax · Klick öffnet die 360°-Ansicht</div>' : ""}
          ${windy ? windySectionHTML(r) : ""}
          ${fw.length ? `<div class="cam-links">${pano.length || windy ? "Weitere" : "Webcams"} auf foto-webcam.eu${day ? " (Archiv, 12 Uhr)" : ""}: ${links}</div>` : ""}
        </td>
      </tr>`;
  }

  function rowHTML(r) {
    const d = state.details[key(r)] || {};
    const status = STATUS[r.status] || { label: r.status };
    const website = d.website;
    const name = website
      ? `<a href="${esc(website)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
      : esc(r.name);
    const hist = r.hist;
    const updated = hist ? null : fmtDateTime(d.lifts_updated_at || d.fetched_at || r.checked_at);
    const isOpen = !hist && state.expanded.has(key(r)) && !!state.weather[key(r)];
    const camOpen = state.camsOpen.has(key(r)) && hasCams(r);

    // Herkunft der Werte im historischen Modus
    let sourceText = "";
    let sourceTitle = "";
    if (hist) {
      const t = fmtDateTime(hist.time);
      sourceText = {
        own: t ? `Stand ${t}` : "Erfasst",
        liftradar: t ? `Stand ${t}` : "Gemeldet",
        model: "Nur Modellwert",
        none: "Keine Daten",
      }[hist.source];
      sourceTitle = {
        own: "Aus der eigenen täglichen Erfassung",
        liftradar: "Aus dem LiftRadar-Verlauf",
        model: "Für diesen Tag gibt es keine Meldung – Schneehöhe aus dem Open-Meteo-Archiv",
        none: "Für diesen Tag gibt es weder Meldung noch Modellwert",
      }[hist.source];
    }

    // Letzte Spalte: aktuell letzter Schneefall + Pistenzustand, historisch Neuschnee des Tages (Modell)
    let lastCell;
    if (hist) {
      const fall = hist.model ? hist.model.snowfallCm : null;
      lastCell = fall == null ? '<span class="na">–</span>'
        : fall >= 0.5 ? `<span class="model" title="Modellwert Open-Meteo-Archiv">❄ ≈ ${fmt(Math.round(fall))} cm</span>`
        : '<span class="na">kein Neuschnee</span>';
    } else {
      const snowfall = fmtSnowfall(d.snow && d.snow.last_snowfall);
      const condition = d.snow && d.snow.condition;
      lastCell = (snowfall
        ? `${esc(snowfall.date)} <small class="updated">(${esc(snowfall.rel)})</small>`
        : '<span class="na">–</span>') +
        (condition ? `<div class="updated">Piste: ${esc(condition)}</div>` : "");
    }

    return `<tr data-key="${esc(key(r))}" class="${r.status === "open" ? "is-open" : "is-closed"}${isOpen || camOpen ? " is-expanded" : ""}">
      <td>
        <div class="name-line">
          <div class="name">${name}</div>
          ${state.view === "list"
            ? `<button type="button" class="remove-btn" data-key="${esc(key(r))}" title="Aus der Liste entfernen" aria-label="${esc(r.name)} aus der Liste entfernen">✕</button>`
            : inList(r)
              ? '<span class="in-list" title="In deiner Liste">✓</span>'
              : `<button type="button" class="add-btn" data-key="${esc(key(r))}" title="Zu meiner Liste hinzufügen" aria-label="${esc(r.name)} zu meiner Liste hinzufügen">＋</button>`}
        </div>
        <div class="place">${esc(placeLabel(r))}</div>
        <div class="meta">
          <span class="badge ${esc(r.status)}">${esc(status.label)}</span>
          ${updated ? `<span class="updated">Stand ${esc(updated)}</span>` : ""}
          ${sourceText ? `<span class="updated src-${esc(hist.source)}" title="${esc(sourceTitle)}">${esc(sourceText)}</span>` : ""}
        </div>
        ${hist ? "" : weatherButton(r, isOpen)}${camButton(r, camOpen)}
      </td>
      <td class="num" data-label="Schnee Berg">${snowCell(r, "mountain_cm")}</td>
      <td class="num" data-label="Schnee Tal">${snowCell(r, "valley_cm")}</td>
      <td data-label="Lifte offen">${liftsCell(r)}</td>
      <td data-label="Pisten offen">${slopesCell(r)}</td>
      <td data-label="${hist ? "Neuschnee am Tag" : "Letzter Schneefall"}">${lastCell}</td>
    </tr>${isOpen ? weatherRowHTML(r, camOpen) : ""}${camOpen ? camRowHTML(r) : ""}`;
  }

  // ---------- Detailansicht: Karte mit Liften und Pisten ----------
  // Geometrie aus OpenSkiData (OpenStreetMap), aufbereitet von LiftRadar als Kacheln (Zoom 10),
  // jedes Element mit seinem LiftRadar-Gebiet ("lr"). Leaflet wird erst beim ersten Öffnen geladen.

  const SKI_TILES = "https://liftradar.eu/ski/v1/10";
  const LEAFLET = {
    js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
    jsSri: "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==",
    css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
    cssSri: "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==",
  };

  // Lifttypen (OpenSkiData) in Anzeige-Reihenfolge
  const LIFT_TYPES = {
    cable_car: "Pendelbahn",
    gondola: "Gondelbahn",
    mixed_lift: "Kombibahn",
    funicular: "Standseilbahn",
    chair_lift: "Sessellift",
    drag_lift: "Schlepplift",
    "t-bar": "Schlepplift (Bügel)",
    "j-bar": "Schlepplift (Anker)",
    platter: "Tellerlift",
    rope_tow: "Seillift",
    magic_carpet: "Förderband",
  };
  // Zähler je Typ, wie LiftRadar sie meldet
  const LR_LIFT_TYPES = {
    cable_car: "Pendelbahnen", gondola: "Gondelbahnen", funicular: "Standseilbahnen", chairlift: "Sessellifte",
    drag_lift: "Schlepplifte", carpet: "Förderbänder", other: "Sonstige",
  };
  const LR_LIFT_DATIV = {
    cable_car: "Pendelbahnen", gondola: "Gondelbahnen", funicular: "Standseilbahnen", chairlift: "Sesselliften",
    drag_lift: "Schleppliften", carpet: "Förderbändern", other: "sonstigen Liften",
  };
  // OpenSkiData-Lifttyp -> Typ, unter dem LiftRadar offene Lifte zählt
  const LR_TYPE_OF = {
    cable_car: "cable_car", gondola: "gondola", mixed_lift: "gondola", funicular: "funicular",
    chair_lift: "chairlift", drag_lift: "drag_lift", "t-bar": "drag_lift", "j-bar": "drag_lift",
    platter: "drag_lift", rope_tow: "drag_lift", magic_carpet: "carpet",
  };
  // Darstellung nach Betrieb: offen grün, zu hellgrau; "unklar" = nur ein Teil des Typs offen
  const LIFT_STATUS = {
    open: { label: "offen", line: "#16a34a", casing: "#ffffff", dot: "#15803d", rank: 0 },
    unknown: { label: "offen oder zu (unklar)", line: "#111827", casing: "#ffffff", dot: "#111827", rank: 1 },
    closed: { label: "geschlossen", line: "#d1d5db", casing: "#6b7280", dot: "#9ca3af", rank: 2 },
  };

  // Pistenfarben wie auf österreichischen Pistenplänen
  const RUN_STYLES = {
    novice: { color: "#16a34a", label: "Sehr leicht" },
    easy: { color: "#2563eb", label: "Leicht (blau)" },
    intermediate: { color: "#dc2626", label: "Mittel (rot)" },
    advanced: { color: "#111827", label: "Schwer (schwarz)" },
    expert: { color: "#111827", label: "Sehr schwer", dash: "6 4" },
    freeride: { color: "#ea580c", label: "Skiroute / Freeride", dash: "6 4" },
    extreme: { color: "#ea580c", label: "Extrem", dash: "2 4" },
  };
  const RUN_UNKNOWN = { color: "#6b7280", label: "Ohne Angabe" };

  let leafletReady = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!leafletReady) {
      leafletReady = new Promise((resolve, reject) => {
        const css = Object.assign(document.createElement("link"), {
          rel: "stylesheet", href: LEAFLET.css, integrity: LEAFLET.cssSri, crossOrigin: "anonymous",
        });
        const js = Object.assign(document.createElement("script"), {
          src: LEAFLET.js, integrity: LEAFLET.jsSri, crossOrigin: "anonymous",
        });
        js.onload = resolve;
        js.onerror = () => { leafletReady = null; reject(new Error("Kartenbibliothek nicht ladbar")); };
        document.head.append(css, js);
      });
    }
    return leafletReady;
  }

  const skiTileCache = {};
  function skiTile(x, y) {
    const u = `${SKI_TILES}/${x}/${y}.json`;
    if (!skiTileCache[u]) {
      // leere Kacheln gibt es nicht (404) – das ist kein Fehler
      skiTileCache[u] = fetch(u).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    }
    return skiTileCache[u];
  }

  // Lifte, Pisten und Umriss eines Gebiets aus der Kachel des Gebietspunkts und den 8 Nachbarn
  async function loadSkiMap(r) {
    const n = 2 ** 10;
    const lat = (r.location.lat * Math.PI) / 180;
    const x = Math.floor(((r.location.lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n);
    const jobs = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) jobs.push(skiTile(x + dx, y + dy));
    const tiles = (await Promise.all(jobs)).filter(Boolean);
    const k = key(r);
    // Elemente über Kachelgrenzen kommen mehrfach vor: nach OSM-id zusammenfassen, die längste Fassung behalten
    const pick = (list, own) => {
      const byId = new Map();
      for (const f of list) {
        if (!own(f)) continue;
        const id = f.osm || JSON.stringify(f.c || f.outline).slice(0, 80);
        const prev = byId.get(id);
        if (!prev || (f.c || []).length > (prev.c || []).length) byId.set(id, f);
      }
      return [...byId.values()];
    };
    return {
      lifts: pick(tiles.flatMap((t) => t.lifts || []), (f) => f.lr === k && f.c && f.c.length > 1),
      runs: pick(tiles.flatMap((t) => t.runs || []),
        (f) => f.lr === k && f.c && f.c.length > 1 && (f.uses || []).includes("downhill")),
      areas: pick(tiles.flatMap((t) => t.areas || []), (f) => f.lr && f.lr.id === k && f.outline),
    };
  }

  // Länge (m, entlang der Linie) und Höhen an den Enden
  function liftGeo(c) {
    let m = 0;
    for (let i = 1; i < c.length; i++) {
      m += distKm({ lat: c[i - 1][1], lon: c[i - 1][0] }, { lat: c[i][1], lon: c[i][0] }) * 1000;
    }
    const z = [c[0][2], c[c.length - 1][2]].filter((v) => v != null);
    return { m, low: z.length ? Math.min(...z) : null, high: z.length ? Math.max(...z) : null };
  }

  function liftInfo(l) {
    const g = liftGeo(l.c);
    const type = LIFT_TYPES[l.type] || "Lift";
    const kind = l.occupancy > 1 && ["chair_lift", "gondola", "mixed_lift"].includes(l.type)
      ? `${l.occupancy}er-${type}` : type;
    const extras = [l.bubble ? "Haube" : null, l.heating ? "Sitzheizung" : null,
      l.capacity ? `${fmt(l.capacity)} Pers./h` : null].filter(Boolean);
    return { name: l.name || type, kind, g, extras };
  }

  function liftLineText(i) {
    const parts = [`${fmt(Math.round(i.g.m / 10) * 10)} m lang`];
    if (i.g.low != null && i.g.high != null && i.g.high - i.g.low >= 5) {
      parts.push(`${fmt(Math.round(i.g.low))} → ${fmt(Math.round(i.g.high))} m`);
    }
    return parts.concat(i.extras).join(" · ");
  }

  let detailMap = null;

  function detailHeadHTML(r) {
    const d = state.details[key(r)] || {};
    const status = STATUS[r.status] || { label: r.status };
    const updated = r.hist ? `Stand ${fmtDay(state.histDate)}` : (() => {
      const t = fmtDateTime(d.lifts_updated_at || d.fetched_at || r.checked_at);
      return t ? `Stand ${t}` : "";
    })();
    const l = r.lifts;
    const s = r.slopes;
    const byType = !r.hist && d.lifts_by_type
      ? Object.entries(d.lifts_by_type)
        .filter(([, v]) => v && v.total)
        .map(([t, v]) => `<span class="type-chip">${esc(LR_LIFT_TYPES[t] || t)} <strong>${fmt(v.open)} / ${fmt(v.total)}</strong></span>`)
        .join("")
      : "";
    const website = d.website ? ` · <a href="${esc(d.website)}" target="_blank" rel="noopener">Website</a>` : "";
    return `<div class="detail-head">
        <div>
          <h2 id="detail-title">${esc(r.name)}</h2>
          <div class="place">${esc(placeLabel(r))}${website}</div>
          <div class="meta"><span class="badge ${esc(r.status)}">${esc(status.label)}</span>
            ${updated ? `<span class="updated">${esc(updated)}</span>` : ""}</div>
        </div>
        <button type="button" class="detail-close" aria-label="Schließen" title="Schließen (Esc)">✕</button>
      </div>
      <div class="detail-stats">
        <span class="type-chip">Lifte offen <strong>${l && l.total != null ? `${fmt(l.open)} / ${fmt(l.total)}` : "–"}</strong></span>
        <span class="type-chip">Pisten offen <strong>${s && s.total_km != null ? `${fmt(s.open_km)} / ${fmt(s.total_km)} km`
          : s && s.total != null ? `${fmt(s.open)} / ${fmt(s.total)}` : "–"}</strong></span>
        ${byType}
      </div>`;
  }

  async function openDetail(k) {
    const base = state.resorts.find((r) => key(r) === k) || state.all.find((r) => key(r) === k);
    if (!base || !base.location) return;
    const r = state.histDate ? histView(base) : base;
    const dlg = els.detail;
    dlg.dataset.key = k;
    dlg.innerHTML = `<div class="detail-inner">
        ${detailHeadHTML(r)}
        <div class="detail-map" id="detail-map"><div class="detail-msg">Lade Karte …</div></div>
        <div class="map-legend" id="detail-legend"></div>
        <div id="detail-lifts"></div>
        <p class="detail-attr">Lifte &amp; Pisten: <a href="https://openskimap.org" target="_blank" rel="noopener">OpenSkiData</a>,
          © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a> (ODbL), über
          <a href="https://liftradar.eu/api" target="_blank" rel="noopener">LiftRadar</a>.
          Offen/zu je Lift ist aus den LiftRadar-Zahlen je Lifttyp abgeleitet: grün, wenn alle Lifte dieses Typs laufen,
          grau, wenn keiner läuft – sonst „unklar“, weil die Quelle nicht meldet, welche es sind.</p>
      </div>`;
    if (!dlg.open) dlg.showModal();
    document.documentElement.classList.add("detail-open");

    try {
      const [, data] = await Promise.all([loadLeaflet(), loadSkiMap(base)]);
      if (!dlg.open || dlg.dataset.key !== k) return; // inzwischen geschlossen oder anderes Gebiet
      drawDetailMap(base, data, r);
    } catch (err) {
      console.warn(err);
      const box = document.getElementById("detail-map");
      if (box) box.innerHTML = `<div class="detail-msg">Die Karte konnte nicht geladen werden (${esc(err.message)}).</div>`;
    }
  }

  // Betrieb eines Lifts aus den Zahlen je Typ ableiten (LiftRadar meldet nicht, welcher Lift läuft):
  // alle des Typs offen -> offen, keiner -> zu, sonst unklar
  function liftStatus(l, v) {
    if (v.status !== "open") return "closed"; // geschlossen, kein Bericht oder historisch ohne Betrieb
    const d = state.details[key(v)] || {};
    const byType = !v.hist && d.lifts_by_type ? d.lifts_by_type : null;
    const t = LR_TYPE_OF[l.type] || "other";
    const c = byType && ((byType[t] && byType[t].total ? byType[t] : null) ||
      (t === "cable_car" && byType.gondola) || byType.other);
    const n = c && c.total ? c : v.lifts;
    if (!n || !n.total) return "unknown";
    if (!n.open) return "closed";
    return n.open >= n.total ? "open" : "unknown";
  }

  function drawDetailMap(r, data, view) {
    view = view || r;
    const box = document.getElementById("detail-map");
    box.innerHTML = "";
    if (detailMap) { detailMap.remove(); detailMap = null; }
    const map = (detailMap = L.map(box, { scrollWheelZoom: true, zoomSnap: 0.5 }));
    const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: 'Karte: © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA), © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    });
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
    });
    topo.addTo(map);
    L.control.layers({ "Gelände (OpenTopoMap)": topo, "Straßenkarte (OSM)": osm }, null, { position: "topright" }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);

    const ll = (c) => c.map((p) => [p[1], p[0]]);
    const bounds = L.latLngBounds([]);

    for (const a of data.areas) {
      const poly = L.polygon(a.outline.map(ll), {
        color: "#1d6fb8", weight: 1.5, dashArray: "4 4", fillOpacity: 0.04, interactive: false,
      }).addTo(map);
      bounds.extend(poly.getBounds());
    }

    // Pisten nach Schwierigkeit, leichte zuerst (schwere liegen oben)
    const order = ["novice", "easy", "intermediate", "advanced", "expert", "freeride", "extreme"];
    const used = new Set();
    [...data.runs]
      .sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty))
      .forEach((run) => {
        const st = RUN_STYLES[run.difficulty] || RUN_UNKNOWN;
        used.add(st);
        const line = L.polyline(ll(run.c), { color: st.color, weight: 3, opacity: 0.85, dashArray: st.dash });
        line.bindTooltip(`${esc(run.name || (run.ref ? `Piste ${run.ref}` : "Piste"))} · ${esc(st.label)}`, { sticky: true });
        line.addTo(map);
        bounds.extend(line.getBounds());
      });

    // Lifte nach Betrieb eingefärbt (Linie mit Kontur, Stationen als Punkte); offene zuerst
    const liftLayers = [];
    const typeRank = (t) => {
      const i = Object.keys(LIFT_TYPES).indexOf(t);
      return i < 0 ? 99 : i;
    };
    const lifts = data.lifts
      .map((l) => ({ l, info: liftInfo(l), st: liftStatus(l, view) }))
      .sort((a, b) => LIFT_STATUS[a.st].rank - LIFT_STATUS[b.st].rank ||
        typeRank(a.l.type) - typeRank(b.l.type) || a.info.name.localeCompare(b.info.name, "de"));
    // geschlossene unten zeichnen, offene oben
    lifts.map((x, i) => [x, i]).reverse().forEach(([{ l, info, st }, i]) => {
      const sty = LIFT_STATUS[st];
      const pts = ll(l.c);
      const casing = L.polyline(pts, { color: sty.casing, weight: st === "closed" ? 5 : 7, opacity: 0.9, interactive: false });
      const line = L.polyline(pts, { color: sty.line, weight: st === "open" ? 4 : 3 });
      const ends = [pts[0], pts[pts.length - 1]].map((p) =>
        L.circleMarker(p, { radius: 3.5, color: sty.dot, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }));
      const group = L.featureGroup([casing, line, ...ends]).addTo(map);
      line.bindPopup(`<strong>${esc(info.name)}</strong><br>${esc(info.kind)} · <span class="pop-${st}">${esc(sty.label)}</span>
        <br><small>${esc(liftLineText(info))}</small>`);
      line.bindTooltip(`${esc(info.name)} · ${esc(sty.label)}`, { sticky: true });
      liftLayers[i] = { group, line };
      bounds.extend(group.getBounds());
    });

    const fit = () => {
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      else map.setView([r.location.lat, r.location.lon], 13);
    };
    fit();
    if (!bounds.isValid()) L.circleMarker([r.location.lat, r.location.lon], { radius: 6, color: "#1d6fb8" }).addTo(map);
    // Größe des Dialogs steht erst nach dem Layout fest: dann neu einpassen
    setTimeout(() => { if (detailMap === map) { map.invalidateSize(); fit(); } }, 60);

    // Legende
    const styleRank = (st) => {
      const i = Object.values(RUN_STYLES).indexOf(st);
      return i < 0 ? 99 : i;
    };
    const swatch = (css) => `<i class="lg-sw"><i class="lg-line" style="${css}"></i></i>`;
    const legend = [...used]
      .sort((a, b) => styleRank(a) - styleRank(b))
      .map((st) => `<span>${swatch(`border-top:3px ${st.dash ? "dashed" : "solid"} ${st.color}`)}${esc(st.label)}</span>`);
    // Lift-Legende: nur vorkommende Zustände; bei "unklar" dazuschreiben, wie viele des Typs offen sind
    const d = state.details[key(view)] || {};
    const partial = !view.hist && d.lifts_by_type
      ? Object.entries(d.lifts_by_type).filter(([, c]) => c && c.open > 0 && c.open < c.total)
        .map(([t, c]) => `${fmt(c.open)} von ${fmt(c.total)} ${LR_LIFT_DATIV[t] || t}`)
      : [];
    const states = [...new Set(lifts.map((x) => x.st))].sort((a, b) => LIFT_STATUS[a].rank - LIFT_STATUS[b].rank);
    legend.unshift(...states.map((st) => {
      const sty = LIFT_STATUS[st];
      const label = st === "unknown"
        ? `Lift unklar${partial.length ? ` (${partial.join(", ")} offen – welche, ist nicht gemeldet)` : ""}`
        : `Lift ${sty.label}`;
      return `<span>${swatch(`border-top:4px solid ${sty.line};box-shadow:0 0 0 1px ${sty.casing}`)}${esc(label)}</span>`;
    }));
    document.getElementById("detail-legend").innerHTML = legend.join("");

    // Liftliste
    const listBox = document.getElementById("detail-lifts");
    if (!lifts.length) {
      listBox.innerHTML = `<p class="detail-msg">Für dieses Skigebiet sind in OpenStreetMap noch keine Lifte eingetragen.</p>`;
      return;
    }
    listBox.innerHTML = `<h3 class="detail-h3">Lifte (${lifts.length})</h3>
      <ul class="lift-list">${lifts.map(({ info, st }, i) => `<li>
          <button type="button" class="lift-item st-${st}" data-i="${i}">
            <span class="lift-name"><i class="lift-dot" title="${esc(LIFT_STATUS[st].label)}"></i>${esc(info.name)}</span>
            <span class="lift-sub">${esc(info.kind)} · ${esc(liftLineText(info))}</span>
          </button></li>`).join("")}</ul>`;
    listBox.onclick = (e) => {
      const b = e.target.closest(".lift-item");
      if (!b) return;
      const layer = liftLayers[+b.dataset.i];
      map.fitBounds(layer.group.getBounds(), { padding: [40, 40], maxZoom: 15 });
      layer.line.openPopup(layer.line.getCenter());
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
  }

  els.detail.addEventListener("click", (e) => {
    // Klick auf den abgedunkelten Hintergrund oder ✕ schließt
    if (e.target === els.detail || e.target.closest(".detail-close")) els.detail.close();
  });
  els.detail.addEventListener("close", () => {
    document.documentElement.classList.remove("detail-open");
    if (detailMap) { detailMap.remove(); detailMap = null; }
    els.detail.innerHTML = "";
    const k = els.detail.dataset.key;
    const back = k && els.rows.querySelector(`.lift-btn[data-key="${CSS.escape(k)}"]`);
    if (back) back.focus();
  });

  // ---------- Suche: weitere Skigebiete hinzufügen ----------

  const MAX_RESULTS = 8;
  const norm = (s) =>
    String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  let searchIndex = null; // wird beim ersten Suchen aus state.all gebaut
  let matches = [];
  let active = -1;

  function buildSearchIndex() {
    searchIndex = state.all.map((r) => ({
      r,
      name: norm(r.name),
      hay: norm([r.name, r.region, r.ski_region, countryName(r.country)].join(" ")),
    }));
  }

  function findMatches(q) {
    const nq = norm(q).trim();
    if (nq.length < 2) return [];
    if (!searchIndex) buildSearchIndex();
    const words = nq.split(/\s+/);
    const hits = [];
    for (const e of searchIndex) {
      if (!words.every((w) => e.hay.includes(w))) continue;
      // Treffer am Namensanfang zuerst, dann Wortanfang im Namen, dann Rest (z. B. Region)
      const rank = e.name.startsWith(nq) ? 0
        : e.name.split(/[\s\-–/()]+/).some((p) => p.startsWith(words[0])) ? 1
        : e.name.includes(words[0]) ? 2 : 3;
      hits.push([rank, e.r]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, "de"));
    return hits.slice(0, MAX_RESULTS).map((h) => h[1]);
  }

  function renderSearch() {
    const q = els.search.value;
    if (norm(q).trim().length < 2) { closeSearch(); return; }
    matches = findMatches(q);
    if (active >= matches.length) active = matches.length - 1;

    if (!matches.length) {
      els.searchResults.innerHTML = '<li class="sr-empty">Kein Skigebiet gefunden.</li>';
    } else {
      els.searchResults.innerHTML = matches.map((r, i) => {
        const listed = inList(r);
        const info = [
          STATUS[r.status]?.label,
          r.lifts && r.lifts.total != null ? `${r.lifts.open}/${r.lifts.total} Lifte` : null,
          r.snow && r.snow.mountain_cm != null ? `${r.snow.mountain_cm} cm Schnee` : null,
        ].filter(Boolean).join(" · ");
        return `<li role="option" id="sr-${i}" data-key="${esc(key(r))}"
            class="sr-item${listed ? " listed" : ""}${i === active ? " active" : ""}"
            aria-selected="${i === active}" aria-disabled="${listed}">
            <div class="sr-text">
              <div><span class="sr-name">${esc(r.name)}</span> <span class="sr-place">${esc(placeLabel(r))}</span></div>
              <div class="sr-info">${esc(info)}</div>
            </div>
            <span class="sr-action">${listed ? "✓ in der Liste" : "+ Hinzufügen"}</span>
          </li>`;
      }).join("");
    }
    els.searchResults.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
    if (active >= 0) els.search.setAttribute("aria-activedescendant", `sr-${active}`);
    else els.search.removeAttribute("aria-activedescendant");
  }

  function closeSearch() {
    matches = [];
    active = -1;
    els.searchResults.hidden = true;
    els.searchResults.innerHTML = "";
    els.search.setAttribute("aria-expanded", "false");
    els.search.removeAttribute("aria-activedescendant");
  }

  function searchHint(text) {
    const msg = text ||
      `Durchsucht ${fmt(state.all.length)} Skigebiete in ganz Europa. Deine Liste bleibt in diesem Browser gespeichert.`;
    els.searchHint.innerHTML = esc(msg) + (isDefaultList() ? ""
      : ' <button type="button" class="link-btn" data-action="reset-list">Auf Top 10 Österreich zurücksetzen</button>');
  }

  // Zurück zur Startliste (gespeicherte Liste löschen)
  async function resetList() {
    try { localStorage.removeItem(LIST_KEY); } catch (_) { /* egal */ }
    state.list = new Set(DEFAULT_LIST);
    await setView("list");
    searchHint("Liste auf die 10 größten Skigebiete Österreichs zurückgesetzt.");
  }

  // Aus der Skipass-Ansicht in die eigene Liste übernehmen (Ansicht bleibt)
  function addToList(keys) {
    const added = keys.filter((k) => !state.list.has(k));
    if (!added.length) return;
    added.forEach((k) => state.list.add(k));
    saveList();
    render();
    const one = added.length === 1 && state.all.find((r) => key(r) === added[0]);
    searchHint(one ? `${one.name} zu deiner Liste hinzugefügt.`
      : `${added.length} Skigebiete zu deiner Liste hinzugefügt.`);
  }

  // Über die Suche hinzufügen: landet in der eigenen Liste, die dann angezeigt wird
  async function addResort(k) {
    const r = state.all.find((x) => key(x) === k);
    if (!r || inList(r)) return;
    state.list.add(k);
    saveList();
    if (els.showWeather.checked) state.expanded.add(k);
    els.search.value = "";
    closeSearch();
    const hidden = els.onlyOpen.checked && r.status !== "open";
    const hint = `${r.name} hinzugefügt.` +
      (hidden ? " Es ist gerade geschlossen und wird durch „Nur offene Gebiete“ ausgeblendet." : "");

    if (state.view !== "list") {
      await setView("list");
    } else {
      refreshResorts();
      render();
      await ensureData([r]);
      render();
    }
    searchHint(hint);
    const row = els.rows.querySelector(`tr[data-key="${CSS.escape(k)}"]`);
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("flash");
    }
  }

  function removeResort(k) {
    const r = state.resorts.find((x) => key(x) === k);
    if (!r || state.view !== "list") return;
    state.list.delete(k);
    saveList();
    refreshResorts();
    state.expanded.delete(k);
    render();
    searchHint(`${r.name} entfernt.`);
    els.search.focus();
  }

  // ---------- Start ----------

  els.onlyOpen.checked = storageGet("ski.onlyOpen") === "1";
  els.showWeather.checked = storageGet("ski.showWeather") === "1";
  const savedSort = storageGet("ski.sort");
  if (Array.from(els.sort.options).some((o) => o.value === savedSort)) els.sort.value = savedSort;

  els.onlyOpen.addEventListener("change", () => {
    storageSet("ski.onlyOpen", els.onlyOpen.checked ? "1" : "0");
    render();
  });
  els.showWeather.addEventListener("change", () => {
    storageSet("ski.showWeather", els.showWeather.checked ? "1" : "0");
    state.expanded = new Set(els.showWeather.checked ? state.resorts.map(key) : []);
    render();
  });
  els.sort.addEventListener("change", () => {
    storageSet("ski.sort", els.sort.value);
    render();
  });
  // "Zurücksetzen"-Knöpfe (im Suchhinweis und bei leerer Liste)
  document.addEventListener("click", (e) => {
    if (e.target.closest('[data-action="reset-list"]')) resetList();
    if (e.target.closest('[data-action="add-all"]')) addToList(state.resorts.map(key));
  });
  els.view.addEventListener("change", () => setView(els.view.value));
  // Zurück/Vor oder geänderte Adresse (#pass-id)
  window.addEventListener("hashchange", () => {
    const wanted = decodeURIComponent(location.hash.slice(1)) || "list";
    if (wanted !== state.view) setView(wanted);
  });
  els.rows.addEventListener("click", (e) => {
    const remove = e.target.closest(".remove-btn");
    if (remove) { removeResort(remove.dataset.key); return; }
    const add = e.target.closest(".add-btn");
    if (add) { addToList([add.dataset.key]); return; }
    const lift = e.target.closest(".lift-btn");
    if (lift) { openDetail(lift.dataset.key); return; }

    const btn = e.target.closest(".wx-toggle, .cam-toggle");
    if (!btn) return;
    const k = btn.dataset.key;
    const isCam = btn.classList.contains("cam-toggle");
    const set = isCam ? state.camsOpen : state.expanded;
    if (set.has(k)) set.delete(k);
    else set.add(k);
    render();
    // Fokus auf dem Knopf halten (Tastaturbedienung)
    const again = els.rows.querySelector(`.${isCam ? "cam" : "wx"}-toggle[data-key="${CSS.escape(k)}"]`);
    if (again) again.focus();
  });
  els.reload.addEventListener("click", load);

  // Historischer Schneestand
  els.histDate.min = ARCHIVE_MIN;
  els.histDate.max = todayStr();
  els.histDate.value = todayStr();
  els.histDate.addEventListener("change", () => setDate(els.histDate.value));
  els.histChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    setDate(shiftDate(todayStr(), +chip.dataset.days || 0, +chip.dataset.years || 0));
  });

  // Suche
  els.search.addEventListener("input", () => { active = -1; renderSearch(); });
  els.search.addEventListener("focus", renderSearch);
  els.search.addEventListener("blur", closeSearch);
  els.search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + matches.length) % matches.length;
      renderSearch();
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Gewählter Treffer, sonst der erste, der noch nicht in der Liste ist
      const pick = matches[active] || matches.find((r) => !inList(r));
      if (pick) addResort(key(pick));
    } else if (e.key === "Escape") {
      closeSearch();
    }
  });
  // mousedown statt click, damit das Feld nicht vorher den Fokus verliert
  els.searchResults.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const li = e.target.closest(".sr-item");
    if (li && li.getAttribute("aria-disabled") !== "true") addResort(li.dataset.key);
  });
  els.rows.addEventListener("animationend", (e) => {
    if (e.target.classList.contains("flash")) e.target.classList.remove("flash");
  });

  load();
})();
