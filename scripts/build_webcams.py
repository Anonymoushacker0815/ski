#!/usr/bin/env python3
"""Ordnet jedem Skigebiet (LiftRadar) Webcams in der Nähe zu und schreibt data/webcams.json.

Quellen:
  - Panomax (api.panomax.com, öffentliche Kameraliste): 360°-Panoramen, Bilder werden eingebettet
  - foto-webcam.eu (Metadaten-Liste): nur verlinkt, die Bilder dürfen nicht übernommen werden

Zuordnung: Kamera höchstens RADIUS_KM vom Gebietspunkt entfernt, oder bis NAME_RADIUS_KM,
wenn ein markantes Wort aus dem Gebietsnamen im Kameranamen/Betreiber vorkommt.

Nur Standardbibliothek, damit es ohne Installation lokal und in GitHub Actions läuft.
"""

import gzip
import json
import math
import os
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone

LIFTRADAR_INDEX = "https://liftradar.eu/json/index.json"
PANOMAX_LIST = "https://api.panomax.com/1.0/instances/lists/public"
FOTO_WEBCAM_LIST = "https://www.foto-webcam.eu/webcam/include/metadata.php"

RADIUS_KM = 5
NAME_RADIUS_KM = 12
MAX_PER_SOURCE = 4

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "webcams.json")

# Wörter, die in vielen Gebietsnamen vorkommen und nichts über den Ort sagen
GENERIC = {
    "skigebiet", "skiarena", "arena", "resort", "bergbahn", "bergbahnen", "lifte", "lift",
    "skizentrum", "skilifte", "skilift", "skischaukel", "region", "ski", "snow", "park",
    "berg", "alpe", "alpen", "tal", "see", "dorf", "ort", "the", "und", "and", "mountain",
    "mountains", "gletscher", "glacier", "hohe", "hoehe", "sankt", "kaiser", "wilder",
}


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ski-webcams/1.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    if raw[:2] == b"\x1f\x8b":  # Panomax liefert gzip auch ungefragt
        raw = gzip.decompress(raw)
    return json.loads(raw)


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).replace("ß", "ss")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tokens(name):
    return {t for t in norm(name).split() if len(t) >= 4 and t not in GENERIC}


def dist_km(lat1, lon1, lat2, lon2):
    p = math.radians
    a = (math.sin(p(lat2 - lat1) / 2) ** 2
         + math.cos(p(lat1)) * math.cos(p(lat2)) * math.sin(p(lon2 - lon1) / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(a))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_cams():
    cams = []
    for c in fetch_json(PANOMAX_LIST):
        lat, lon = num(c.get("latitude")), num(c.get("longitude"))
        if lat is None or lon is None or not c.get("camId") or not c.get("webcamUrl"):
            continue
        elev = num(c.get("elevation"))
        cams.append({
            "id": f"p{c['camId']}",
            "lat": lat, "lon": lon,
            "hay": norm(" ".join(str(c.get(f) or "") for f in
                                 ("name", "customerName", "customerInstanceName", "city", "location"))),
            "out": {
                "s": "p",
                "cam": c["camId"],
                "n": (c.get("name") or c.get("customerInstanceName") or "").strip(),
                "u": c["webcamUrl"],
                "e": round(elev) if elev else None,
            },
        })
    for c in fetch_json(FOTO_WEBCAM_LIST).get("cams", []):
        if c.get("offline") or c.get("hidden"):
            continue
        lat, lon = num(c.get("latitude")), num(c.get("longitude"))
        if lat is None or lon is None or not c.get("id"):
            continue
        elev = num(c.get("elevation"))
        cams.append({
            "id": f"f{c['id']}",
            "lat": lat, "lon": lon,
            "hay": norm(" ".join(str(c.get(f) or "") for f in ("name", "title", "keywords"))),
            "out": {
                "s": "f",
                "fid": c["id"],
                "n": (c.get("name") or c["id"]).strip(),
                "t": (c.get("title") or "").strip(),
                "u": c.get("link") or f"https://www.foto-webcam.eu/webcam/{c['id']}/",
                "e": round(elev) if elev else None,
            },
        })
    return cams


def match(resorts, cams):
    used = {}
    result = {}
    for r in resorts:
        loc = r.get("location") or {}
        lat, lon = num(loc.get("lat")), num(loc.get("lon"))
        if lat is None or lon is None:
            continue
        toks = tokens(r.get("name"))
        found = []
        for c in cams:
            d = dist_km(lat, lon, c["lat"], c["lon"])
            if d > NAME_RADIUS_KM:
                continue
            named = any(re.search(rf"\b{re.escape(t)}", c["hay"]) for t in toks)
            if d <= RADIUS_KM or named:
                found.append((not named, d, c))
        if not found:
            continue
        found.sort(key=lambda x: (x[0], x[1]))
        picked = []
        for src in ("p", "f"):
            picked += [x for x in found if x[2]["out"]["s"] == src][:MAX_PER_SOURCE]
        result[f"{r['country']}/{r['id']}"] = [[c["id"], round(d, 1)] for _, d, c in picked]
        for _, _, c in picked:
            used[c["id"]] = c["out"]
    return result, used


def main():
    resorts = fetch_json(LIFTRADAR_INDEX)["resorts"]
    cams = load_cams()
    result, used = match(resorts, cams)
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {"p": "Panomax", "f": "foto-webcam.eu"},
        "cams": dict(sorted(used.items())),
        "resorts": dict(sorted(result.items())),
    }
    # Nur schreiben, wenn sich die Zuordnung geändert hat (sonst kein Commit nötig)
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("cams") == data["cams"] and old.get("resorts") == data["resorts"]:
            print("Webcams unverändert")
            return
    except (OSError, ValueError):
        pass
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT)
    print(f"{len(result)} Skigebiete mit Webcams, {len(used)} Kameras -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:  # noqa: BLE001
        print(f"Fehler: {err}", file=sys.stderr)
        sys.exit(1)
