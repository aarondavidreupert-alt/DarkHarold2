/*
Copyright 2014 darkf

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// CE message.cc badwordsInit / messageListFilterBadwords — the language filter: every
// word of data/badwords.txt (case-insensitive) in script dialogue and AI combat messages
// is overwritten with characters cycled from gBadwordsReplacements, while the
// language_filter preference is on. Kept as CE has it: a word at the very start of a
// message matches even inside a longer word.

import { Config } from './config.js'
import { getFileText } from './util.js'
import { dbg } from './logger.js'

const REPLACEMENTS = '!@#$%&*@#*!&$%#&%#*%!$&%@*$@&'
let badwords: string[] | null = null

function loadBadwords(): string[] {
    if (badwords) return badwords
    badwords = []
    try {
        badwords = getFileText('data/data/badwords.txt').split('\n')
            .map((w) => w.replace(/\r$/, '')).filter((w) => w.length > 0).map((w) => w.toUpperCase())
    } catch (e) {
        dbg('load', `badwords.txt not loaded: ${e}`)
    }
    return badwords
}

const isAlpha = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c)

/** Filter a message list in place (CE messageListFilterBadwords); no-op while the
 *  preference is off. */
export function filterBadwords(entries: { [num: number]: string }): void {
    if (!Config.ui.languageFilter) return
    const words = loadBadwords()
    if (words.length === 0) return
    let r = Math.floor(Math.random() * REPLACEMENTS.length) // randomBetween(1, count) - 1
    for (const key of Object.keys(entries)) {
        const num = Number(key)
        const text = entries[num]
        const upper = text.toUpperCase()
        const out = text.split('')
        for (const word of words) {
            for (let from = 0; ; from++) {
                const at = upper.indexOf(word, from)
                if (at === -1) break
                if (at === 0 || (!isAlpha(upper[at - 1]) && !isAlpha(upper[at + word.length]))) {
                    for (let j = 0; j < word.length; j++) {
                        out[at + j] = REPLACEMENTS[r++]
                        if (r === REPLACEMENTS.length) r = 0
                    }
                }
                from = at
            }
        }
        entries[num] = out.join('')
    }
}

/** One message (the AI's combat lines). */
export function filterBadwordsText(text: string): string {
    const list = { 0: text }
    filterBadwords(list)
    return list[0]
}
