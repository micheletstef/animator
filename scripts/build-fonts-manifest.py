#!/usr/bin/env python3
"""Generate fonts/fonts.json from font files in fonts/. Run from repo root.

With fonttools (use: .venv-fonts/bin/python scripts/build-fonts-manifest.py):
variable fonts include full fvar axes. Otherwise falls back to heuristics.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata

ROOT = os.path.join(os.path.dirname(__file__), "..", "fonts")
OUT = os.path.join(ROOT, "fonts.json")

TAG_LABELS = {
    "wght": "Weight",
    "wdth": "Width",
    "slnt": "Slant",
    "ital": "Italic",
    "opsz": "Optical size",
    "grad": "Grade",
    "xhgt": "x-height",
    "XOPQ": "x opaque",
    "YOPQ": "y opaque",
    "XTRA": "x transparent",
    "YTUC": "y transparent UC",
    "YTAS": "y transparent asc",
    "YTDE": "y transparent desc",
    "YTLC": "y transparent lc",
}


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


def axis_step_hint(tag: str, lo: float, hi: float) -> float | None:
    span = hi - lo
    if tag in ("ital",) or span <= 2.5:
        return 1.0
    if tag == "slnt":
        return 0.25
    if span <= 40:
        return 0.5
    if span <= 200:
        return 1.0
    return None


def read_fvar_axes(fullpath: str) -> list[dict] | None:
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return None
    font = None
    try:
        font = TTFont(fullpath, lazy=True)
        if "fvar" not in font:
            return None
        name_tbl = font.get("name")
        out: list[dict] = []
        for ax in font["fvar"].axes:
            tag = ax.axisTag
            if isinstance(tag, bytes):
                tag = tag.decode("latin-1").strip()
            nm = None
            if name_tbl is not None and getattr(ax, "axisNameID", None):
                nm = name_tbl.getDebugName(ax.axisNameID)
            if not nm:
                nm = TAG_LABELS.get(tag, tag)
            lo, hi, dv = float(ax.minValue), float(ax.maxValue), float(ax.defaultValue)
            d: dict = {
                "tag": tag,
                "name": nm,
                "min": lo,
                "max": hi,
                "default": dv,
            }
            st = axis_step_hint(tag, lo, hi)
            if st is not None:
                d["step"] = st
            out.append(d)
        return out or None
    except Exception:
        return None
    finally:
        if font is not None:
            try:
                font.close()
            except Exception:
                pass


def variable_axes_fallback(filename: str) -> list[dict]:
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
    fullpath = os.path.join(ROOT, filename)
    if is_variable(filename):
        axes = read_fvar_axes(fullpath) or variable_axes_fallback(filename)
        return {
            "id": fid,
            "label": label,
            "path": path,
            "cssFamily": cf,
            "variable": True,
            "axes": axes,
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
