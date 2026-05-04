#!/usr/bin/env python3
"""Generate animations/animations.json from .html files in animations/.

Each entry contains an id (slugified filename), label (extracted from the
<title> tag, falling back to a humanised filename), url (relative to the
repo root) and mtime. Run from the repo root:

    python3 scripts/build-animations-manifest.py
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "animations")
OUT = os.path.join(ROOT, "animations.json")

TITLE_RE = re.compile(r"<title[^>]*>([^<]*)</title>", re.IGNORECASE)


def slugify(stem: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", stem).strip("-").lower()
    return s or "animation"


def humanise(stem: str) -> str:
    return re.sub(r"[-_]+", " ", stem).strip()


def read_title(fullpath: str) -> str | None:
    try:
        with open(fullpath, "r", encoding="utf-8", errors="replace") as fp:
            head = fp.read(8192)
    except OSError:
        return None
    m = TITLE_RE.search(head)
    if not m:
        return None
    title = m.group(1).strip()
    return title or None


def make_entry(filename: str) -> dict:
    stem = filename.rsplit(".", 1)[0]
    fullpath = os.path.join(ROOT, filename)
    label = read_title(fullpath) or humanise(stem)
    return {
        "id": slugify(stem),
        "label": label,
        "url": "animations/" + filename,
        "mtime": int(os.path.getmtime(fullpath)),
    }


def main() -> None:
    if not os.path.isdir(ROOT):
        print(f"animations/ folder not found at {ROOT}", file=sys.stderr)
        sys.exit(1)

    files = sorted(
        f
        for f in os.listdir(ROOT)
        if f.lower().endswith(".html") and not f.startswith(".")
    )
    entries = [make_entry(f) for f in files]
    entries.sort(key=lambda e: e["label"].lower())

    manifest = {"animations": entries}
    with open(OUT, "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, indent=2, ensure_ascii=False)
        fp.write("\n")
    print(f"Wrote {OUT} with {len(entries)} animation(s)")


if __name__ == "__main__":
    main()
