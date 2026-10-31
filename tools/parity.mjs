// `npm run parity` (wiki/code_quality.md Q3): runs tools/luadiff.html (VM vs Lua differential test,
// wiki/lua_scripts.md) in headless Chromium against a local `python -m http.server`, prints its
// status line and exits non-zero unless it matches the parity baseline below.
//
// Needs the extracted game data (data/scripts/*.int and the int2lua output, plus the rest of
// tools/setup.py's output) in the project root, so it runs locally, not in GitHub CI. Run
// `npm run build` first (or use `npm run parity`, which builds). One-time browser download:
// `npx playwright install chromium` (without it the script falls back to an installed Chrome / Edge).
//
// Environment: PARITY_PORT (default 8124), PARITY_TIMEOUT_MS (default 900000), PARITY_PYTHON (default
// python, then python3).
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// 12800 runs until the 2026-10-27 re-run of decompile_scripts gave the test set 40 more procedure runs
// (same scripts, still 0 differing procedures)
const BASELINE = '36 scripts, 12840 runs (69 cut short), 0 differing procedures, 70 runs where the VM threw'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PARITY_PORT || 8124)
const timeout = Number(process.env.PARITY_TIMEOUT_MS || 15 * 60 * 1000)

const scriptsDir = root + 'data/scripts'
if (!existsSync(scriptsDir) || !readdirSync(scriptsDir).some((f) => f.endsWith('.lua'))) {
    console.error(
        `parity: no decompiled scripts in ${scriptsDir}. Extract the game data first ` +
            '(pipenv run python tools/setup.py /path/to/Fallout2/), see README.md.',
    )
    process.exit(2)
}

function startServer() {
    const candidates = process.env.PARITY_PYTHON ? [process.env.PARITY_PYTHON] : ['python', 'python3']
    return new Promise((resolve, reject) => {
        const tryNext = (i, lastError) => {
            if (i >= candidates.length) {
                return reject(
                    new Error(`parity: could not start ${candidates.join(' / ')} (${lastError}); set PARITY_PYTHON`),
                )
            }
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
            if ((await fetch(base + 'tools/luadiff.html')).ok) return
        } catch {
            // not listening yet
        }
        await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`parity: http.server did not answer on port ${port}`)
}

async function launchBrowser() {
    try {
        return await chromium.launch({ headless: true })
    } catch (e) {
        for (const channel of ['chrome', 'msedge']) {
            try {
                return await chromium.launch({ headless: true, channel })
            } catch {
                // try the next one
            }
        }
        throw new Error('parity: no Chromium found; run `npx playwright install chromium`\n' + e.message)
    }
}

const server = await startServer()
let browser
let exitCode = 1
try {
    const base = `http://127.0.0.1:${port}/`
    await waitForServer(base)
    browser = await launchBrowser()
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    const started = Date.now()
    console.log(`parity: ${base}tools/luadiff.html (${browser.version()})`)
    await page.goto(base + 'tools/luadiff.html')
    await page.waitForFunction(() => document.getElementById('status').textContent !== 'running...', null, {
        timeout,
        polling: 1000,
    })
    const status = (await page.textContent('#status')).trim()
    console.log(status)
    console.log(`(${Math.round((Date.now() - started) / 1000)} s)`)
    if (status.startsWith(BASELINE)) {
        console.log('parity: OK, matches the baseline')
        exitCode = 0
    } else {
        const failures = (await page.textContent('#failures')).trim()
        if (failures) console.log(failures.slice(0, 4000))
        console.error(`parity: FAILED, expected "${BASELINE}"`)
    }
} catch (e) {
    console.error(e.message)
} finally {
    if (browser) await browser.close()
    server.kill()
}
process.exit(exitCode)
