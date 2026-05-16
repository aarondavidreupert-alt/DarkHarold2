# -*- coding: utf-8 -*-
"""
Created on Sun May 17 00:53:30 2026

@author: aaron
"""

"""
tools/convertPRO.py
Converts Fallout 2 binary .pro files to typed JSON in lut/pro/{type}/.
Output: lut/pro/items/{n}.json, lut/pro/critters/{n}.json, etc.

Run from repo root or tools/ directory.
"""

import os
import json
import struct
from pathlib import Path

_REPO_ROOT = Path(os.getcwd())
if _REPO_ROOT.name == 'tools':
    _REPO_ROOT = _REPO_ROOT.parent

DATA_DIR = _REPO_ROOT / 'data' / 'proto'
OUT_DIR  = _REPO_ROOT / 'lut' / 'pro'

# Object type names matching Fallout2 directory layout
OBJ_TYPES = ['items', 'critters', 'scenery', 'walls', 'tiles', 'misc']

ITEM_TYPES    = ['armor','container','drug','weapon','ammo','misc','key']
SCENERY_TYPES = ['door','stairs','elevator','ladder_up','ladder_down','generic']
MATERIAL_TYPES= ['glass','metal','plastic','wood','dirt','stone','cement','leather']
DAMAGE_TYPES  = ['normal','laser','fire','plasma','electrical','emp','explosion']

def read_i32(data, off):
    return struct.unpack_from('>i', data, off)[0], off + 4

def read_u8(data, off):
    return data[off], off + 1

def parse_item(data):
    off = 0
    d = {}
    d['pid'],          off = read_i32(data, off)
    d['messageId'],    off = read_i32(data, off)
    d['fid'],          off = read_i32(data, off)
    d['lightDistance'],off = read_i32(data, off)
    d['lightIntensity'],off= read_i32(data, off)
    d['flags'],        off = read_i32(data, off)
    d['extendedFlags'],off = read_i32(data, off)
    d['sid'],          off = read_i32(data, off)
    d['type'],         off = read_i32(data, off)
    item_type = d['type']
    type_name = ITEM_TYPES[item_type] if 0 <= item_type < len(ITEM_TYPES) else str(item_type)
    d['typeName'] = type_name

    sub = {}
    if item_type == 0:  # armor
        sub['armorClass'],  off = read_i32(data, off)
        sub['damageResistance'] = []
        for _ in range(7):
            v, off = read_i32(data, off)
            sub['damageResistance'].append(v)
        sub['damageThreshold'] = []
        for _ in range(7):
            v, off = read_i32(data, off)
            sub['damageThreshold'].append(v)
        sub['perk'],      off = read_i32(data, off)
        sub['maleFid'],   off = read_i32(data, off)
        sub['femaleFid'], off = read_i32(data, off)
    elif item_type == 1:  # container
        sub['maxSize'],   off = read_i32(data, off)
        sub['openFlags'], off = read_i32(data, off)
    elif item_type == 2:  # drug
        sub['stat'] = []
        for _ in range(3):
            v, off = read_i32(data, off); sub['stat'].append(v)
        sub['amount'] = []
        for _ in range(3):
            v, off = read_i32(data, off); sub['amount'].append(v)
        sub['duration1'], off = read_i32(data, off)
        sub['amount1'] = []
        for _ in range(3):
            v, off = read_i32(data, off); sub['amount1'].append(v)
        sub['duration2'], off = read_i32(data, off)
        sub['amount2'] = []
        for _ in range(3):
            v, off = read_i32(data, off); sub['amount2'].append(v)
        sub['addictionChance'],   off = read_i32(data, off)
        sub['withdrawalEffect'],  off = read_i32(data, off)
        sub['withdrawalOnset'],   off = read_i32(data, off)
    elif item_type == 3:  # weapon
        sub['animationCode'],      off = read_i32(data, off)
        sub['minDamage'],          off = read_i32(data, off)
        sub['maxDamage'],          off = read_i32(data, off)
        sub['damageType'],         off = read_i32(data, off)
        sub['maxRange1'],          off = read_i32(data, off)
        sub['maxRange2'],          off = read_i32(data, off)
        sub['projectilePid'],      off = read_i32(data, off)
        sub['minStrength'],        off = read_i32(data, off)
        sub['actionPointCost1'],   off = read_i32(data, off)
        sub['actionPointCost2'],   off = read_i32(data, off)
        sub['criticalFailureType'],off = read_i32(data, off)
        sub['perk'],               off = read_i32(data, off)
        sub['rounds'],             off = read_i32(data, off)
        sub['caliber'],            off = read_i32(data, off)
        sub['ammoTypePid'],        off = read_i32(data, off)
        sub['ammoCapacity'],       off = read_i32(data, off)
        sub['soundCode'],          off = read_u8(data, off)
    elif item_type == 4:  # ammo
        sub['caliber'],                   off = read_i32(data, off)
        sub['quantity'],                  off = read_i32(data, off)
        sub['armorClassModifier'],        off = read_i32(data, off)
        sub['damageResistanceModifier'],  off = read_i32(data, off)
        sub['damageMultiplier'],          off = read_i32(data, off)
        sub['damageDivisor'],             off = read_i32(data, off)
    elif item_type == 5:  # misc
        sub['powerTypePid'], off = read_i32(data, off)
        sub['powerType'],    off = read_i32(data, off)
        sub['charges'],      off = read_i32(data, off)
    elif item_type == 6:  # key
        sub['keyCode'], off = read_i32(data, off)

    d['data'] = sub
    d['material'],     off = read_i32(data, off)
    d['size'],         off = read_i32(data, off)
    d['weight'],       off = read_i32(data, off)
    d['cost'],         off = read_i32(data, off)
    d['inventoryFid'], off = read_i32(data, off)
    d['soundCode'],    off = read_u8(data, off)   # field_80
    return d

def parse_critter(data):
    off = 0
    d = {}
    d['pid'],          off = read_i32(data, off)
    d['messageId'],    off = read_i32(data, off)
    d['fid'],          off = read_i32(data, off)
    d['lightDistance'],off = read_i32(data, off)
    d['lightIntensity'],off= read_i32(data, off)
    d['flags'],        off = read_i32(data, off)
    d['extendedFlags'],off = read_i32(data, off)
    d['sid'],          off = read_i32(data, off)
    # CritterProtoData
    cd = {}
    cd['flags'],       off = read_i32(data, off)
    cd['baseStats'] = []
    for _ in range(35):
        v, off = read_i32(data, off); cd['baseStats'].append(v)
    cd['bonusStats'] = []
    for _ in range(35):
        v, off = read_i32(data, off); cd['bonusStats'].append(v)
    cd['skills'] = []
    for _ in range(18):
        v, off = read_i32(data, off); cd['skills'].append(v)
    cd['bodyType'],    off = read_i32(data, off)
    cd['experience'],  off = read_i32(data, off)
    cd['killType'],    off = read_i32(data, off)
    cd['damageType'],  off = read_i32(data, off)
    d['data'] = cd
    # d['headFid'],      off = read_i32(data, off)
    # d['aiPacket'],     off = read_i32(data, off)
    # d['team'],         off = read_i32(data, off)
    
    d['headFid'],  off = read_i32(data, off)   # 404
    d['aiPacket'], off = read_i32(data, off)   # 408
    d['team'] = read_i32(data, off)[0] if off + 4 <= len(data) else -1

    
    return d

def parse_scenery(data):
    off = 0
    d = {}
    d['pid'],           off = read_i32(data, off)   # 0
    d['messageId'],     off = read_i32(data, off)   # 4
    d['fid'],           off = read_i32(data, off)   # 8
    d['lightDistance'], off = read_i32(data, off)   # 12
    d['lightIntensity'],off = read_i32(data, off)   # 16
    d['flags'],         off = read_i32(data, off)   # 20
    d['extendedFlags'], off = read_i32(data, off)   # 24
    d['sid'],           off = read_i32(data, off)   # 28
    d['type'],          off = read_i32(data, off)   # 32
    scenery_type = d['type']
    type_name = SCENERY_TYPES[scenery_type] if 0 <= scenery_type < len(SCENERY_TYPES) else str(scenery_type)
    d['typeName'] = type_name

    sub = {}
    if scenery_type == 0:    # door — 36..39, then soundId at 40? No, 45 total = 36 + 4 + 1 + 4?
        sub['openFlags'], off = read_i32(data, off)  # 36
        sub['keyCode'],   off = read_i32(data, off)  # 40 — but 44 is last i32 start... 
    elif scenery_type == 1:  # stairs — 49 bytes = 36 + 4 + 4 + 4 + 1
        sub['lowerTile'], off = read_i32(data, off)  # 36
        sub['upperTile'], off = read_i32(data, off)  # 40
        sub['field_44'],  off = read_i32(data, off)  # 44
    elif scenery_type == 2:  # elevator — 49 bytes
        sub['elevatorType'], off = read_i32(data, off)  # 36
        sub['level'],        off = read_i32(data, off)  # 40
        sub['field_44'],     off = read_i32(data, off)  # 44
    elif scenery_type in (3, 4):  # ladder — 45 bytes = 36 + 4 + 4 + 1
        sub['destination'],  off = read_i32(data, off)  # 36
        sub['field_40'],     off = read_i32(data, off)  # 40
    elif scenery_type == 5:  # generic — 45 bytes = 36 + 4 + 4 + 1
        sub['field_0'],      off = read_i32(data, off)  # 36
        sub['field_4'],      off = read_i32(data, off)  # 40

    d['data'] = sub
    # soundId is always the last byte
    d['soundId']     = data[-1]
    d['soundIdChar'] = chr(data[-1]) if 32 <= data[-1] < 128 else '?'
    return d

def parse_wall(data):
    off = 0
    d = {}
    d['pid'],          off = read_i32(data, off)
    d['messageId'],    off = read_i32(data, off)
    d['fid'],          off = read_i32(data, off)
    d['lightDistance'],off = read_i32(data, off)
    d['lightIntensity'],off= read_i32(data, off)
    d['flags'],        off = read_i32(data, off)
    d['extendedFlags'],off = read_i32(data, off)
    d['sid'],          off = read_i32(data, off)
    d['material'],     off = read_i32(data, off)
    return d

def parse_tile(data):
    off = 0
    d = {}
    d['pid'],          off = read_i32(data, off)
    d['messageId'],    off = read_i32(data, off)
    d['fid'],          off = read_i32(data, off)
    d['flags'],        off = read_i32(data, off)
    d['extendedFlags'],off = read_i32(data, off)
    d['sid'],          off = read_i32(data, off)
    d['material'],     off = read_i32(data, off)
    return d

def parse_misc(data):
    off = 0
    d = {}
    d['pid'],          off = read_i32(data, off)
    d['messageId'],    off = read_i32(data, off)
    d['fid'],          off = read_i32(data, off)
    d['lightDistance'],off = read_i32(data, off)
    d['lightIntensity'],off= read_i32(data, off)
    d['flags'],        off = read_i32(data, off)
    d['extendedFlags'],off = read_i32(data, off)
    return d

PARSERS = [parse_item, parse_critter, parse_scenery, parse_wall, parse_tile, parse_misc]

def convert_pros():
    total = 0
    errors = 0
    for type_idx, type_name in enumerate(OBJ_TYPES):
        src_dir = DATA_DIR / type_name
        out_dir = OUT_DIR / type_name
        if not src_dir.exists():
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        parser = PARSERS[type_idx]
        for pro_file in sorted(src_dir.glob('*.pro')):
            try:
                raw = pro_file.read_bytes()
                parsed = parser(raw)
                out_path = out_dir / (pro_file.stem + '.json')
                with open(out_path, 'w', encoding='utf-8') as f:
                    json.dump(parsed, f, indent=2, ensure_ascii=False)
                total += 1
            except Exception as e:
                print(f'  ERROR {pro_file}: {e}')
                errors += 1
    print(f'Converted {total} PRO files ({errors} errors) → {OUT_DIR}')

convert_pros()