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


# ---------------------------------------------------------------------------
# Post-processors
# ---------------------------------------------------------------------------

def _is_trailing(i: int, lines: list) -> bool:
    """True for the final "" sentinel produced by split('\\n') on a newline-terminated file."""
    return i == len(lines) - 1 and lines[i] == ''


def _post_art_critters(lines: list[str]) -> list:
    """Parse 'frm,walk[,run]' entries. Index 0 ('reserv') and blank entries → null."""
    out: list = []
    for i, raw in enumerate(lines):
        if _is_trailing(i, lines):
            out.append(raw)
            continue
        if i == 0:  # "reserv" — reserved slot per FO2 convention
            out.append(None)
            continue
        entry = raw.strip()
        if not entry:
            out.append(None)
            continue
        fields = [f.strip() for f in entry.split(',')]
        obj: dict = {'frm': fields[0], 'walk': int(fields[1])}
        if len(fields) > 2:
            obj['run'] = int(fields[2])
        out.append(obj)
    return out


def _post_art_heads(lines: list[str]) -> list:
    """Parse 'frm,fp,pp,rp' entries. Blank or malformed entries → null."""
    out: list = []
    for i, raw in enumerate(lines):
        if _is_trailing(i, lines):
            out.append(raw)
            continue
        entry = raw.strip()
        if not entry:
            out.append(None)
            continue
        fields = [f.strip() for f in entry.split(',')]
        if len(fields) < 4:
            out.append(None)
            continue
        out.append({
            'frm': fields[0],
            'fp': int(fields[1]),
            'pp': int(fields[2]),
            'rp': int(fields[3]),
        })
    return out


def _post_art_name(lines: list[str]) -> list:
    """Strip to bare name: split on '.', take [0], strip whitespace and ';' comments."""
    out: list = []
    for i, raw in enumerate(lines):
        if _is_trailing(i, lines):
            out.append(raw)
            continue
        stem = raw.split('.')[0]
        if ';' in stem:
            stem = stem[:stem.index(';')]
        stem = stem.strip()
        out.append(stem if stem else None)
    return out


_POST_PROCESSORS: dict[str, object] = {
    'art_critters': _post_art_critters,
    'art_heads':    _post_art_heads,
    'art_intrface': _post_art_name,
    'art_inven':    _post_art_name,
    'art_scenery':  _post_art_name,
    'art_misc':     _post_art_name,
    'art_backgrnd': _post_art_name,
    'art_skilldex': _post_art_name,
}


# ---------------------------------------------------------------------------
# SFX lookup (side-output from sound/sfx/sndlist.lst)
# ---------------------------------------------------------------------------

def _build_sfx_lookup(lines: list[str]) -> dict:
    """
    Build {stem: {file, filesize, samples}} from raw sndlist lines.

    Format: lines[0] = entry count; then repeating groups of 4:
        filename, filesize, samples, _line_idx
    """
    entries = lines[1:]
    if entries and entries[-1] == '':
        entries = entries[:-1]
    lookup: dict = {}
    for i in range(0, len(entries), 4):
        filename = entries[i]
        key = Path(filename).stem
        lookup[key] = {
            'file': filename,
            'filesize': int(entries[i + 1]),
            'samples': int(entries[i + 2]),
        }
    return lookup


# ---------------------------------------------------------------------------
# Main conversion (runs when data/ is present)
# ---------------------------------------------------------------------------

def convert_lsts(
    data_dir: str | Path = _REPO_ROOT / 'data',
    out_dir: str | Path = _REPO_ROOT / 'lut/lst',
) -> int:
    """Convert all .lst files under data_dir to JSON arrays in out_dir.

    Returns the number of files converted.
    """
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

        output = _POST_PROCESSORS[json_name](lines) if json_name in _POST_PROCESSORS else lines
        out_path.write_text(json.dumps(output, ensure_ascii=False), encoding='utf-8')
        converted += 1

        if json_name == 'sound_sfx_sndlist':
            sfx_lookup = _build_sfx_lookup(lines)
            sfx_path = _REPO_ROOT / 'lut' / 'sfx_lookup.json'
            sfx_path.write_text(json.dumps(sfx_lookup, ensure_ascii=False), encoding='utf-8')
            print(f"Wrote sfx_lookup.json ({len(sfx_lookup)} entries)")

    print(f"Converted {converted} LST files → {out_dir}/")
    return converted


# ---------------------------------------------------------------------------
# Re-processor (runs when data/ is absent — applies post-processors to the
# existing raw-string JSON files already committed to lut/lst/)
# ---------------------------------------------------------------------------

def reprocess_lut(
    lut_dir: str | Path = _REPO_ROOT / 'lut/lst',
) -> None:
    """Apply post-processors to existing raw-string JSON files in lut_dir.

    Skips any file whose array already contains non-string elements (already
    processed).  Also regenerates lut/sfx_lookup.json from
    lut/lst/sound_sfx_sndlist.json if present.
    """
    lut_dir = Path(lut_dir)

    for json_path in sorted(lut_dir.glob('*.json')):
        json_name = json_path.stem

        # sfx_lookup side-output
        if json_name == 'sound_sfx_sndlist':
            lines = json.loads(json_path.read_text(encoding='utf-8'))
            sfx_lookup = _build_sfx_lookup(lines)
            sfx_path = _REPO_ROOT / 'lut' / 'sfx_lookup.json'
            sfx_path.write_text(json.dumps(sfx_lookup, ensure_ascii=False), encoding='utf-8')
            print(f"Wrote sfx_lookup.json ({len(sfx_lookup)} entries)")

        if json_name not in _POST_PROCESSORS:
            continue

        lines = json.loads(json_path.read_text(encoding='utf-8'))

        # Skip if already structured (contains a dict or None element before the
        # trailing sentinel — means a previous run already processed this file).
        if any(not isinstance(v, str) for v in lines):
            print(f"Skipping {json_name}.json (already processed)")
            continue

        output = _POST_PROCESSORS[json_name](lines)
        json_path.write_text(json.dumps(output, ensure_ascii=False), encoding='utf-8')
        print(f"Reprocessed {json_name}.json")


if __name__ == '__main__':
    data_dir = _REPO_ROOT / 'data'
    if data_dir.exists():
        convert_lsts()
    else:
        print("data/ not found — reprocessing existing lut/lst/ JSON files")
        reprocess_lut()
