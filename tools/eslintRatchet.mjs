// ESLint ratchet (wiki/code_quality.md Q1): lint src/**/*.ts and fail only if the error or warning
// count rises above tools/eslintBaseline.json. Run by `npm run lint:ratchet` and in CI.
//
//   node tools/eslintRatchet.mjs           check against the baseline
//   node tools/eslintRatchet.mjs --update  write the current counts as the new baseline
//
// When a change lowers the counts, the script says so; commit the lower baseline with --update so
// the ratchet tightens.
import { ESLint } from 'eslint'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASELINE = fileURLToPath(new URL('./eslintBaseline.json', import.meta.url))
const PATTERN = 'src/**/*.ts'

const eslint = new ESLint()
const results = await eslint.lintFiles([PATTERN])
let errors = 0
let warnings = 0
for (const r of results) {
    errors += r.errorCount
    warnings += r.warningCount
}
const current = { errors, warnings, problems: errors + warnings }

if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify({ pattern: PATTERN, ...current }, null, 4) + '\n')
    console.log(`ESLint baseline written: ${current.problems} problems (${errors} errors, ${warnings} warnings)`)
    process.exit(0)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
console.log(`ESLint: ${current.problems} problems (${errors} errors, ${warnings} warnings); ` +
    `baseline ${baseline.problems} (${baseline.errors} errors, ${baseline.warnings} warnings)`)

if (errors > baseline.errors || warnings > baseline.warnings) {
    console.error(`ESLint ratchet failed: errors ${errors} (max ${baseline.errors}), warnings ${warnings} (max ${baseline.warnings}).`)
    console.error('Run `npx eslint <changed files>` and fix the new problems rather than raising the baseline.')
    process.exit(1)
}
if (errors < baseline.errors || warnings < baseline.warnings) {
    console.log('Fewer problems than the baseline: run `npm run lint:ratchet -- --update` and commit tools/eslintBaseline.json.')
}
