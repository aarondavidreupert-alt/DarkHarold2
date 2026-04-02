#!/usr/bin/env python3
"""
parse_gam.py - Parse Fallout 2 .GAM files and output JSON for DarkFO.

Extracts global variables (GVARs) from VAULT13.GAM and map variables (MVARs)
from per-map .GAM files, writing them as JSON for the game engine to load.

Output:
  data/gvars.json                  - Global variable initial values from VAULT13.GAM
  data/maps/<mapname>.mvars.json   - Map variable initial values per map

Usage:
  python tools/parse_gam.py <fallout2_data_dir>

  The <fallout2_data_dir> should contain:
    - VAULT13.GAM (or vault13.gam) for global variables
    - maps/ directory with per-map .GAM files for map variables

Fallout 2 .GAM binary format (global vars):
  The file contains a header followed by global variable values stored as
  consecutive big-endian int32 values. The number of GVARs is read from
  the file header.

Fallout 2 .GAM text format (also supported):
  Lines like: GVAR_PLAYER_REPUTATION  :=50;  //(0)
  or:         MVAR_Darion_Attack      :=0;   //(0)
"""

import json
import os
import re
import struct
import sys
from pathlib import Path


def parse_gam_binary(filepath: str) -> list[int]:
    """Parse a binary .GAM file and extract global variable values.

    The binary .GAM format stores variables as consecutive big-endian
    signed 32-bit integers. The first int32 is the variable count,
    followed by that many int32 values.
    """
    with open(filepath, "rb") as f:
        data = f.read()

    if len(data) < 4:
        print(f"  Warning: File too small ({len(data)} bytes), skipping", file=sys.stderr)
        return []

    # Try reading as: count (int32 BE) followed by count int32 values
    count = struct.unpack_from(">i", data, 0)[0]

    # Sanity check: count should be reasonable (Fallout 2 has ~632 GVARs)
    expected_size = 4 + count * 4
    if 0 < count <= 2000 and expected_size <= len(data):
        values = []
        for i in range(count):
            val = struct.unpack_from(">i", data, 4 + i * 4)[0]
            values.append(val)
        return values

    # Fallback: treat entire file as flat array of int32 BE values
    # (some .GAM variants omit the count header)
    if len(data) % 4 == 0:
        count = len(data) // 4
        values = []
        for i in range(count):
            val = struct.unpack_from(">i", data, i * 4)[0]
            values.append(val)
        return values

    print(f"  Warning: Unrecognized binary format in {filepath}", file=sys.stderr)
    return []


def parse_gam_text(filepath: str) -> dict[int, int]:
    """Parse a text-format .GAM file with := assignments.

    Supports lines like:
      GVAR_PLAYER_REPUTATION  :=50;  //(0)
      MVAR_Darion_Attack      :=0;   //(1)

    Returns a dict mapping variable index to value.
    """
    vars_dict: dict[int, int] = {}
    pattern = re.compile(
        r"^\s*((?:GVAR|MVAR)_\w+)\s*:=\s*(-?\d+)\s*;\s*//\s*\((\d+)\)",
        re.IGNORECASE,
    )

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = pattern.match(line)
            if m:
                _name = m.group(1)
                value = int(m.group(2))
                index = int(m.group(3))
                vars_dict[index] = value

    return vars_dict


def is_binary_file(filepath: str) -> bool:
    """Heuristic: check if a file is binary by looking for null bytes."""
    with open(filepath, "rb") as f:
        chunk = f.read(512)
    return b"\x00" in chunk


def parse_gam_file(filepath: str) -> dict[int, int]:
    """Parse a .GAM file (auto-detecting binary vs text format).

    Returns a dict mapping variable index to initial value.
    """
    if is_binary_file(filepath):
        values = parse_gam_binary(filepath)
        return {i: v for i, v in enumerate(values)}
    else:
        return parse_gam_text(filepath)


def find_case_insensitive(directory: str, filename: str) -> str | None:
    """Find a file in a directory with case-insensitive matching."""
    target = filename.lower()
    try:
        for entry in os.listdir(directory):
            if entry.lower() == target:
                return os.path.join(directory, entry)
    except FileNotFoundError:
        pass
    return None


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <fallout2_data_dir>", file=sys.stderr)
        print(
            "\n  <fallout2_data_dir> should contain VAULT13.GAM and a maps/ directory.",
            file=sys.stderr,
        )
        sys.exit(1)

    data_dir = sys.argv[1]
    if not os.path.isdir(data_dir):
        print(f"Error: '{data_dir}' is not a directory", file=sys.stderr)
        sys.exit(1)

    # Determine output directory (project root data/)
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    out_data_dir = project_root / "data"
    out_maps_dir = out_data_dir / "maps"
    out_maps_dir.mkdir(parents=True, exist_ok=True)

    # --- Parse VAULT13.GAM for global variables ---
    vault13_path = find_case_insensitive(data_dir, "VAULT13.GAM")
    if vault13_path:
        print(f"Parsing global vars from: {vault13_path}")
        gvars = parse_gam_file(vault13_path)
        print(f"  Found {len(gvars)} global variables")

        # Write gvars.json - keys are string representations of indices
        gvars_out = {str(k): v for k, v in sorted(gvars.items())}
        gvars_path = out_data_dir / "gvars.json"
        with open(gvars_path, "w") as f:
            json.dump(gvars_out, f, indent=2)
        print(f"  Wrote {gvars_path}")
    else:
        print(f"Warning: VAULT13.GAM not found in {data_dir}", file=sys.stderr)

    # --- Parse per-map .GAM files for map variables ---
    maps_dir = find_case_insensitive(data_dir, "maps")
    if maps_dir and os.path.isdir(maps_dir):
        gam_files = [
            f
            for f in os.listdir(maps_dir)
            if f.lower().endswith(".gam")
        ]
        print(f"\nFound {len(gam_files)} map .GAM files in {maps_dir}")

        for gam_file in sorted(gam_files):
            gam_path = os.path.join(maps_dir, gam_file)
            map_name = os.path.splitext(gam_file)[0].lower()

            mvars = parse_gam_file(gam_path)
            if mvars:
                mvars_out = {str(k): v for k, v in sorted(mvars.items())}
                mvars_path = out_maps_dir / f"{map_name}.mvars.json"
                with open(mvars_path, "w") as f:
                    json.dump(mvars_out, f, indent=2)
                print(f"  {map_name}: {len(mvars)} map vars -> {mvars_path}")
            else:
                print(f"  {map_name}: no map vars found (empty or unrecognized format)")
    else:
        print(
            f"Warning: No maps/ directory found in {data_dir}",
            file=sys.stderr,
        )

    print("\nDone.")


if __name__ == "__main__":
    main()
