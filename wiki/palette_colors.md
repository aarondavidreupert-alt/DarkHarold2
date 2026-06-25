# FO2 Palette Colors — Usage Audit

Reference for the 256-color Fallout 2 palette (`data/color.pal`) and a systematic
audit of every place in DH2 where a color is taken from that palette vs. hardcoded
or inferred. Update this file when a hardcoded color is corrected, or when a new UI
element is added that renders colored text or sprites.

Ground truth: `raw/fallout2-ce/src/color.cc`, `game_dialog.cc`, `loadsave.cc`,
`object.cc`, `font_manager.cc`.

DH2 extracted data: `lut/color_rgb.json` (palette index → 8-bit RGB),
`lut/color_lut.json` (packed 24-bit RGB → nearest palette index, reverse lookup),
`lut/colorTable.json` (256×256 additive blend table: `colorTable[a][b]` = palette
index of the 50/50 blend of palette[a] and palette[b]).

Last audited: 2026-06-24

---

## 1. The FO2 Palette — Structure

Fallout 2 uses a 256-entry indexed palette (`color.pal`), with each channel stored
at **6-bit precision** (0–63) then multiplied by 4 for display (0–252). The
extracted `lut/color_rgb.json` gives the fully scaled 8-bit RGB values (0–255).

Entries 228–255 are reserved as transparent/unused (all `[0,0,0]` in the extracted
palette — do not use these as real colors).

### How to look up a color

```python
import json

pal = json.load(open('lut/color_rgb.json'))   # {"0": [r,g,b], ..., "255": [r,g,b]}
rgb = pal[str(palette_index)]                  # e.g. pal["119"] → [160, 144, 124]
```

To find the nearest palette index for an arbitrary RGB:
```python
lut = json.load(open('lut/color_lut.json'))   # {str(r<<16|g<<8|b): palette_index, ...}
key = str((r << 16) | (g << 8) | b)
nearest_index = lut.get(key)                   # exact match if present; else scan pal manually
```

To look up what CE's `_colorTable[a*256+b]` produces:
```python
ct = json.load(open('lut/colorTable.json'))    # {str(r<<16|g<<8|b): palette_index, ...}
# average palette[a] and palette[b], then look up the nearest index in ct
avg = [(pal[str(a)][i] + pal[str(b)][i]) // 2 for i in range(3)]
key = str((avg[0] << 16) | (avg[1] << 8) | avg[2])
result_index = ct.get(key)                     # nearest palette entry to the blend
```

---

## 2. Key Palette Colors — Catalogue

| Index | RGB (8-bit) | Hex | Name / Use in CE |
|-------|-------------|-----|-----------------|
| 1 | [236, 236, 236] | #ECECEC | Near-white, bright highlights |
| 56 | [252, 252, 200] | #FCFCC8 | Pale gold / UI highlight |
| 57 | [252, 252, 124] | #FCFC7C | Medium gold / selected text |
| 86 | [120, 148, 120] | #789478 | Muted sage green |
| 119 | [160, 144, 124] | #A0907C | Warm tan-gray (hilight2 blend base) |
| 133 | [252, 0, 0] | #FC0000 | Pure FO2 red — death / hostile |
| 171 | [212, 172, 124] | #D4AC7C | Warm peach-tan |
| 196 | [100, 228, 100] | #64E464 | Bright green — FO2 UI text default |
| 215 | [60, 248, 0] | #3CF800 | Vivid lime green |
| 216 | [56, 212, 8] | #38D408 | Char-screen green |
| 220 | [252, 252, 252] | #FCFCFC | Near-white (max brightness) |

---

## 3. Colour Audit — DH2 vs CE

### 3.1 Dialogue Screen Highlights (`hilight1.png` / `hilight2.png`)

CE reference: `game_dialog.cc:4526 gameDialogRenderHighlight()`,
`:4675 gameDialogHighlightsInit()`.

#### hilight1 — upper-right glint (lightening)

CE generates `_light_BlendTable` from `_colorTable[17969]` = `colorTable[70][49]`:
- palette[70] = [180, 216, 132] (bright yellow-green)
- palette[49] = [196, 96, 168] (magenta-pink)
- 50/50 blend ≈ [188, 156, 150] — a pinkish warm gray

The blend table produces a *lightening* effect (shifts pixels toward a brighter
value proportional to the FRM blend-weight). Because the net result is always
"make pixels lighter," using **white [255, 255, 255]** in DH2's plain alpha
compositing is a reasonable approximation regardless of the exact tint — any
bright overlay lightens the underlying pixels. The very slight pinkish cast of
the CE blend color ([188, 156, 150]) is imperceptible at the low intensities CE
uses in practice (max raw FRM byte ≈ 247 → `(256−247)>>4 = 0`, so the effect
is nearly zero — only FRM bytes below ~240 contribute meaningfully).

**DH2 current**: white `(255, 255, 255)` overlay via `tools/export_mask_frms.py`.  
**Status**: ✅ Good approximation. No change needed.

#### hilight2 — lower-left shadow/glow (darkening)

CE generates `_dark_BlendTable` from `_colorTable[22187]`. Flat index 22187 in
CE's 256×256 `_colorTable` (used as `colorMixAddTable`) = row 86, column 171:

- palette[86] = [120, 148, 120], palette[171] = [212, 172, 124]
- **Additive** blend (CE's `colorMixAddTable` adds channels, clamps to 255):
  [min(255,332), min(255,320), min(255,244)] = **[255, 255, 244]** — near-white

The blend base for CE's dark blend table is therefore near-white, not a medium
warm-gray. This means the 2026-06-24 "correction" to `(160,144,124)` was wrong —
it was derived assuming 50/50 *averaging*, but CE's `_colorTable` does *additive*
mixing. The result of that change was a dim, washed-out shadow.

The actual visual result in the original FO2 game is a **warm amber/orange glow**
at the bottom-left of the dialogue head rect (simulating vacuum-tube cathode warmth
leaking around the lower glass edge). This was confirmed by the user against the
real game with `HIGHLIGHT_STRENGTH = 1.0`.

**DH2 current**: `HILIGHT2_COLOR = (255, 140, 30)` (amber) — empirically validated
against the original FO2 game. This is the stable value; do not change it without
running the original game to compare.

> **Why we can't derive the "true" CE value easily**: `gameDialogHighlightsInit`
> uses `_colorTable[22187]` as the seed for generating `_dark_BlendTable`, a
> 4096-entry (16×256) remapping table. The generation algorithm in CE's `color.cc`
> is complex and depends on both `_dark_GrayTable` (luminance lookup) and this
> additive mix color. Fully porting the algorithm would require the 65536-entry
> `colorTable.json`, per-pixel palette remapping on the canvas, and CPU-side
> blending — well beyond the value of this cosmetic effect. The amber approximation
> is confirmed close enough.

---

### 3.2 Float Messages (damage numbers, combat text)

CE reference: `object.cc` — `objectCreateFloatingText()` / `float_msg_item_t`; color
is a named constant resolved to a palette index at draw time.

DH2 uses CSS text drawn on `textCtx` (`src/render/webglDraw.ts:47–57`).

| CE color name | CE palette index | CE RGB | DH2 hex | DH2 RGB | Accuracy |
|---|---|---|---|---|---|
| White (normal damage) | ~220 | [252, 252, 252] | `#FFFFFF` | [255,255,255] | ✅ close |
| Red (death) | 133 | [252, 0, 0] | `#FF4444` | [255,68,68] | ⚠️ pinkish — too light |
| Yellow (warning / miss) | ~57 | [252, 252, 124] | `#FFFF44` | [255,255,68] | ⚠️ too green-yellow |
| Green (heal / positive) | ~196 | [100, 228, 100] | `#00FF00` | [0,255,0] | ⚠️ too pure/lime |

**Recommended corrections** (low priority — combat text is very brief):
- Red: `#FC0000` (palette[133]) instead of `#FF4444`
- Yellow: `#FCFC7C` (palette[57]) instead of `#FFFF44` — notably this hex is already
  used in `src/ui_components.ts:125` (`selectedTextColor`) so it's the right FO2 gold
- Green: `#64E464` (palette[196]) instead of `#00FF00`

---

### 3.3 In-Game Font Colors

DH2's font system (`src/ui/fontCore.ts`) renders Fallout 2 bitmap font sprites (which
are stored as yellow glyphs) and recolors them via CSS `filter: sepia/saturate/hue-rotate`.
This is an approximation — it cannot reproduce arbitrary palette colors exactly,
only broad hue shifts.

| Context | DH2 color | Hex | Notes |
|---------|-----------|-----|-------|
| Default text (companion panel, dialogue) | warm tan | `#c8b466` | [200,180,102] — no close palette match; CE dialogue font is palette-rendered, so the exact color depends on which font+palette FO2 loads |
| Character screen labels (stats, skills) | `#00FF00` | [0,255,0] | CE uses palette green ≈ [56,212,8] (#38D408, palette[216]) — DH2 lime is too vivid but acceptable given CSS-filter limitation |
| Selected/highlighted text | `#FCFC7C` | [252,252,124] | ✅ Exact match for palette[57] |
| Golden headings (char screen) | `#FFD700` | [255,215,0] | Close to palette[57]=[252,252,124] — slightly different hue but acceptable |
| Dimmed/partial green | `#70A070` | [112,160,112] | Close to palette[86]=[120,148,120] — intentionally dimmer variant for disabled items |
| Overweight / bad stat | `#FF4444` / `#f80000` | pinkish/red | CE would use palette[133]=[252,0,0]; minor issue |
| Good stat / positive | `#00f800` / `#00FF00` | lime green | CE would use palette[196]=[100,228,100]; minor issue |

**Key finding**: `#FCFC7C` (already in the codebase as `selectedTextColor`) is a
**pixel-accurate** match for palette[57]. It should be preferred over `#FFD700`
wherever "FO2 gold/selected" text is intended. They are visually close but
`#FCFC7C` is the real FO2 value.

---

### 3.4 Automap Colors

`src/automap/render.ts` uses `#00FF00`, `#888888`, `#FF8800`, `#3388FF`, `#FFCC00`,
`#FF3333`. CE's automap (`automap.cc`) uses its own palette subset for the pip-boy
AMAP display.

**Status**: not investigated. Automap is a secondary debug/overview display; CE
accuracy here is lower priority than gameplay-facing UI. Mark for future audit if
the automap is to be fully faithful.

---

### 3.5 Character Creator / Viewer

Primarily uses `#00FF00` (green labels), `#FFD700` or `#FCFC7C` (gold headings),
`#000000` (black card text on light backgrounds), `#70A070` (dimmed), `#FF4444` (red).

Same notes as §3.3 apply. These screens use the DH2 bitmap-font renderer which cannot
do exact palette matching via CSS filter; the hue approximations are acceptable.
`#FCFC7C` should be preferred over `#FFD700` in new code for heading text.

---

## 4. How to Look Up a CE Color Reference

When CE source references a palette index (e.g. `"colour 133"` for red outlines),
the mapping is:

1. Open `lut/color_rgb.json`.
2. Find the entry for that index: `json["133"]` → `[252, 0, 0]`.
3. Convert to hex: `#FC0000`.
4. Use that hex directly in DH2 CSS or as RGB constants.

When CE references `_colorTable[N]` (a blend of two palette entries):
1. Decompose: `a = N / 256` (integer), `b = N % 256`.
2. Look up `pal[a]` and `pal[b]`.
3. Average the two RGB values: `result ≈ (pal[a]+pal[b]) / 2`.
4. Find the nearest palette entry to that average (scan `color_rgb.json` by Euclidean distance).
5. That result index is the blend-base color for the blend table. Use its RGB as the
   DH2 overlay tint.

---

## 5. Unresolved / Future Work

| Item | Issue | Priority |
|------|-------|----------|
| Float message red | `#FF4444` should be `#FC0000` (palette[133]) | low |
| Float message yellow | `#FFFF44` should be `#FCFC7C` (palette[57]) | low |
| Float message green | `#00FF00` should be `#64E464` (palette[196]) | low |
| `#FFD700` usages | Replace with `#FCFC7C` (palette[57]) in new code | low |
| Automap colors | Not yet audited against CE's automap palette | very low |
| hilight1 exact tint | CE blend color is pinkish ([188,156,150]) not white; at practical FRM intensities the difference is invisible | not worth fixing |
| Dialogue font exact matching | CE renders dialogue option text through a specific font+palette; DH2 approximates with CSS filter | medium — requires font system overhaul |
