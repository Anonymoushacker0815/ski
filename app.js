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
  };

  const state = {
    all: [], // alle Skigebiete von LiftRadar (Europa)
    resorts: [], // angezeigte Skigebiete (Reihenfolge wie in list)
    list: new Set(loadList() || DEFAULT_LIST), // Schlüssel "land/id" der eigenen Liste
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

  // Gemeldete Schneehöhe Berg, sonst Modellwert (für Sortierung)
  function snowValue(r) {
    if (r.snow && r.snow.mountain_cm != null) return r.snow.mountain_cm;
    const m = modelOf(r);
    return m && m.snowCm != null ? m.snowCm : null;
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
      const index = await getJSON(`${LIFTRADAR}/json/index.json`);
      state.generatedAt = index.generated_at;
      state.all = index.resorts;
      state.resorts = state.all.filter(inList);
      if (els.showWeather.checked) state.resorts.forEach((r) => state.expanded.add(key(r)));
      els.search.disabled = false;
      searchIndex = null; // neu aufbauen mit frischen Daten
      searchHint();
      render();

      // Details, Wetter und (falls ein Datum gewählt ist) Verlauf parallel nachladen
      state.ownDays = {};
      state.lrHistory = {};
      await Promise.all([
        loadDetails(state.resorts),
        loadWeather(state.resorts),
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
    renderHistory(view);
    renderSummary(view);
    els.lastColHead.textContent = hist ? "Neuschnee am Tag" : "Letzter Schneefall";

    if (hist && state.histLoading) {
      els.rows.innerHTML =
        `<tr class="placeholder"><td colspan="6">Lade Schneestand vom ${esc(fmtDay(state.histDate))} …</td></tr>`;
      return;
    }
    if (!state.resorts.length && state.all.length) {
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
          ? stat(`≈ ${fmt(snowValue(bestModel))} cm`, `Höchste Modell-Schneehöhe: ${esc(bestModel.name)}`)
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
    const m = modelOf(r);
    if (which === "mountain_cm" && m && m.snowCm != null) {
      const elev = m.elevation != null ? ` für ${fmt(Math.round(m.elevation))} m` : "";
      const src = r.hist ? `Open-Meteo-Archiv, Tagesmittel ${fmtDay(state.histDate)}` : "Open-Meteo";
      return `<span class="model" title="Modellwert ${src}${elev} – vom Skigebiet nicht gemeldet">≈ ${fmt(m.snowCm)} cm</span>`;
    }
    return '<span class="na">–</span>';
  }

  function liftsCell(r) {
    const l = r.lifts;
    if (!l || l.total == null) return '<span class="na">–</span>';
    return `<div class="count">${fmt(l.open)} <small>/ ${fmt(l.total)}</small></div>
      <div class="bar" aria-hidden="true"><span style="width:${pct(l.open, l.total)}%"></span></div>`;
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

  function weatherRowHTML(r) {
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
    return `<tr class="wx-row">
        <td colspan="6">
          <div class="wx-head">7-Tage-Prognose${elev}${now}</div>
          <div class="wx-days">${days}</div>
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

    return `<tr data-key="${esc(key(r))}" class="${r.status === "open" ? "is-open" : "is-closed"}${isOpen ? " is-expanded" : ""}">
      <td>
        <div class="name-line">
          <div class="name">${name}</div>
          <button type="button" class="remove-btn" data-key="${esc(key(r))}" title="Aus der Liste entfernen" aria-label="${esc(r.name)} aus der Liste entfernen">✕</button>
        </div>
        <div class="place">${esc(placeLabel(r))}</div>
        <div class="meta">
          <span class="badge ${esc(r.status)}">${esc(status.label)}</span>
          ${updated ? `<span class="updated">Stand ${esc(updated)}</span>` : ""}
          ${sourceText ? `<span class="updated src-${esc(hist.source)}" title="${esc(sourceTitle)}">${esc(sourceText)}</span>` : ""}
        </div>
        ${hist ? "" : weatherButton(r, isOpen)}
      </td>
      <td class="num" data-label="Schnee Berg">${snowCell(r, "mountain_cm")}</td>
      <td class="num" data-label="Schnee Tal">${snowCell(r, "valley_cm")}</td>
      <td data-label="Lifte offen">${liftsCell(r)}</td>
      <td data-label="Pisten offen">${slopesCell(r)}</td>
      <td data-label="${hist ? "Neuschnee am Tag" : "Letzter Schneefall"}">${lastCell}</td>
    </tr>${isOpen ? weatherRowHTML(r) : ""}`;
  }

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
    state.resorts = state.all.filter(inList);
    if (els.showWeather.checked) state.resorts.forEach((r) => state.expanded.add(key(r)));
    render();
    searchHint("Liste auf die 10 größten Skigebiete Österreichs zurückgesetzt.");
    const missing = state.resorts.filter((r) => !state.details[key(r)]);
    if (missing.length) {
      await Promise.all([loadDetails(missing), loadWeather(missing), loadHistory(missing)]);
      render();
    }
  }

  async function addResort(k) {
    const r = state.all.find((x) => key(x) === k);
    if (!r || inList(r)) return;
    state.list.add(k);
    saveList();
    state.resorts.push(r);
    if (els.showWeather.checked) state.expanded.add(k);
    els.search.value = "";
    closeSearch();
    render();
    const hidden = els.onlyOpen.checked && r.status !== "open";
    searchHint(`${r.name} hinzugefügt.` +
      (hidden ? " Es ist gerade geschlossen und wird durch „Nur offene Gebiete“ ausgeblendet." : ""));

    await Promise.all([loadDetails([r]), loadWeather([r]), loadHistory([r])]);
    render();
    const row = els.rows.querySelector(`tr[data-key="${CSS.escape(k)}"]`);
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("flash");
    }
  }

  function removeResort(k) {
    const r = state.resorts.find((x) => key(x) === k);
    if (!r) return;
    state.list.delete(k);
    saveList();
    state.resorts = state.resorts.filter((x) => key(x) !== k);
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
  });
  els.rows.addEventListener("click", (e) => {
    const remove = e.target.closest(".remove-btn");
    if (remove) { removeResort(remove.dataset.key); return; }

    const btn = e.target.closest(".wx-toggle");
    if (!btn) return;
    const k = btn.dataset.key;
    if (state.expanded.has(k)) state.expanded.delete(k);
    else state.expanded.add(k);
    render();
    // Fokus auf dem Knopf halten (Tastaturbedienung)
    const again = els.rows.querySelector(`.wx-toggle[data-key="${CSS.escape(k)}"]`);
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
