// Import-cycle report (wiki/code_quality.md Q14): the strongly connected components of the static
// imports between the modules in src/ (Tarjan). Type-only imports (`import type`, and imports
// TypeScript erases because only types are used) are not edges: they are gone in the compiled js/,
// so the compiled graph is read.
//
//   node tools/importCycles.mjs            the cycles: sizes and modules
//   node tools/importCycles.mjs --max N    exit 1 if the largest cycle has more than N modules (CI)
//   node tools/importCycles.mjs --why a b  the import path from module a to module b inside the cycle
//
// Needs the compiled js/ (npm run build).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'js')
const files = []
const walk = (d) => {
    for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (p.endsWith('.js')) files.push(p)
    }
}
walk(root)

const name = (p) => relative(root, p).replace(/\\/g, '/').replace(/\.js$/, '')
const graph = new Map()
const IMPORT = /^\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm
for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const deps = new Set()
    for (const m of text.matchAll(IMPORT)) deps.add(name(resolve(dirname(f), m[1] ?? m[2])))
    graph.set(
        name(f),
        [...deps].filter((d) => d !== name(f)),
    )
}

// Tarjan's strongly connected components
let index = 0
const stack = []
const on = new Set()
const idx = new Map()
const low = new Map()
const sccs = []
const strong = (v) => {
    idx.set(v, index)
    low.set(v, index++)
    stack.push(v)
    on.add(v)
    for (const w of graph.get(v) ?? []) {
        if (!graph.has(w)) continue
        if (!idx.has(w)) {
            strong(w)
            low.set(v, Math.min(low.get(v), low.get(w)))
        } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)))
    }
    if (low.get(v) === idx.get(v)) {
        const c = []
        let w
        do {
            w = stack.pop()
            on.delete(w)
            c.push(w)
        } while (w !== v)
        sccs.push(c)
    }
}
for (const v of graph.keys()) if (!idx.has(v)) strong(v)

const cycles = sccs.filter((c) => c.length > 1).sort((a, b) => b.length - a.length)
const largest = cycles[0] ?? []
const arg = (n) => {
    const i = process.argv.indexOf(n)
    return i >= 0 ? process.argv[i + 1] : null
}

if (arg('--why')) {
    // shortest path a -> b over the graph
    const [a, b] = [arg('--why'), process.argv[process.argv.indexOf('--why') + 2]]
    const prev = new Map([[a, null]])
    const queue = [a]
    while (queue.length && !prev.has(b)) {
        const v = queue.shift()
        for (const w of graph.get(v) ?? []) {
            if (!prev.has(w)) {
                prev.set(w, v)
                queue.push(w)
            }
        }
    }
    const path = []
    for (let v = prev.has(b) ? b : null; v !== null; v = prev.get(v)) path.unshift(v)
    console.log(path.length ? path.join(' -> ') : `no path from ${a} to ${b}`)
    process.exit(0)
}

console.log(
    `${graph.size} modules; ${cycles.length} import cycles, sizes ${cycles.map((c) => c.length).join(', ') || '-'}`,
)
if (!process.argv.includes('--max')) {
    for (const c of cycles) console.log(`(${c.length}): ${c.sort().join(' ')}`)
}
const max = arg('--max')
if (max !== null && largest.length > Number(max)) {
    console.error(`largest import cycle has ${largest.length} modules (max ${max})`)
    process.exit(1)
}
