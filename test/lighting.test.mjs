// lut/intensityColorTable.js (the light table play.html loads) against fallout2-ce color.cc
// _setIntensityTables / _setIntensityTableColor, rebuilt from the committed lut/colorTable.json
// (CE _colorTable) and lut/color_rgb.json (the palette).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const lut = (name) => readFileSync(new URL('../lut/' + name, import.meta.url), 'utf8')
const sandbox = {}
sandbox.globalThis = sandbox
runInNewContext(lut('intensityColorTable.js'), sandbox)
const table = Array.from(sandbox.intensityColorTable) // out of the sandbox realm (deepEqual compares prototypes)
const colorTable = JSON.parse(lut('colorTable.json'))
const rgb = JSON.parse(lut('color_rgb.json'))

// color.cc _setIntensityTables: colours whose color.pal entry is out of range (> 63) are not
// mapped and get a row of 0. color_rgb.json stores those as black; 228 is the one real black.
const UNMAPPED = [0, ...Array.from({ length: 27 }, (_, i) => 229 + i)]

/** color.cc _setIntensityTableColor: Color2RGB is the 6-bit palette >> 1, i.e. the 8-bit value >> 3. */
function ceRow(cc) {
    const [r, g, b] = rgb[cc].map((v) => v >> 3)
    const row = new Array(256)
    let shift = 0
    for (let index = 0; index < 128; index++) {
        row[index] = colorTable[(((r * shift) >> 16) << 10) | (((g * shift) >> 16) << 5) | ((b * shift) >> 16)]
        const lr = r + (((0x1f - r) * shift) >> 16)
        const lg = g + (((0x1f - g) * shift) >> 16)
        const lb = b + (((0x1f - b) * shift) >> 16)
        row[128 + index] = colorTable[(lr << 10) | (lg << 5) | lb]
        shift += 512
    }
    return row
}

test('the light table has 256 x 256 entries (plus 160 unused)', () => {
    assert.equal(colorTable.length, 32768)
    assert.equal(table.length, 256 * 256 + 160)
})

test('every mapped colour row equals CE color.cc _setIntensityTableColor', () => {
    for (let cc = 0; cc < 256; cc++) {
        if (UNMAPPED.includes(cc)) continue
        assert.deepEqual(table.slice(cc * 256, cc * 256 + 256), ceRow(cc), `colour ${cc}`)
    }
})

test('unmapped colours have a row of 0 (CE color.cc _setIntensityTables memset)', () => {
    for (const cc of UNMAPPED) {
        assert.deepEqual(rgb[cc], [0, 0, 0], `colour ${cc} is black in color_rgb.json`)
        assert.ok(table.slice(cc * 256, cc * 256 + 256).every((v) => v === 0), `colour ${cc}`)
    }
})
