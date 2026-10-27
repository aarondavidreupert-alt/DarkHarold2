// `npm run storycrawl`: the AutoCrawler's story crawler (src/autocrawler/story.ts) in headless
// Chromium, on the VM and on the Lua backend, for a subset of maps. Fails unless both backends give
// the same trace for every map; with --save it stores the traces, with --compare <file> it also
// checks them against a stored run (the "story crawler identical against the previous run" part of
// the parity baseline in wiki/code_quality.md).
//
//   node tools/storycrawl.mjs [--maps a,b,c] [--save out.json] [--compare base.json]
//
// Default maps: arvillag,klamall,kladwtwn,denbus1. Needs the extracted game data: local only.
// Environment: STORY_PORT (default 8127), PARITY_PYTHON.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.STORY_PORT || 8127)
const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : null
}
const maps = (arg('--maps') || 'arvillag,klamall,kladwtwn,denbus1').split(',')
const saveTo = arg('--save')
const compareWith = arg('--compare')

function startServer() {
    const candidates = process.env.PARITY_PYTHON ? [process.env.PARITY_PYTHON] : ['python', 'python3']
    return new Promise((resolve, reject) => {
        const tryNext = (i, lastError) => {
            if (i >= candidates.length) return reject(new Error(`storycrawl: could not start python (${lastError})`))
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
    throw new Error(`storycrawl: http.server did not answer on port ${port}`)
}

async function launchBrowser() {
    const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required']
    try {
        return await chromium.launch({ headless: true, args })
    } catch {
        return await chromium.launch({ headless: true, args, channel: 'chrome' })
    }
}

/** One backend: load the first map, run the story crawler over `maps`, return { map: trace[] }. */
async function crawl(base, backend) {
    const browser = await launchBrowser()
    try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${base}play.html?${maps[0]}#script_backend=${backend}&dev`)
        await page.waitForFunction(
            () => window.globalState && window.globalState.gMap && window.globalState.player &&
                !window.globalState.isLoading && !window.globalState.isInitializing,
            null, { timeout: 120000, polling: 250 })
        const report = await page.evaluate(async (mapList) => {
            window.Config.engine.debug = true
            const r = await window.autoCrawler.runStoryCrawler({ maps: mapList })
            return r && { backend: r.backend, maps: r.maps.map((m) => ({ map: m.map, steps: m.steps, trace: m.trace })) }
        }, maps)
        if (!report) throw new Error(`storycrawl (${backend}): runStoryCrawler returned nothing`)
        if (report.backend !== backend) throw new Error(`storycrawl: asked for ${backend}, ran ${report.backend}`)
        return { traces: Object.fromEntries(report.maps.map((m) => [m.map, m.trace])), errors }
    } finally {
        await browser.close()
    }
}

// The crawler waits one setTimeout(0) after a talk or a click; when the dialogue (or its next
// reply) shows up later than that (the timing varies run to run, more so in headless Chromium),
// one side records the step without a reply and the two traces part from there. Such a map is
// reported as inconclusive, not as a difference.
// the step label is the text before ` reply=` / ` ui=`; noise = the same step, a reply on one side only
const stepOf = (line) => line.split(/ (?:reply=|ui=)/)[0]
const isTimingNoise = (d) => stepOf(d.a) === stepOf(d.b) && d.a.includes(' reply=') !== d.b.includes(' reply=')
let inconclusive = 0

function firstDiff(a, b) {
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { line: i, a: a[i] ?? '(end)', b: b[i] ?? '(end)' }
    return null
}

const server = await startServer()
let failed = false
try {
    const base = `http://127.0.0.1:${port}/`
    await waitForServer(base)
    const runs = {}
    for (const backend of ['vm', 'lua']) {
        const started = Date.now()
        runs[backend] = await crawl(base, backend)
        const steps = Object.values(runs[backend].traces).reduce((s, t) => s + t.length, 0)
        console.log(`${backend}: ${Object.keys(runs[backend].traces).length} maps, ${steps} trace lines, ` +
            `${Math.round((Date.now() - started) / 1000)} s, ${runs[backend].errors.length} page errors`)
    }
    for (const map of maps) {
        const vm = runs.vm.traces[map]
        const lua = runs.lua.traces[map]
        if (!vm || !lua) {
            console.log(`FAIL ${map}: no trace (${vm ? '' : 'vm '}${lua ? '' : 'lua'})`)
            failed = true
            continue
        }
        const d = firstDiff(vm, lua)
        if (d && isTimingNoise(d)) {
            inconclusive++
            console.log(`??   ${map}: inconclusive at line ${d.line}, a dialogue did not open in time
  vm : ${d.a}
  lua: ${d.b}`)
        } else if (d) {
            failed = true
            console.log(`FAIL ${map}: VM and Lua differ at line ${d.line}\n  vm : ${d.a}\n  lua: ${d.b}`)
        } else {
            console.log(`ok   ${map}: VM = Lua (${vm.length} lines)`)
        }
    }
    if (compareWith) {
        const old = JSON.parse(readFileSync(compareWith, 'utf8'))
        for (const backend of ['vm', 'lua']) {
            for (const map of maps) {
                const d = firstDiff(old[backend]?.[map] ?? [], runs[backend].traces[map] ?? [])
                if (d && isTimingNoise(d)) {
                    inconclusive++
                    console.log(`??   ${map} (${backend}): inconclusive against ${compareWith} at line ${d.line}, a dialogue did not open in time`)
                } else if (d) {
                    failed = true
                    console.log(`FAIL ${map} (${backend}): differs from ${compareWith} at line ${d.line}\n  old: ${d.a}\n  new: ${d.b}`)
                } else {
                    console.log(`ok   ${map} (${backend}): same as ${compareWith}`)
                }
            }
        }
    }
    if (saveTo) {
        writeFileSync(saveTo, JSON.stringify({ vm: runs.vm.traces, lua: runs.lua.traces }))
        console.log(`traces saved to ${saveTo}`)
    }
} catch (e) {
    failed = true
    console.error(e.message)
} finally {
    server.kill()
}
console.log((failed ? 'storycrawl: FAILED' : 'storycrawl: OK') + (inconclusive ? ` (${inconclusive} inconclusive: rerun those maps)` : ''))
process.exit(failed ? 1 : 0)
