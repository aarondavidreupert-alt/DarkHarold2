"""
Convert all Fallout 2 .lst files under data/ to pre-baked JSON arrays in lut/lst/.

Split behaviour matches data.ts::loadLst() exactly: split on '\n', not splitlines().
Indices in the output arrays are therefore identical to what getLstId() returns.
"""

import os
import json


def lst_path_to_json_name(rel_no_ext: str) -> str:
    """
    Derive the output JSON filename stem from a path relative to data/ (no extension).

    Consecutive duplicate path components are collapsed so that the redundant
    leaf name is dropped:
        art/critters/critters  → art_critters
        proto/critters/critters → proto_critters
        scripts/scripts         → scripts
    """
    parts = rel_no_ext.replace('\\', '/').split('/')
    deduped: list[str] = []
    for part in parts:
        if not deduped or deduped[-1] != part:
            deduped.append(part)
    return '_'.join(deduped)


def convert_lsts(data_dir: str = 'data', out_dir: str = 'lut/lst') -> None:
    os.makedirs(out_dir, exist_ok=True)

    converted = 0
    for root, _dirs, files in os.walk(data_dir):
        for fname in files:
            if not fname.lower().endswith('.lst'):
                continue

            lst_path = os.path.join(root, fname)
            rel = os.path.relpath(lst_path, data_dir)
            rel_no_ext = os.path.splitext(rel)[0]

            json_name = lst_path_to_json_name(rel_no_ext)
            out_path = os.path.join(out_dir, json_name + '.json')

            with open(lst_path, 'r', encoding='latin-1') as f:
                content = f.read()

            # Split on '\n' exactly — must match data.ts::loadLst() character-for-character.
            # Using splitlines() would silently drop a trailing newline, shifting indices.
            lines = content.split('\n')

            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(lines, f)

            converted += 1

    print(f"Converted {converted} LST files → {out_dir}/")


if __name__ == '__main__':
    convert_lsts()
