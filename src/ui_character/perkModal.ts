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

// FO2-CE ref: editor.cc — level-up perk picker modal.
// Triggered by showCharacterScreen() when player.pendingPerkPick is true.

import { font2, font3 } from '../ui_font.js'
import { getValidPerks, getPerkRank, applyPerk } from '../perks.js'
import { PERK_IMG } from './descriptions.js'

// ── Perk Selection Modal ──────────────────────────────────────────────────────
// Shown when player.pendingPerkPick is true after level-up.
// Blocking: CANCEL closes the overlay but does NOT clear pendingPerkPick —
// the player must eventually pick a perk.
// Layout: 573×230px perkwin.png background; button sprites baked into the PNG.
//   Left panel (list):  left 8px, top 15px, 260×165px
//   Right panel (card): title left 282 top 27; body left 282 top 60; img left 410 top 41
//   CANCEL button:      lilredup at left 47  top 187; label at left 64  top 186
//   DONE button:        lilredup at left 159 top 187; label at left 176 top 185

export function showPerkModal(player: any): void {
    if (document.getElementById('perk-modal-overlay')) return

    const validPerks = getValidPerks(player)

    const overlay = document.createElement('div')
    overlay.id = 'perk-modal-overlay'
    Object.assign(overlay.style, {
        position: 'fixed', zIndex: '3000',
        left: '0', top: '0', width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
    })
    // No click-outside-to-close

    // ── Main window box: perkwin.png background, 573×230px ───────────────────
    const box = document.createElement('div')
    Object.assign(box.style, {
        position: 'relative',
        backgroundImage: "url('art/intrface/perkwin.png')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '573px 230px',
        width: '573px',
        height: '230px',
        boxSizing: 'border-box',
    })
    box.onclick = (e) => e.stopPropagation()

    // ── Left panel: scrollable perk list ─────────────────────────────────────
    const listEl = document.createElement('div')
    Object.assign(listEl.style, {
        position: 'absolute',
        left: '40px', top: '38px',
        width: '200px', height: '150px',
        overflowY: 'auto',
        backgroundColor: 'transparent',
    })
    box.appendChild(listEl)

    // ── Right panel: info card ────────────────────────────────────────────────
    // Title (font2, black — mirrors showCharacterScreen cardTitleEl exactly)
    const cardTitleEl = document.createElement('div')
    Object.assign(cardTitleEl.style, {
        position: 'absolute',
        left: '282px', top: '27px',
        width: '128px',
        background: 'transparent',
        padding: '0',
    })
    const cardDividerEl = document.createElement('hr')
    Object.assign(cardDividerEl.style, {
        border: 'none', borderTop: '2px solid #000000',
        margin: '2px 0', width: '100%',
    })
    cardTitleEl.appendChild(cardDividerEl)
    box.appendChild(cardTitleEl)

    // Body text (mirrors showCharacterScreen cardDescEl exactly)
    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        position: 'absolute',
        left: '282px', top: '60px',
        width: '128px', height: '140px',
        fontSize: '0.60em',
        color: '#000000',
        lineHeight: '1.2',
        overflow: 'hidden',
    })
    box.appendChild(cardDescEl)

    // Perk image (mirrors showCharacterScreen cardImgEl exactly)
    const cardImgEl = document.createElement('img') as HTMLImageElement
    Object.assign(cardImgEl.style, {
        position: 'absolute',
        left: '410px', top: '41px',
        width: '145px', height: '165px',
        objectFit: 'contain',
        visibility: 'hidden',
    })
    cardImgEl.onload = () => { cardImgEl.style.visibility = 'visible' }
    cardImgEl.onerror = () => { cardImgEl.style.visibility = 'hidden' }
    box.appendChild(cardImgEl)

    // ── State and helpers ─────────────────────────────────────────────────────
    let selectedPerk: string | null = validPerks.length > 0 ? validPerks[0].name : null

    const updateDoneBtn = () => {
        const enabled = !!selectedPerk
        doneBtn.style.opacity = enabled ? '1' : '0.4'
        doneBtn.style.pointerEvents = enabled ? 'auto' : 'none'
    }

    const showCard = (def: typeof validPerks[0]) => {
        while (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) {
            cardTitleEl.removeChild(cardTitleEl.firstChild)
        }
        cardTitleEl.insertBefore(font2.renderText(def.name.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = def.description
        cardImgEl.style.visibility = 'hidden'
        const imgPath = PERK_IMG[def.name] ?? def.img
        if (imgPath) {
            cardImgEl.src = imgPath
        } else {
            cardImgEl.src = ''
        }
    }

    // ── DONE button — sprite baked into perkwin.png, just the click region ───
    const doneBtn = document.createElement('div')
    Object.assign(doneBtn.style, {
        position: 'absolute',
        left: '159px', top: '187px',
        width: '15px', height: '16px',
        backgroundImage: "url('art/intrface/lilredup.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: '15px 16px',
        opacity: '0.4',
        pointerEvents: 'none',
        zIndex: '1',
    })
    doneBtn.onmousedown = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilreddn.png')" }
    doneBtn.onmouseup = doneBtn.onmouseleave = () => { doneBtn.style.backgroundImage = "url('art/intrface/lilredup.png')" }
    doneBtn.onclick = () => {
        if (!selectedPerk) return
        applyPerk(player, selectedPerk)
        overlay.remove()
    }
    box.appendChild(doneBtn)

    const doneLblEl = document.createElement('div')
    Object.assign(doneLblEl.style, {
        position: 'absolute', left: '176px', top: '185px',
        pointerEvents: 'none', zIndex: '1',
    })
    font3.onLoad(() => { doneLblEl.appendChild(font3.renderText('DONE')) })
    box.appendChild(doneLblEl)

    // ── CANCEL button — always enabled; closes overlay without applying perk ──
    const cancelBtn = document.createElement('div')
    Object.assign(cancelBtn.style, {
        position: 'absolute',
        left: '47px', top: '187px',
        width: '15px', height: '16px',
        backgroundImage: "url('art/intrface/lilredup.png')",
        backgroundRepeat: 'no-repeat', backgroundSize: '15px 16px',
        cursor: 'pointer',
        zIndex: '1',
    })
    cancelBtn.onmousedown = () => { cancelBtn.style.backgroundImage = "url('art/intrface/lilreddn.png')" }
    cancelBtn.onmouseup = cancelBtn.onmouseleave = () => { cancelBtn.style.backgroundImage = "url('art/intrface/lilredup.png')" }
    cancelBtn.onclick = () => { overlay.remove() }
    box.appendChild(cancelBtn)

    const cancelLblEl = document.createElement('div')
    Object.assign(cancelLblEl.style, {
        position: 'absolute', left: '64px', top: '186px',
        pointerEvents: 'none', zIndex: '1',
    })
    font3.onLoad(() => { cancelLblEl.appendChild(font3.renderText('CANCEL')) })
    box.appendChild(cancelLblEl)

    updateDoneBtn()

    // ── Build list rows ───────────────────────────────────────────────────────
    if (validPerks.length === 0) {
        const none = document.createElement('div')
        none.textContent = 'No eligible perks.'
        Object.assign(none.style, { color: '#00FF00', fontSize: '0.68em', padding: '4px 3px' })
        listEl.appendChild(none)
    }

    for (const def of validPerks) {
        const rank = getPerkRank(player, def.name)

        const row = document.createElement('div')
        Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1px 3px',
            cursor: 'pointer',
            fontSize: '0.68em',
            color: '#00FF00',
            backgroundColor: def.name === selectedPerk ? 'rgba(0,255,0,0.2)' : 'transparent',
        })

        const nameSpan = document.createElement('span')
        nameSpan.textContent = def.name

        const rankSpan = document.createElement('span')
        rankSpan.textContent = `${rank + 1}/${def.maxRanks}`
        Object.assign(rankSpan.style, { color: '#70A070', fontSize: '0.9em' })

        row.appendChild(nameSpan)
        row.appendChild(rankSpan)

        row.onmouseenter = () => {
            if (selectedPerk !== def.name) row.style.backgroundColor = 'rgba(0,255,0,0.1)'
        }
        row.onmouseleave = () => {
            row.style.backgroundColor = selectedPerk === def.name ? 'rgba(0,255,0,0.2)' : 'transparent'
        }
        row.onclick = () => {
            selectedPerk = def.name
            listEl.querySelectorAll<HTMLElement>('[data-perk]').forEach(el => {
                el.style.backgroundColor = el.dataset.perk === def.name
                    ? 'rgba(0,255,0,0.2)' : 'transparent'
            })
            showCard(def)
            updateDoneBtn()
        }
        row.dataset.perk = def.name
        listEl.appendChild(row)
    }

    // Show first perk's info by default
    if (validPerks.length > 0) showCard(validPerks[0])

    overlay.appendChild(box)
    document.body.appendChild(overlay)
}
