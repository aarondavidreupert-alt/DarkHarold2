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

import { makePanelDraggable } from '../ui_drag.js'
import { font2, font3 } from '../ui_font.js'
import { getValidPerks, getPerkRank, applyPerk } from '../perks.js'
import { PERK_IMG, SKILL_TEXTS, SKILL_IMG, SKILLS, TRAIT_TEXTS, TRAIT_IMG, TRAITS } from './descriptions.js'
import { getMessage } from '../util.js'
import { assetUrl } from '../modAssets.js'

// ── Perk Selection Modal ──────────────────────────────────────────────────────
// Shown when player.pendingPerkPick is true after level-up.
// Blocking: CANCEL closes the overlay but does NOT clear pendingPerkPick —
// the player must eventually pick a perk.
// Layout: 573×230px perkwin.png background; button sprites baked into the PNG.
//   Left panel (list):  left 8px, top 15px, 260×165px
//   Right panel (card): title left 282 top 27; body left 282 top 60; img left 410 top 41
//   CANCEL button:      lilredup at left 47  top 187; label at left 64  top 186
//   DONE button:        lilredup at left 159 top 187; label at left 176 top 185

// One row of the perk window's list.
interface PickItem {
    name: string
    description: string
    img?: string
    label?: string
}

// `onChange` runs after the dude changed (a perk taken, a trait or tag swapped, a perk
// handed back), so the character screen can pick the change up before DONE.
export function showPerkModal(player: any, onChange: () => void = () => {}): void {
    if (document.getElementById('perk-modal-overlay')) return
    const validPerks = getValidPerks(player)
    // CE perkDialogDrawPerks: sorted by name; "(rank)" after a perk already taken
    const items: PickItem[] = byName(
        validPerks.map((def) => {
            const rank = getPerkRank(player, def.name)
            return {
                name: def.name,
                description: def.description,
                img: PERK_IMG[def.name] ?? def.img,
                label: rank > 0 ? `(${rank})` : '',
            }
        }),
    )
    // CE perkDialogShow: backing out of the Tag! / Mutate! follow-up dialog takes the
    // perk back (perkRemove), so a perk can be picked again.
    const takeBack = (name: string) => () => {
        const i = player.perks.lastIndexOf(name)
        if (i !== -1) player.perks.splice(i, 1)
        if (name === 'Tag!') player.skills.hasTagPerk = false
        player.pendingPerkPick = true
        onChange()
    }
    showPickList(
        null,
        items,
        (name) => {
            const hadTag = getPerkRank(player, 'Tag!') > 0
            applyPerk(player, name)
            onChange()
            if (name === 'Tag!' && !hadTag) {
                setTimeout(() => runTagPick(player, onChange, takeBack('Tag!')), 0)
            } else if (name === 'Mutate!') {
                runMutate(player, onChange, takeBack('Mutate!'))
            }
        },
        () => {},
        'No eligible perks.',
    )
}

// CE character_editor.cc perkDialogHandleTagPerk — PICK A NEW TAG SKILL (editor.msg 155)
// from the untagged skills; it becomes the 4th tag (gCharacterEditorTempTaggedSkills[3]).
function runTagPick(player: any, onChange: () => void, onCancel: () => void): void {
    const options = byName(
        SKILLS.filter((sk) => !player.skills.isTagged(sk)).map((sk): PickItem => ({
            name: sk,
            description: SKILL_TEXTS[sk] ?? '',
            img: SKILL_IMG[sk],
        })),
    )
    showPickList(
        getMessage('editor', 155) ?? 'PICK A NEW TAG SKILL',
        options,
        (sk) => {
            player.skills.tagged = [...player.skills.tagged.slice(0, 3), sk]
            onChange()
        },
        onCancel,
    )
}

// CE character_editor.cc perkDialogHandleMutatePerk — LOSE A TRAIT (editor.msg 154,
// when the player has one), then PICK A NEW TRAIT (153) from the traits not kept.
function runMutate(player: any, onChange: () => void, onCancel: () => void): void {
    const current: string[] = (player.traits ?? []).slice()
    const item = (t: string): PickItem => ({ name: t, description: TRAIT_TEXTS[t] ?? '', img: TRAIT_IMG[t] })
    // CE perkDialogDrawTraits: every trait but the two the dude had (both left out, even the
    // one just dropped), sorted by name
    const pickNew = (kept: string[]) => {
        const options = byName(TRAITS.filter((t) => !current.includes(t)).map(item))
        showPickList(
            getMessage('editor', 153) ?? 'PICK A NEW TRAIT',
            options,
            (t) => {
                player.setTraits([...kept, t])
                onChange()
            },
            onCancel,
        )
    }
    if (current.length >= 1) {
        showPickList(
            getMessage('editor', 154) ?? 'LOSE A TRAIT',
            current.map(item),
            (t) => setTimeout(() => pickNew(current.filter((x) => x !== t)), 0),
            onCancel,
        )
    } else {
        pickNew([])
    }
}

// CE perkDialogOptionCompare: compat_stricmp on the names
function byName(items: PickItem[]): PickItem[] {
    return items.slice().sort((a, b) => {
        const x = a.name.toLowerCase(),
            y = b.name.toLowerCase()
        return x < y ? -1 : x > y ? 1 : 0
    })
}

// The perk window (perkwin.png) as a pick list: `title` over the list (CE draws it
// at 49,16 in font 103), the card on the right, DONE / CANCEL.
function showPickList(
    title: string | null,
    items: PickItem[],
    onDone: (name: string) => void,
    onCancel: () => void,
    emptyText = '',
): void {
    if (document.getElementById('perk-modal-overlay')) return
    const validPerks = items

    const overlay = document.createElement('div')
    overlay.id = 'perk-modal-overlay'
    Object.assign(overlay.style, {
        position: 'fixed',
        zIndex: '3000',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
    })
    // No click-outside-to-close

    // ── Main window box: perkwin.png background, 573×230px ───────────────────
    const box = document.createElement('div')
    Object.assign(box.style, {
        position: 'relative',
        backgroundImage: "url('" + assetUrl('art/intrface/perkwin.png') + "')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '573px 230px',
        width: '573px',
        height: '230px',
        boxSizing: 'border-box',
    })
    box.onclick = (e) => e.stopPropagation()
    makePanelDraggable(box, 'perks')

    if (title) {
        const titleEl = document.createElement('div')
        Object.assign(titleEl.style, { position: 'absolute', left: '49px', top: '14px', pointerEvents: 'none' })
        font3.onLoad(() => {
            titleEl.appendChild(font3.renderText(title))
        })
        box.appendChild(titleEl)
    }

    // ── Left panel: scrollable perk list ─────────────────────────────────────
    const listEl = document.createElement('div')
    Object.assign(listEl.style, {
        position: 'absolute',
        left: '40px',
        top: '38px',
        width: '200px',
        height: '150px',
        overflowY: 'auto',
        backgroundColor: 'transparent',
    })
    box.appendChild(listEl)

    // ── Right panel: info card ────────────────────────────────────────────────
    // Title (font2, black — mirrors showCharacterScreen cardTitleEl exactly)
    const cardTitleEl = document.createElement('div')
    Object.assign(cardTitleEl.style, {
        position: 'absolute',
        left: '282px',
        top: '27px',
        width: '128px',
        background: 'transparent',
        padding: '0',
    })
    const cardDividerEl = document.createElement('hr')
    Object.assign(cardDividerEl.style, {
        border: 'none',
        borderTop: '2px solid #000000',
        margin: '2px 0',
        width: '100%',
    })
    cardTitleEl.appendChild(cardDividerEl)
    box.appendChild(cardTitleEl)

    // Body text (mirrors showCharacterScreen cardDescEl exactly)
    const cardDescEl = document.createElement('div')
    Object.assign(cardDescEl.style, {
        position: 'absolute',
        left: '282px',
        top: '60px',
        width: '128px',
        height: '140px',
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
        left: '410px',
        top: '41px',
        width: '145px',
        height: '165px',
        objectFit: 'contain',
        visibility: 'hidden',
    })
    cardImgEl.onload = () => {
        cardImgEl.style.visibility = 'visible'
    }
    cardImgEl.onerror = () => {
        cardImgEl.style.visibility = 'hidden'
    }
    box.appendChild(cardImgEl)

    // ── State and helpers ─────────────────────────────────────────────────────
    let selectedPerk: string | null = validPerks.length > 0 ? validPerks[0].name : null

    const updateDoneBtn = () => {
        const enabled = !!selectedPerk
        doneBtn.style.opacity = enabled ? '1' : '0.4'
        doneBtn.style.pointerEvents = enabled ? 'auto' : 'none'
    }

    const showCard = (def: (typeof validPerks)[0]) => {
        while (cardTitleEl.firstChild && cardTitleEl.firstChild !== cardDividerEl) {
            cardTitleEl.removeChild(cardTitleEl.firstChild)
        }
        cardTitleEl.insertBefore(font2.renderText(def.name.toUpperCase(), '#000000'), cardDividerEl)
        cardDescEl.textContent = def.description
        cardImgEl.style.visibility = 'hidden'
        const imgPath = def.img
        if (imgPath) {
            cardImgEl.src = assetUrl(imgPath)
        } else {
            cardImgEl.src = ''
        }
    }

    // ── DONE button — sprite baked into perkwin.png, just the click region ───
    const doneBtn = document.createElement('div')
    Object.assign(doneBtn.style, {
        position: 'absolute',
        left: '159px',
        top: '187px',
        width: '15px',
        height: '16px',
        backgroundImage: "url('" + assetUrl('art/intrface/lilredup.png') + "')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '15px 16px',
        opacity: '0.4',
        pointerEvents: 'none',
        zIndex: '1',
    })
    doneBtn.onmousedown = () => {
        doneBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/lilreddn.png') + "')"
    }
    doneBtn.onmouseup = doneBtn.onmouseleave = () => {
        doneBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/lilredup.png') + "')"
    }
    const close = () => {
        overlay.remove()
        window.removeEventListener('keydown', onKey, true)
    }
    doneBtn.onclick = () => {
        if (!selectedPerk) return
        close()
        onDone(selectedPerk)
    }
    box.appendChild(doneBtn)

    const doneLblEl = document.createElement('div')
    Object.assign(doneLblEl.style, {
        position: 'absolute',
        left: '176px',
        top: '185px',
        pointerEvents: 'none',
        zIndex: '1',
    })
    font3.onLoad(() => {
        doneLblEl.appendChild(font3.renderText('DONE'))
    })
    box.appendChild(doneLblEl)

    // ── CANCEL button — always enabled; closes overlay without applying perk ──
    const cancelBtn = document.createElement('div')
    Object.assign(cancelBtn.style, {
        position: 'absolute',
        left: '47px',
        top: '187px',
        width: '15px',
        height: '16px',
        backgroundImage: "url('" + assetUrl('art/intrface/lilredup.png') + "')",
        backgroundRepeat: 'no-repeat',
        backgroundSize: '15px 16px',
        cursor: 'pointer',
        zIndex: '1',
    })
    cancelBtn.onmousedown = () => {
        cancelBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/lilreddn.png') + "')"
    }
    cancelBtn.onmouseup = cancelBtn.onmouseleave = () => {
        cancelBtn.style.backgroundImage = "url('" + assetUrl('art/intrface/lilredup.png') + "')"
    }
    cancelBtn.onclick = () => {
        close()
        onCancel()
    }
    box.appendChild(cancelBtn)

    const cancelLblEl = document.createElement('div')
    Object.assign(cancelLblEl.style, {
        position: 'absolute',
        left: '64px',
        top: '186px',
        pointerEvents: 'none',
        zIndex: '1',
    })
    font3.onLoad(() => {
        cancelLblEl.appendChild(font3.renderText('CANCEL'))
    })
    box.appendChild(cancelLblEl)

    updateDoneBtn()

    // ── Build list rows ───────────────────────────────────────────────────────
    if (validPerks.length === 0) {
        const none = document.createElement('div')
        none.textContent = emptyText
        Object.assign(none.style, { color: '#3cf800', fontSize: '0.68em', padding: '4px 3px' })
        listEl.appendChild(none)
    }

    for (const def of validPerks) {
        const row = document.createElement('div')
        Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1px 3px',
            cursor: 'pointer',
            fontSize: '0.68em',
            color: '#3cf800',
            backgroundColor: def.name === selectedPerk ? 'rgba(0,255,0,0.2)' : 'transparent',
        })

        const nameSpan = document.createElement('span')
        nameSpan.textContent = def.name

        const rankSpan = document.createElement('span')
        rankSpan.textContent = def.label ?? ''
        Object.assign(rankSpan.style, { color: '#70A070', fontSize: '0.9em' })

        row.appendChild(nameSpan)
        row.appendChild(rankSpan)

        row.onmouseenter = () => {
            if (selectedPerk !== def.name) row.style.backgroundColor = 'rgba(0,255,0,0.1)'
        }
        row.onmouseleave = () => {
            row.style.backgroundColor = selectedPerk === def.name ? 'rgba(0,255,0,0.2)' : 'transparent'
        }
        // CE perkDialogHandleInput: a click on the line already selected is DONE
        row.onclick = () => {
            if (selectedPerk === def.name) {
                doneBtn.onclick?.(new PointerEvent('click'))
                return
            }
            select(validPerks.indexOf(def))
        }
        row.dataset.perk = def.name
        listEl.appendChild(row)
    }

    function select(i: number): void {
        if (validPerks.length === 0) return
        const def = validPerks[Math.max(0, Math.min(validPerks.length - 1, i))]
        selectedPerk = def.name
        listEl.querySelectorAll<HTMLElement>('[data-perk]').forEach((el) => {
            el.style.backgroundColor = el.dataset.perk === def.name ? 'rgba(0,255,0,0.2)' : 'transparent'
            if (el.dataset.perk === def.name) el.scrollIntoView({ block: 'nearest' })
        })
        showCard(def)
        updateDoneBtn()
    }

    // CE perkDialogHandleInput: Up / Down a line, Page Up / Down 11 lines, Return = DONE,
    // Esc = CANCEL
    function onKey(e: KeyboardEvent): void {
        const cur = validPerks.findIndex((d) => d.name === selectedPerk)
        switch (e.key) {
            case 'ArrowUp':
                select(cur - 1)
                break
            case 'ArrowDown':
                select(cur + 1)
                break
            case 'PageUp':
                select(cur - 11)
                break
            case 'PageDown':
                select(cur + 11)
                break
            case 'Enter':
                doneBtn.onclick?.(new PointerEvent('click'))
                break
            case 'Escape':
                cancelBtn.onclick?.(new PointerEvent('click'))
                break
            default:
                return
        }
        e.preventDefault()
        e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)

    // Show first perk's info by default
    if (validPerks.length > 0) showCard(validPerks[0])

    overlay.appendChild(box)
    document.body.appendChild(overlay)
}
