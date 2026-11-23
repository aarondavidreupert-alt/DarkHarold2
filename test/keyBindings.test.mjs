// keyBindings.ts (fallout2.cfg [keys], a DH2 addition). The defaults must be CE's fixed game
// keys: fallout2-ce game.cc gameHandleKey (I, C, S, P, Z, Tab, O, Esc, A, N, M, B, Home, F1-F7,
// F10, -/=, ,/., /) and combat.cc _combat_input (Space ends the turn, Enter ends combat).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    CE_GAME_KEYS,
    applyKeysSection,
    resetGameKeys,
    translateGameKey,
    asCeKey,
    gameKeyOf,
} from '../js/keyBindings.js'
import { Config } from '../js/config.js'

// the [keys] section of the template the pipeline writes (tools/fallout2Cfg.py DEFAULT_CFG)
function templateKeys() {
    const py = readFileSync(new URL('../tools/fallout2Cfg.py', import.meta.url), 'utf8')
    const cfg = py.slice(
        py.indexOf('DEFAULT_CFG = r"""') + 18,
        py.indexOf('"""', py.indexOf('DEFAULT_CFG = r"""') + 18),
    )
    const out = {}
    let section = ''
    for (let line of cfg.split(/\r?\n/)) {
        const semi = line.indexOf(';')
        if (semi !== -1) line = line.slice(0, semi)
        line = line.trim()
        if (line.startsWith('[')) section = line.slice(1, line.indexOf(']'))
        else if (section === 'keys' && line.includes('=')) {
            const eq = line.indexOf('=')
            out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
        }
    }
    return out
}

test('the template binds every game key to CE gameHandleKey layout', () => {
    resetGameKeys()
    const controlsBefore = { ...Config.controls }
    const bad = applyKeysSection(templateKeys())
    assert.deepEqual(bad, [])
    for (const action in CE_GAME_KEYS) assert.equal(gameKeyOf(action), CE_GAME_KEYS[action], action)
    assert.deepEqual({ ...Config.controls }, controlsBefore)
    assert.equal(CE_GAME_KEYS.inventory, 'i')
    assert.equal(CE_GAME_KEYS.automap, 'Tab')
    assert.equal(CE_GAME_KEYS.end_turn, ' ')
})

test('with CE layout every key passes through unchanged, shifted aliases included', () => {
    resetGameKeys()
    for (const k of ['i', 'Tab', 'F6', ' ', 'Enter', 'x']) assert.equal(translateGameKey(k), k)
    for (const [k, base] of [
        ['_', '-'],
        ['+', '='],
        ['<', ','],
        ['>', '.'],
        ['?', '/'],
    ])
        assert.equal(translateGameKey(k), base)
})

test('a moved action: the new key acts as the CE key, the old key does nothing', () => {
    resetGameKeys()
    assert.deepEqual(applyKeysSection({ inventory: 'x', rotate_left: 'f12' }), [])
    assert.equal(translateGameKey('x'), 'i')
    assert.equal(translateGameKey('i'), null)
    assert.equal(translateGameKey('F12'), ',')
    assert.equal(translateGameKey('<'), null) // the shifted alias follows only CE's binding
    assert.equal(asCeKey('x'), 'i') // closes the inventory
    assert.equal(asCeKey('Enter'), 'Enter')
    resetGameKeys()
})

test('swapping two actions', () => {
    resetGameKeys()
    applyKeysSection({ character: 's', skilldex: 'c' })
    assert.equal(translateGameKey('s'), 'c')
    assert.equal(translateGameKey('c'), 's')
    resetGameKeys()
})

test('unknown names and key values are reported, controls take heart key names', () => {
    resetGameKeys()
    const before = Config.controls.cameraUp
    assert.deepEqual(applyKeysSection({ nonsense: 'x', inventory: 'ctrl+i', camera_up: 'w' }), [
        'nonsense=x',
        'inventory=ctrl+i',
    ])
    assert.equal(Config.controls.cameraUp, 'w')
    applyKeysSection({ camera_up: 'up' })
    assert.equal(Config.controls.cameraUp, before)
    resetGameKeys()
})
