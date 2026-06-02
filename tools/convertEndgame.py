#!/usr/bin/env python3
"""Convert data/endgame.txt and data/enddeath.txt to lut/endgame.json and lut/enddeath.json.

endgame.txt format (space/tab/comma separated, # = comment):
    gvar  value  art_num  voiceOverBaseName  [direction]

enddeath.txt format:
    gvar  value  worldAreaKnown  worldAreaNotKnown  min_level  percentage  voiceOverBaseName

CE ref: src/endgame.cc:endgameEndingInit (0x440770),
        src/endgame.cc:endgameDeathEndingInit (0x440984)
"""

import json
import os
import re
import sys


def read_lst(lst_path):
    """Return list of base filenames (no extension, lowercase) from a .lst file."""
    entries = []
    if not os.path.exists(lst_path):
        return entries
    with open(lst_path, 'r', errors='replace') as f:
        for line in f:
            name = line.strip()
            if name:
                entries.append(os.path.splitext(name)[0].lower())
    return entries


def tokenize(line):
    """Split a line on whitespace and commas, strip comments."""
    idx = line.find('#')
    if idx != -1:
        line = line[:idx]
    return re.split(r'[\s,]+', line.strip())


def parse_endgame(path, intrface_lst):
    endings = []
    with open(path, 'r', errors='replace') as f:
        for raw in f:
            parts = tokenize(raw)
            if len(parts) < 4 or parts[0] == '':
                continue
            try:
                gvar = int(parts[0])
                value = int(parts[1])
                art_num = int(parts[2])
                voice_base = parts[3]
                direction = int(parts[4]) if len(parts) > 4 else 1
            except (ValueError, IndexError):
                continue

            image_path = None
            if 0 <= art_num < len(intrface_lst):
                image_path = 'art/intrface/' + intrface_lst[art_num] + '.png'

            endings.append({
                'gvar': gvar,
                'value': value,
                'artNum': art_num,
                'imagePath': image_path,
                'voiceOverBaseName': voice_base,
                'direction': direction,
            })
    return endings


def parse_enddeath(path):
    endings = []
    with open(path, 'r', errors='replace') as f:
        for raw in f:
            parts = tokenize(raw)
            if len(parts) < 7 or parts[0] == '':
                continue
            try:
                endings.append({
                    'gvar': int(parts[0]),
                    'value': int(parts[1]),
                    'worldAreaKnown': int(parts[2]),
                    'worldAreaNotKnown': int(parts[3]),
                    'minLevel': int(parts[4]),
                    'percentage': int(parts[5]),
                    'voiceOverBaseName': parts[6],
                })
            except (ValueError, IndexError):
                continue
    return endings


def convert_endgame(data_dir='data', lut_dir='lut'):
    lst_path = os.path.join(data_dir, 'art', 'intrface', 'intrface.lst')
    intrface_lst = read_lst(lst_path)

    endgame_path = os.path.join(data_dir, 'endgame.txt')
    if os.path.exists(endgame_path):
        endings = parse_endgame(endgame_path, intrface_lst)
        out = os.path.join(lut_dir, 'endgame.json')
        with open(out, 'w') as f:
            json.dump(endings, f, indent=2)
        print(f'Wrote {out} ({len(endings)} entries)')
    else:
        print(f'Warning: {endgame_path} not found, skipping endgame.json')

    enddeath_path = os.path.join(data_dir, 'enddeath.txt')
    if os.path.exists(enddeath_path):
        death_endings = parse_enddeath(enddeath_path)
        out = os.path.join(lut_dir, 'enddeath.json')
        with open(out, 'w') as f:
            json.dump(death_endings, f, indent=2)
        print(f'Wrote {out} ({len(death_endings)} entries)')
    else:
        print(f'Warning: {enddeath_path} not found, skipping enddeath.json')


if __name__ == '__main__':
    data_dir = sys.argv[1] if len(sys.argv) > 1 else 'data'
    lut_dir = sys.argv[2] if len(sys.argv) > 2 else 'lut'
    convert_endgame(data_dir, lut_dir)
