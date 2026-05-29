#!/usr/bin/env python3
"""
Audit script: check which violent-death animation FRMs are present per critter,
and which are referenced by code but missing from disk and/or imageMap.json.

Usage:
    python3 tools/audit_death_anims.py <darkharold2-root>

Default root is the parent directory of this script.

IMPORTANT — MISSes are NOT all bugs:

    Fallout 2 does NOT give every critter its own copy of every violent-death
    animation. Instead, the engine falls back to shared animation sets based
    on critter category:

      * Humans (h*, n* prefixes) ALWAYS use hmjmps_<suffix> for fire (be),
        electro (bk), and burst (bj) deaths — these are rendered without
        armor because the engine "strips" you visually. Expect MISS for
        be / bk / bj on every human except hmjmps itself.

      * Super mutants share mamtnt_<suffix> for the same fallback.

      * Other creatures (gecko, scorpion, robot, alien, etc.) have unique
        animation sets — missing entries fall back to plain death (bo).

    The fallback chain is implemented in src/object.ts resolveDeathAnim():
        1. critter's own <base><suffix>
        2. shared category sprite (hmjmps_ / mamtnt_)
        3. normal crumple <base>bo

    A "real" bug is only:
      * MISS on bo for a critter that ever dies in-game (e.g. mabos2, reserv)
      * MISS on the shared base itself (hmjmps_be, mamtnt_be, ...)

Suffix mapping (from src/object.ts getAnimation()):
    bo  -> 'death'           (normal crumple)
    bl  -> 'death-explode'   (sliced/blown apart)  + boss override
    be  -> 'death-fire'      (burning death dance) [shared for humans/mutants]
    bm  -> 'death-plasma'    (burned to nothing)
    bk  -> 'death-electro'   (electrified)          [shared for humans/mutants]
    bg  -> 'death-laser'     (vaporised)
    bj  -> 'death-burst'     (autofire dance)       [shared for humans/mutants]

Exit codes:
    0  no missing death anims
    1  at least one critter is missing one or more violent-death FRMs
       (may still be expected if covered by the shared-fallback chain)
    2  art/critters/ folder not found (assets not extracted)
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

# Suffix -> human-readable death type
DEATH_SUFFIXES = [
    ("bo", "death (normal)"),
    ("bl", "death-explode"),
    ("be", "death-fire"),
    ("bm", "death-plasma"),
    ("bk", "death-electro"),
    ("bg", "death-laser"),
    ("bj", "death-burst"),
]

# Idle suffix — if present, we know this is a real critter base
IDLE_SUFFIX = "aa"


def find_critter_bases(critter_dir: Path) -> set[str]:
    """Scan art/critters/ for *aa.png files; each one represents a critter base."""
    bases: set[str] = set()
    pattern = re.compile(r"^(?P<base>.+?)" + IDLE_SUFFIX + r"\.png$", re.IGNORECASE)
    for png in critter_dir.glob("*.png"):
        m = pattern.match(png.name)
        if m:
            bases.add(m.group("base"))
    return bases


def load_image_map(image_map_path: Path) -> set[str]:
    """Load the registered image keys from imageMap.json."""
    if not image_map_path.is_file():
        return set()
    try:
        data = json.loads(image_map_path.read_text())
    except Exception as e:
        print(f"  warning: failed to parse {image_map_path}: {e}", file=sys.stderr)
        return set()
    # imageMap.json is { "art/critters/hmwarrior_aa": {...metadata...}, ... }
    if isinstance(data, dict):
        return set(data.keys())
    return set()


def check_critter(
    base: str,
    critter_dir: Path,
    registered: set[str],
    art_prefix: str,
) -> dict[str, tuple[bool, bool]]:
    """For each death suffix, return (file_exists, registered)."""
    results: dict[str, tuple[bool, bool]] = {}
    for suffix, _label in DEATH_SUFFIXES:
        filename = f"{base}{suffix}.png"
        file_exists = (critter_dir / filename).is_file()
        registry_key = f"{art_prefix}{base}{suffix}"
        is_registered = registry_key in registered
        results[suffix] = (file_exists, is_registered)
    return results


def fmt_cell(exists: bool, registered: bool) -> str:
    if exists and registered:
        return "  OK   "
    if exists and not registered:
        return " UNREG "  # file on disk, not in registry
    if not exists and registered:
        return " ORPH  "  # in registry, not on disk
    return " MISS  "       # both missing


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        root = Path(argv[1]).resolve()
    else:
        root = Path(__file__).resolve().parent.parent

    critter_dir = root / "art" / "critters"
    image_map_path = root / "art" / "imageMap.json"

    if not critter_dir.is_dir():
        print(f"ERROR: {critter_dir} not found.", file=sys.stderr)
        print("Run the asset pipeline first (pipenv run python setup.py /path/to/Fallout2/).", file=sys.stderr)
        return 2

    print(f"[audit] critter art folder: {critter_dir}")
    print(f"[audit] image map:          {image_map_path}")

    bases = sorted(find_critter_bases(critter_dir))
    if not bases:
        print("ERROR: no critter base art (*aa.png) found.", file=sys.stderr)
        return 2

    registered = load_image_map(image_map_path)
    print(f"[audit] critters found:     {len(bases)}")
    print(f"[audit] image-map entries:  {len(registered)}")
    print()

    # Print header
    suffix_labels = [s for s, _ in DEATH_SUFFIXES]
    header = f"{'critter base':<24}" + "".join(f"{s:^7}" for s in suffix_labels)
    print(header)
    print("-" * len(header))

    art_prefix = "art/critters/"
    missing_count = 0
    unreg_count = 0
    rows_with_problems: list[str] = []

    for base in bases:
        results = check_critter(base, critter_dir, registered, art_prefix)
        row_problems = False
        cells = []
        for suffix, _label in DEATH_SUFFIXES:
            exists, is_reg = results[suffix]
            cells.append(fmt_cell(exists, is_reg))
            if not exists:
                missing_count += 1
                row_problems = True
            elif not is_reg:
                unreg_count += 1
                row_problems = True
        row = f"{base:<24}" + "".join(cells)
        if row_problems:
            rows_with_problems.append(row)
        # Print every row to give full context; mark problem rows with *
        marker = " *" if row_problems else ""
        print(row + marker)

    print()
    print("Legend:  OK = file + registry present   UNREG = file on disk, missing in imageMap")
    print("         MISS = file missing on disk    ORPH = in imageMap but no file on disk")
    print()
    print(f"Summary: {len(bases)} critters scanned")
    print(f"         {missing_count} missing FRM files (root cause of black-tile deaths)")
    print(f"         {unreg_count}  unregistered FRMs (would need imageMap regeneration)")
    print(f"         {len(rows_with_problems)} critters have at least one problem")

    if missing_count == 0 and unreg_count == 0:
        print("\n[audit] no death-anim asset gaps found. The black-tile bug is likely")
        print("        in code (lazyLoadImage error handling) rather than assets.")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
