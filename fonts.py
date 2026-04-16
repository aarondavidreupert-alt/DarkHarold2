# -*- coding: utf-8 -*-
"""
Created on Tue Apr 14 23:37:00 2026

@author: aaron
"""

import struct
import json
from PIL import Image, ImageDraw

def parse_aaf(filepath):
    with open(filepath, 'rb') as f:
        data = f.read()
    
    # AAF Header
    signature = data[0:4]  # 'AAFF'
    max_height = struct.unpack_from('<H', data, 4)[0]
    horiz_space = struct.unpack_from('<H', data, 6)[0]
    line_spacing = struct.unpack_from('<H', data, 8)[0]
    space_width = struct.unpack_from('<H', data, 10)[0]
    
    # 256 Glyph-Einträge à 12 Bytes
    glyphs = []
    offset = 12
    for i in range(256):
        width  = struct.unpack_from('<H', data, offset)[0]
        height = struct.unpack_from('<H', data, offset + 2)[0]
        data_offset = struct.unpack_from('<I', data, offset + 4)[0]
        glyphs.append({'width': width, 'height': height, 'data_offset': data_offset})
        offset += 8
    
    # Pixel-Daten lesen
    pixel_data_start = offset  # nach den 256 Einträgen
    for g in glyphs:
        if g['width'] > 0 and g['height'] > 0:
            size = g['width'] * g['height']
            start = pixel_data_start + g['data_offset']
            g['pixels'] = data[start:start + size]
        else:
            g['pixels'] = b''
    
    return {
        'max_height': max_height,
        'horiz_space': horiz_space,
        'line_spacing': line_spacing,
        'space_width': space_width,
        'glyphs': glyphs
    }

def aaf_to_png(aaf_path, png_path, json_path, color=(255, 200, 0, 255)):
    font = parse_aaf(aaf_path)
    glyphs = font['glyphs']
    
    # Nur druckbare ASCII-Zeichen (32–126)
    chars = range(32, 127)
    
    cell_w = max((glyphs[i]['width'] for i in chars if glyphs[i]['width'] > 0), default=8)
    cell_h = font['max_height']
    
    cols = len(list(chars))
    img_w = cell_w * cols
    img_h = cell_h
    
    img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
    symbol_info = {}
    
    for idx, char_code in enumerate(chars):
        g = glyphs[char_code]
        x_offset = idx * cell_w
        
        symbol_info[char_code] = {
            'x': x_offset,
            'y': 0,
            'w': g['width'] if g['width'] > 0 else font['space_width'],
            'h': cell_h
        }
        
        if g['width'] > 0 and g['height'] > 0 and g['pixels']:
            for py in range(g['height']):
                for px in range(g['width']):
                    pixel_val = g['pixels'][py * g['width'] + px]
                    if pixel_val > 0:
                        alpha = min(255, pixel_val * 4)  # skalieren falls nötig
                        r = int(color[0] * pixel_val / 255)
                        g_val = int(color[1] * pixel_val / 255)
                        b = int(color[2] * pixel_val / 255)
                        img.putpixel((x_offset + px, py), (r, g_val, b, alpha))
    
    img.save(png_path)
    with open(json_path, 'w') as f:
        json.dump(symbol_info, f, indent=2)
    
    print(f"✓ {png_path} ({img_w}x{img_h}px, {cols} Zeichen)")
    print(f"✓ {json_path}")

# --- Alle 5 Fonts konvertieren ---
import os

data_dir = r'C:\Users\aaron\OneDrive\Dokumente\GitHub\DarkHarold2\data'
out_dir  = r'C:\Users\aaron\OneDrive\Dokumente\GitHub\DarkHarold2\art\fonts'

os.makedirs(out_dir, exist_ok=True)

# Farben pro Font (Fallout-typisch: gelb/orange)
colors = {
    0: (255, 200,   0, 255),  # font0 — kleiner gelber Font
    1: (255, 200,   0, 255),  # font1 — Skilldex-Font
    2: (255, 200,   0, 255),  # font2
    3: (255, 200,   0, 255),  # font3
    4: (255, 200,   0, 255),  # font4
}

for i in range(5):
    aaf_file  = os.path.join(data_dir, f'font{i}.aaf')
    png_file  = os.path.join(out_dir,  f'font{i}.png')
    json_file = os.path.join(out_dir,  f'font{i}.json')
    
    if os.path.exists(aaf_file):
        try:
            aaf_to_png(aaf_file, png_file, json_file, color=colors[i])
        except Exception as e:
            print(f"✗ font{i}.aaf — Fehler: {e}")
    else:
        print(f"  font{i}.aaf nicht gefunden, übersprungen")