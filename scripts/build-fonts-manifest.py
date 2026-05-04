#!/usr/bin/env python3
"""Generate fonts/fonts.json from font files in fonts/. Run from repo root."""
from __future__ import annotations

import json
import os
import re
import unicodedata

ROOT = os.path.join(os.path.dirname(__file__), "..", "fonts")
OUT = os.path.join(ROOT, "fonts.json")


def classify(name: str) -> str:
    if name.lower().endswith(".ttf") and "variable" in name.lower():
        return "Variables"
    if name.startswith("ABCIkarusContrastExtended"):
        return "Contrast extended"
    if name.startswith("ABCIkarusContrastCondensed"):
        return "Contrast condensed"
    if name.startswith("ABCIkarusContrast"):
        return "Contrast"
    if name.startswith("ABCIkarusFlairExtended"):
        return "Flair extended"
    if name.startswith("ABCIkarusFlairCondensed"):
        return "Flair condensed"
    if name.startswith("ABCIkarusFlair"):
        return "Flair"
    if name.startswith("ABCIkarusExtended"):
        return "Extended"
    if name.startswith("ABCIkarusCondensed"):
        return "Condensed"
    if name.startswith("ABCIkarus"):
        return "Ikarus"
    return "Ikarus"


def css_family(filename: str) -> str:
    stem = re.sub(r"\.(otf|ttf)$", "", filename, flags=re.I)
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", stem).strip("-").lower()
    return "anim-" + slug


def is_variable(filename: str) -> bool:
    return filename.lower().endswith(".ttf") and "variable" in filename.lower()


def variable_axes(filename: str) -> list[dict]:
    name = filename
    if "WidthVariable" in name:
        return [
            {"tag": "wght", "name": "Weight", "min": 100, "max": 900, "default": 400},
            {"tag": "wdth", "name": "Width", "min": 50, "max": 200, "default": 100, "step": 1},
        ]
    if "PlusVariable" in name:
        return [
            {"tag": "wght", "name": "Weight", "min": 100, "max": 900, "default": 400},
            {"tag": "wdth", "name": "Width", "min": 60, "max": 140, "default": 100, "step": 1},
        ]
    return [{"tag": "wght", "name": "Weight", "min": 100, "max": 900, "default": 400}]


def static_weight_style(stem: str) -> tuple[int, str]:
    low = stem.lower()
    style = "italic" if "italic" in low else "normal"
    if "ultra" in low:
        w = 950
    elif "black" in low:
        w = 900
    elif "heavy" in low:
        w = 800
    elif "bold" in low:
        w = 700
    elif "medium" in low:
        w = 500
    elif "light" in low:
        w = 300
    elif "thin" in low:
        w = 100
    else:
        w = 400
    return w, style


def make_entry(filename: str) -> dict:
    stem = filename.rsplit(".", 1)[0]
    label = stem.replace("-", " ")
    path = filename
    cf = css_family(filename)
    fid = stem
    if is_variable(filename):
        return {
            "id": fid,
            "label": label,
            "path": path,
            "cssFamily": cf,
            "variable": True,
            "axes": variable_axes(filename),
        }
    w, st = static_weight_style(stem)
    return {
        "id": fid,
        "label": label,
        "path": path,
        "cssFamily": cf,
        "weight": w,
        "style": st,
    }


def main() -> None:
    files = sorted(
        f
        for f in os.listdir(ROOT)
        if f.lower().endswith((".otf", ".ttf")) and f != "fonts.json"
    )

    group_order: list[tuple[str, str]] = [
        ("ikarus", "Ikarus"),
        ("condensed", "Condensed"),
        ("extended", "Extended"),
        ("contrast", "Contrast"),
        ("contrast-condensed", "Contrast condensed"),
        ("contrast-extended", "Contrast extended"),
        ("flair", "Flair"),
        ("flair-condensed", "Flair condensed"),
        ("flair-extended", "Flair extended"),
        ("variables", "Variables"),
    ]
    label_to_key = {label: gid for gid, label in group_order}
    buckets: dict[str, list[dict]] = {gid: [] for gid, _ in group_order}

    for f in files:
        lab = classify(f)
        gid = label_to_key.get(lab, "ikarus")
        buckets[gid].append(make_entry(f))

    for gid in buckets:
        buckets[gid].sort(key=lambda e: unicodedata.normalize("NFKD", e["label"]).lower())

    groups = []
    for gid, label in group_order:
        fonts = buckets[gid]
        if fonts:
            groups.append({"id": gid, "label": label, "fonts": fonts})

    manifest = {
        "defaultFontId": "ABCIkarus-Regular",
        "groups": groups,
    }
    with open(OUT, "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent=2, ensure_ascii=False)
        fp.write("\n")
    print("Wrote", OUT, "with", sum(len(g["fonts"]) for g in groups), "fonts in", len(groups), "groups")


if __name__ == "__main__":
    main()
