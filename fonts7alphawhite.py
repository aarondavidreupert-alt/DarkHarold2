# -*- coding: utf-8 -*-
"""
Created on Sun Apr 19 22:54:19 2026

@author: aaron
"""

# -*- coding: utf-8 -*-
"""
Created on Wed Apr 15 22:46:34 2026

@author: aaron
"""

import struct, json, math, os
from PIL import Image

def parse_aaf(data):
    height = struct.unpack('>H', data[4:6])[0]
    _, gap, space_w, vert_gap = struct.unpack('>4H', data[4:12])
    symbols = []
    for i in range(256):
        off = 12 + i * 8
        w, h, doff = struct.unpack('>2HL', data[off:off+8])
        symbols.append({'width': w, 'height': h, 'data_offset': doff})
    row_widths = [sum(symbols[r*16+c]['width'] for c in range(16) if r*16+c < 256) for r in range(16)]
    img = Image.new('RGBA', (max(row_widths), 16 * height), (0,0,0,0))
    symbol_info = {}
    cur_x = cur_y = cur_row = 0
    pixel_base = 12 + 256 * 8
    for i in range(256):
        if i % 16 == 0:
            cur_x = 0; cur_y = cur_row * height; cur_row += 1
        s = symbols[i]
        symbol_info[i] = {'x': cur_x, 'y': cur_y, 'w': s['width'], 'h': height}
        if s['width'] > 0 and s['height'] > 0:
            start = pixel_base + s['data_offset']
            px_data = data[start:start + s['width'] * s['height']]
            glyph = Image.new('RGBA', (s['width'], s['height']), (0,0,0,0))
            pix = glyph.load()
            for py in range(s['height']):
                for px_ in range(s['width']):
                    v = px_data[py * s['width'] + px_]
                    if v > 0:
                        # White + alpha: R=G=B=alpha=intensity
                        # renderBitmapText uses red channel as alpha mask
                        a = int(v / 7.0 * 255)
                        pix[px_, py] = (a, a, a, a)
            img.paste(glyph, (cur_x, cur_y), glyph)
        cur_x += s['width']
    return img, symbol_info, {'height': height, 'gapSize': gap, 'spaceWidth': space_w}


def parse_fon(data):
    nChars, height, gapSize, _, _ = struct.unpack('5i', data[0:20])
    symbols = []; offsets = []
    for i in range(nChars):
        w, off = struct.unpack('2i', data[20+i*8:28+i*8])
        symbols.append({'width': w, 'height': height}); offsets.append(off)
    font_data = data[20 + nChars*8:]
    row_widths = [sum(symbols[r*16+c]['width'] for c in range(16) if r*16+c < nChars) for r in range(math.ceil(nChars/16))]
    img = Image.new('RGBA', (max(row_widths), math.ceil(nChars/16) * height), (0,0,0,0))
    symbol_info = {}
    cur_x = cur_y = cur_row = 0
    for i in range(nChars):
        if i % 16 == 0:
            cur_x = 0; cur_y = cur_row * height; cur_row += 1
        s = symbols[i]
        symbol_info[i] = {'x': cur_x, 'y': cur_y, 'w': s['width'], 'h': height}
        if s['width'] > 0:
            bpl = math.floor((s['width'] + 7) / 8)
            glyph = Image.new('RGBA', (s['width'], height), (0,0,0,0))
            pix = glyph.load()
            for h_ in range(height):
                for j in range(s['width']):
                    ofs = math.floor(offsets[i] + h_ * bpl + j / 8)
                    if ofs < len(font_data) and (font_data[ofs] & (1 << (7 - (j % 8)))):
                        # FON is 1-bit: fully on or off → full white+alpha
                        pix[j, h_] = (255, 255, 255, 255)
            img.paste(glyph, (cur_x, cur_y), glyph)
        cur_x += s['width']
    return img, symbol_info, {'height': height, 'gapSize': gapSize}

# ── Alle konvertieren ────
data_dir = r'C:\Users\aaron\OneDrive\Dokumente\GitHub\DarkHarold2\data'
out_dir  = r'C:\Users\aaron\OneDrive\Dokumente\GitHub\DarkHarold2\art\fonts'
os.makedirs(out_dir, exist_ok=True)

for i in range(6):
    for ext, parser in [('aaf', parse_aaf), ('fon', parse_fon)]:
        path = os.path.join(data_dir, f'font{i}.{ext}')
        if not os.path.exists(path):
            continue
        with open(path, 'rb') as f:
            raw = f.read()
        try:
            img, si, meta = parser(raw)
            png_out  = os.path.join(out_dir, f'font{i}_{ext}.png')
            json_out = os.path.join(out_dir, f'font{i}_{ext}.json')
            img.save(png_out)
            with open(json_out, 'w') as f:
                json.dump({str(k): v for k, v in si.items()}, f)
            print(f"✓ font{i}.{ext} → {img.size}px")
        except Exception as e:
            print(f"✗ font{i}.{ext} — {e}")