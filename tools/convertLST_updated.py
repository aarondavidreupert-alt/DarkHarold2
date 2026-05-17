import json
import os
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
        # sndlist.lst is a special 4-tuple format — handled by convertSndList.py
        if lst_path.name.lower() == 'sndlist.lst':
            continue

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


def convert_sndlist(
    lut_dir: str | Path = _REPO_ROOT / 'lut',
) -> None:
    """
    Convert sound/sfx/sndlist.lst (already converted to JSON array by convert_lsts
    if it weren't skipped) — but since sndlist.lst is skipped above, this function
    reads the raw LST directly from data/ and writes lut/sfx_lookup.json.

    Format of sndlist.lst:
        flat[0]          = total count string, e.g. "1361"
        flat[1..N] in 4-tuples: name, filesize, samples, seq_id
    """
    lut_dir = Path(lut_dir)
    snd_lst = _REPO_ROOT / 'data' / 'sound' / 'sfx' / 'sndlist.lst'
    out_path = lut_dir / 'sfx_lookup.json'

    if not snd_lst.exists():
        print(f"WARNING: sndlist.lst not found at {snd_lst}, skipping SFX lookup generation.")
        return

    content = snd_lst.read_text(encoding='latin-1')
    # Split exactly like convert_lsts — '\n' split, strip '\r'
    flat = [line.rstrip('\r') for line in content.split('\n')]
    # Remove empty trailing entry if present
    while flat and flat[-1] == '':
        flat.pop()

    # flat[0] = total count; skip it
    entries = flat[1:]
    lut = {}
    i = 0
    while i + 3 < len(entries):
        name     = entries[i].strip()      # e.g. "AMMO.ACM"
        filesize = entries[i + 1].strip()  # e.g. "30690"
        samples  = entries[i + 2].strip()  # e.g. "5010"
        # entries[i + 3] = seq_id — discard
        i += 4

        key = name.upper().replace('.ACM', '')
        if not key:
            continue

        try:
            lut[key] = {
                "file":     name,
                "filesize": int(filesize),
                "samples":  int(samples),
            }
        except ValueError:
            print(f"WARNING: skipping malformed SFX entry at index {i - 4}: {entries[i-4:i]}")

    lut_dir.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(lut, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Wrote {len(lut)} SFX entries → {out_path}")
    print("AMMO   →", lut.get("AMMO"))
    print("ANIMAL →", lut.get("ANIMAL"))


if __name__ == '__main__':
    convert_lsts()
    convert_sndlist()