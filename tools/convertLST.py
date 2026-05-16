import os
import json
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent


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


def convert_lsts(
    data_dir: str | Path = _REPO_ROOT / 'data',
    out_dir: str | Path = _REPO_ROOT / 'lut/lst',
) -> None:
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    seen: dict[str, Path] = {}
    converted = 0

    for lst_path in data_dir.rglob('*.lst'):
        rel_no_ext = lst_path.relative_to(data_dir).with_suffix('')
        json_name = lst_path_to_json_name(str(rel_no_ext))
        out_path = out_dir / (json_name + '.json')

        if json_name in seen:
            print(f"WARNING: name collision — {lst_path} and {seen[json_name]} both → {json_name}.json")
        seen[json_name] = lst_path

        content = lst_path.read_text(encoding='latin-1')

        # Split on '\n' exactly — must match data.ts::loadLst() index-for-index.
        # Strip '\r' per entry so CRLF files don't corrupt values.
        # NOTE: a trailing newline intentionally produces a final "" entry,
        # preserving the index contract with getLstId().
        lines = [line.rstrip('\r') for line in content.split('\n')]

        out_path.write_text(json.dumps(lines, ensure_ascii=False), encoding='utf-8')
        converted += 1

    print(f"Converted {converted} LST files → {out_dir}/")


if __name__ == '__main__':
    convert_lsts()