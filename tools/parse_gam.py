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
  
  %run C:/Users/aaron/OneDrive/Dokumente/GitHub/DarkHarold2/tools/parse_gam.py "C:/Users/aaron/OneDrive/Dokumente/GitHub/DarkHarold2/data/"
  Warning: VAULT13.GAM not found in C:/Users/aaron/OneDrive/Dokumente/GitHub/DarkHarold2/data/
  
  
"""

import json
import os
import re
import struct
import sys
from pathlib import Path
from typing import Optional


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


def parse_gam_text(filepath: str, section: Optional[str] = None) -> dict[int, int]:
    """Parse a text-format .GAM file the way CE game.cc globalVarsRead does.

    Skip to the line starting with `section` (strncmp of 16 chars), e.g.
    "GAME_GLOBAL_VARS:" (vault13.gam) or "MAP_GLOBAL_VARS:" (map .gam). After it,
    every line that is not empty and does not start with "//" is the next variable,
    in file order. Its value is the integer after '=' (text after ';' is cut off),
    or 0. The trailing "// 0" / "//(0)" comments are not used for the index.

    Returns a dict mapping variable index to value.
    """
    vars_dict: dict[int, int] = {}
    int_re = re.compile(r"\s*([-+]?\d+)")
    with open(filepath, "r", encoding="latin-1", newline=None) as f:
        lines = [line.rstrip("\n") for line in f]

    i = 0
    if section is not None:
        while i < len(lines) and not lines[i].startswith(section[:16]):
            i += 1
        i += 1

    for line in lines[i:]:
        if line == "" or line.startswith("//"):
            continue
        semi = line.find(";")
        if semi != -1:
            line = line[:semi]
        value = 0
        eq = line.find("=")
        if eq != -1:
            m = int_re.match(line[eq + 1:])
            if m:
                value = int(m.group(1))
        vars_dict[len(vars_dict)] = value

    return vars_dict


def is_binary_file(filepath: str) -> bool:
    """Heuristic: check if a file is binary by looking for null bytes."""
    with open(filepath, "rb") as f:
        chunk = f.read(512)
    return b"\x00" in chunk


def parse_gam_file(filepath: str, section: Optional[str] = None) -> dict[int, int]:
    """Parse a .GAM file (auto-detecting binary vs text format).

    Returns a dict mapping variable index to initial value.
    """
    if is_binary_file(filepath):
        values = parse_gam_binary(filepath)
        return {i: v for i, v in enumerate(values)}
    else:
        return parse_gam_text(filepath, section)


def find_case_insensitive(directory: str, filename: str) -> Optional[str]:
    """Find a file in a directory with case-insensitive matching."""
    target = filename.lower()
    try:
        for entry in os.listdir(directory):
            if entry.lower() == target:
                return os.path.join(directory, entry)
    except FileNotFoundError:
        pass
    return None


def convert_gam(data_dir: str = "data") -> None:
    """data/data/vault13.gam -> data/gvars.json, data/maps/*.gam -> *.mvars.json.

    CE loads the global vars from "data/vault13.gam" (game.cc gameInit), i.e.
    data/data/vault13.gam after DAT extraction. data/maps/vault13.gam is the
    Vault 13 *map's* vars file, not the global one.
    """
    # Determine output directory (project root data/)
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    out_data_dir = project_root / "data"
    out_maps_dir = out_data_dir / "maps"
    out_maps_dir.mkdir(parents=True, exist_ok=True)

    # --- Parse VAULT13.GAM for global variables ---
    vault13_path = (find_case_insensitive(os.path.join(data_dir, "data"), "VAULT13.GAM")
                    or find_case_insensitive(data_dir, "VAULT13.GAM"))
    if vault13_path:
        print(f"Parsing global vars from: {vault13_path}")
        gvars = parse_gam_file(vault13_path, "GAME_GLOBAL_VARS:")
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

            mvars = parse_gam_file(gam_path, "MAP_GLOBAL_VARS:")
            # Always write the file (possibly "{}") so the engine never requests a
            # missing one (CE map.cc: a map without vars just has none).
            mvars_out = {str(k): v for k, v in sorted(mvars.items())}
            mvars_path = out_maps_dir / f"{map_name}.mvars.json"
            with open(mvars_path, "w") as f:
                json.dump(mvars_out, f, indent=2)
            print(f"  {map_name}: {len(mvars)} map vars -> {mvars_path}")

        # Maps without a .GAM have no map vars (CE globalVarsRead fails, count 0).
        gam_names = {os.path.splitext(f)[0].lower() for f in gam_files}
        for map_file in sorted(os.listdir(maps_dir)):
            map_name, ext = os.path.splitext(map_file)
            if ext.lower() != ".map" or map_name.lower() in gam_names:
                continue
            with open(out_maps_dir / f"{map_name.lower()}.mvars.json", "w") as f:
                json.dump({}, f)
    else:
        print(
            f"Warning: No maps/ directory found in {data_dir}",
            file=sys.stderr,
        )

    print("\nDone.")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <extracted_data_dir>", file=sys.stderr)
        print(
            "\n  <extracted_data_dir> (normally data/) should contain data/VAULT13.GAM and maps/.",
            file=sys.stderr,
        )
        sys.exit(1)

    data_dir = sys.argv[1]
    if not os.path.isdir(data_dir):
        print(f"Error: '{data_dir}' is not a directory", file=sys.stderr)
        sys.exit(1)
    convert_gam(data_dir)


if __name__ == "__main__":
    main()
