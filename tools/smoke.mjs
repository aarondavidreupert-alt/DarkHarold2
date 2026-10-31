// `npm run smoke`: boots play.html?<map> in headless Chromium against a local `python -m http.server`
// and fails on any uncaught page error or console error while the map loads and the game runs for a
// few seconds. Complements `npm run parity` (which only loads the modules and runs scripts) for
// changes to startup, loading, rendering and the game loop.
//
//   node tools/smoke.mjs [map ...]     default: artemple klamall denbus1
//
// Needs the extracted game data, so it is a local script, not in GitHub CI (like tools/parity.mjs).
// Environment: SMOKE_PORT (default 8126), PARITY_PYTHON, SMOKE_SCREENSHOT_DIR (writes <map>.png).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.SMOKE_PORT || 8126)
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['artemple', 'klamall', 'denbus1']
const shotDir = process.env.SMOKE_SCREENSHOT_DIR

if (!existsSync(root + 'maps')) {
    console.error('smoke: no maps/ in the project root. Extract the game data first (see README.md).')
    process.exit(2)
}

function startServer() {
    const candidates = process.env.PARITY_PYTHON ? [process.env.PARITY_PYTHON] : ['python', 'python3']
    return new Promise((resolve, reject) => {
        const tryNext = (i, lastError) => {
            if (i >= candidates.length) return reject(new Error(`smoke: could not start python (${lastError})`))
            const proc = spawn(candidates[i], ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
                cwd: root,
                stdio: 'ignore', // never 'pipe' without reading it: the request log fills the pipe and the server blocks
            })
            proc.once('error', (e) => tryNext(i + 1, e.message))
            proc.once('spawn', () => resolve(proc))
        }
        tryNext(0)
    })
}

async function waitForServer(base) {
    for (let i = 0; i < 100; i++) {
        try {
            if ((await fetch(base + 'play.html')).ok) return
        } catch {
            // not listening yet
        }
        await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`smoke: http.server did not answer on port ${port}`)
}

async function launchBrowser() {
    const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
    try {
        return await chromium.launch({ headless: true, args })
    } catch {
        return await chromium.launch({ headless: true, args, channel: 'chrome' })
    }
}

/** Reject after `ms`: page.evaluate has no timeout of its own, and a busy page never answers. */
function withTimeout(promise, ms, what) {
    let timer
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms)
    })]).finally(() => clearTimeout(timer))
}

const server = await startServer()
let browser
let failed = 0
try {
    const base = `http://127.0.0.1:${port}/`
    await waitForServer(base)
    for (const map of maps) {
        if (browser) await withTimeout(browser.close(), 10000, 'browser.close').catch(() => {})
        browser = await launchBrowser()
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const problems = []
        page.on('pageerror', (e) => problems.push('page error: ' + (e.stack || e.message)))
        const missing = []
        page.on('console', (m) => {
            // 404s are probes for optional files (data/scripts/<name>.lua, mod copies): listed, not failures
            if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push('console error: ' + m.text())
        })
        page.on('response', (r) => {
            if (r.status() === 404) missing.push(r.url().slice(base.length))
        })
        // count synchronous XHRs (wiki/code_quality.md Q13: they freeze the page while they wait)
        await page.addInitScript(() => {
            const open = XMLHttpRequest.prototype.open
            window.__syncXhr = []
            XMLHttpRequest.prototype.open = function (method, url, async, ...rest) {
                if (async === false) window.__syncXhr.push(String(url))
                return open.call(this, method, url, async === undefined ? true : async, ...rest)
            }
        })
        const started = Date.now()
        await page.goto(`${base}play.html?${map}`, { timeout: 60000 }).catch((e) => problems.push('goto: ' + e.message))
        let state = 'timeout'
        try {
            await page.waitForFunction(
                () => window.globalState && window.globalState.gMap && window.globalState.player &&
                    !window.globalState.isLoading && !window.globalState.isInitializing,
                null, { timeout: 120000, polling: 250 })
            state = 'loaded'
            // let the game loop run: scripts' map_enter / critter_p_proc, timed events, rendering
            await page.waitForTimeout(4000)
        } catch {
            // reported below
        }
        const info = await withTimeout(page.evaluate(() => {
            const g = window.globalState
            return g && g.gMap ? { map: g.gMap.name, objects: g.gMap.getObjects().length, tick: g.gameTickTime,
                syncXhr: window.__syncXhr.length } : null
        }), 15000, 'reading the game state').catch((e) => { problems.push(e.message); return null })
        if (shotDir) {
            await withTimeout(page.screenshot({ path: `${shotDir}/${map}.png` }), 30000, 'screenshot')
                .catch((e) => console.log('  (no screenshot: ' + e.message.split('\n')[0] + ')'))
        }
        const secs = Math.round((Date.now() - started) / 1000)
        if (state !== 'loaded' || problems.length) {
            failed++
            console.log(`FAIL ${map} (${state}, ${secs} s) ${JSON.stringify(info)}`)
            for (const p of problems.slice(0, 20)) console.log('  ' + p.split('\n').slice(0, 6).join('\n    '))
        } else {
            console.log(`ok   ${map} (${secs} s) ${JSON.stringify(info)}`)
        }
        if (process.env.SMOKE_SYNC_XHR && info) {
            const urls = await page.evaluate(() => window.__syncXhr)
            const kinds = {}
            for (const u of urls) {
                const k = u.replace(/^https?:\/\/[^/]+\//, '').replace(/[^/]+$/, '*')
                kinds[k] = (kinds[k] || 0) + 1
            }
            console.log('  sync XHR by folder: ' + JSON.stringify(kinds))
            if (process.env.SMOKE_SYNC_XHR === 'all') console.log(urls.map((u) => '    ' + u).join('\n'))
        }
        if (missing.length) console.log(`  404 (optional files): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`)
        await withTimeout(page.close(), 10000, 'page.close').catch(() => {})
    }
} catch (e) {
    failed++
    console.error(e.message)
} finally {
    if (browser) await withTimeout(browser.close(), 10000, 'browser.close').catch(() => {})
    server.kill()
}
console.log(failed ? `smoke: ${failed} of ${maps.length} failed` : `smoke: all ${maps.length} maps OK`)
process.exit(failed ? 1 : 0)
