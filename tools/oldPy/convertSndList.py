import json
from pathlib import  Path
import os

_REPO_ROOT = Path(os.getcwd()).parent  # or Path(__file__).resolve().parent.parent when run as script
_IN  = _REPO_ROOT / 'lut' / 'lst' / 'sound_sfx_sndlist.json'
_OUT = _REPO_ROOT / 'lut' / 'sfx_lookup.json'

import os

_REPO_ROOT = Path(os.getcwd()).parent
_IN  = _REPO_ROOT / 'lut' / 'lst' / 'sound_sfx_sndlist.json'
_OUT = _REPO_ROOT / 'lut' / 'sfx_lookup.json'

with open(_IN, encoding='utf-8') as f:
    flat = json.load(f)

# flat[0] = total count ("1361")
# then repeating 4-tuples: name, filesize, samples, seq_id
entries = flat[1:]
lut = {}
i = 0
while i + 3 < len(entries):
    name     = entries[i].strip()      # e.g. "AMMO.ACM"
    filesize = entries[i + 1].strip()  # e.g. "30690"
    samples  = entries[i + 2].strip()  # e.g. "5010"
    seq      = entries[i + 3].strip()  # e.g. "2"  — discard
    i += 4

    key = name.upper().replace('.ACM', '')
    if not key:
        continue

    lut[key] = {
        "file":     name,
        "filesize": int(filesize),
        "samples":  int(samples),
    }

_OUT.parent.mkdir(parents=True, exist_ok=True)
with open(_OUT, 'w', encoding='utf-8') as f:
    json.dump(lut, f, indent=2, ensure_ascii=False)

print(f"Wrote {len(lut)} SFX entries → {_OUT}")
print("AMMO   →", lut.get("AMMO"))
print("ANIMAL →", lut.get("ANIMAL"))