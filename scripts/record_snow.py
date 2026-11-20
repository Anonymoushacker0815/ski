#!/usr/bin/env python3
"""Speichert einen Tages-Snapshot aller Skigebiete von LiftRadar.

Schreibt data/history/JJJJ-MM-TT.json (Wiener Datum) und hält
data/history/index.json mit der Liste aller erfassten Tage aktuell.
Mehrere Läufe am selben Tag werden zusammengeführt: neuere Werte gewinnen,
fehlende (null) Werte überschreiben aber keine früher am Tag gemeldeten.

Nur Standardbibliothek, z. B. täglich per launchd/cron starten:
    python3 scripts/record_snow.py
"""

import json
import os
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

INDEX_URL = "https://liftradar.eu/json/index.json"
VIENNA = ZoneInfo("Europe/Vienna")
ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "data" / "history"


def fetch_index():
    req = urllib.request.Request(INDEX_URL, headers={"User-Agent": "ski-snow-recorder/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def minutes(iso):
    """ISO-Zeit auf Minuten kürzen (spart Platz)."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso).isoformat(timespec="minutes")
    except ValueError:
        return iso


def compact(resort):
    """Nur die Kennzahlen, die sich täglich ändern; null-Werte weglassen."""
    snow = resort.get("snow") or {}
    lifts = resort.get("lifts") or {}
    slopes = resort.get("slopes") or {}
    rec = {
        "status": resort.get("status"),
        "mountain_cm": snow.get("mountain_cm"),
        "valley_cm": snow.get("valley_cm"),
        "fresh_cm": snow.get("fresh_cm"),
        "lifts_open": lifts.get("open"),
        "lifts_total": lifts.get("total"),
        "slopes_open": slopes.get("open"),
        "slopes_total": slopes.get("total"),
        "slopes_open_km": slopes.get("open_km"),
        "time": minutes(resort.get("checked_at")),
    }
    return {k: v for k, v in rec.items() if v is not None}


def merge(old, new):
    out = dict(old)
    out.update(new)  # neuere Werte gewinnen, fehlende Felder bleiben erhalten
    return out


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.chmod(tmp, 0o644)  # mkstemp legt 0600 an; Webserver sollen lesen dürfen
    os.replace(tmp, path)  # atomar: Webseite liest nie eine halbe Datei


def main():
    index = fetch_index()
    generated = index.get("generated_at")
    stamp = datetime.fromisoformat(generated) if generated else datetime.now(VIENNA)
    day = stamp.astimezone(VIENNA).date().isoformat()

    path = HISTORY_DIR / f"{day}.json"
    previous = {}
    if path.exists():
        previous = json.loads(path.read_text(encoding="utf-8")).get("resorts", {})

    resorts = dict(previous)
    for r in index.get("resorts", []):
        key = f"{r['country']}/{r['id']}"
        resorts[key] = merge(previous.get(key, {}), compact(r))

    write_json(path, {
        "date": day,
        "source": INDEX_URL,
        "source_generated_at": generated,
        "recorded_at": datetime.now(VIENNA).isoformat(timespec="seconds"),
        "resorts": resorts,
    })

    days = sorted(p.stem for p in HISTORY_DIR.glob("????-??-??.json"))
    write_json(HISTORY_DIR / "index.json", {"dates": days})

    print(f"{datetime.now(VIENNA):%Y-%m-%d %H:%M} gespeichert: {path.name} "
          f"({len(resorts)} Skigebiete, {len(days)} Tage erfasst)")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # Log für launchd
        print(f"Fehler: {exc}", file=sys.stderr)
        sys.exit(1)
