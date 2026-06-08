// Copyright 2024-2026 darkf
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Shared DOM micro-helpers consolidated out of the UI files per Alt-B in
// wiki/ts-split-refactor.md. Prior to this module, the same set of one-liner
// helpers ($id, clearEl, showv/hidev, makeEl, etc.) was duplicated across
// 11 UI files. Each helper body is the variant the doc identifies as
// canonical (see "Reconciliation of drifted variants"):
//   - show/hide   touch display only ('block' / 'none')
//   - showv/hidev touch visibility only ('visible' / 'hidden')
//   - makeEl     uses the {classes, attrs, style, children, click, id, src}
//                ElementOptions shape from ui_inventory.ts / ui.ts.

// XXX: Should this throw if the element doesn't exist?
export function $id(id: string): HTMLElement {
    return document.getElementById(id)!
}

export function $img(id: string): HTMLImageElement {
    return document.getElementById(id) as HTMLImageElement
}

export function $q(selector: string): HTMLElement {
    return document.querySelector(selector) as HTMLElement
}

export function $qa(selector: string): HTMLElement[] {
    return Array.from(document.querySelectorAll(selector))
}

export function clearEl($el: HTMLElement): void {
    $el.innerHTML = ''
}

export function show($el: HTMLElement): void {
    $el.style.display = 'block'
}

export function hide($el: HTMLElement): void {
    $el.style.display = 'none'
}

export function showv($el: HTMLElement): void {
    $el.style.visibility = 'visible'
}

export function hidev($el: HTMLElement): void {
    $el.style.visibility = 'hidden'
}

export function off($el: HTMLElement, events: string): void {
    const eventList = events.split(' ')
    for (const event of eventList) {
        ;(<any>$el)['on' + event] = null
    }
}

export function appendHTML($el: HTMLElement, html: string): void {
    $el.insertAdjacentHTML('beforeend', html)
}

export interface ElementOptions {
    id?: string
    src?: string
    classes?: string[]
    click?: (e: MouseEvent) => void
    style?: { [key in keyof CSSStyleDeclaration]?: string }
    children?: HTMLElement[]
    attrs?: { [key: string]: string | number }
}

export function makeEl(tag: string, options: ElementOptions): HTMLElement {
    const $el = document.createElement(tag)

    if (options.id !== undefined) {
        $el.id = options.id
    }
    if (options.src !== undefined) {
        ;($el as HTMLImageElement).src = options.src
    }
    if (options.classes !== undefined) {
        $el.className = options.classes.join(' ')
    }
    if (options.click !== undefined) {
        $el.onclick = options.click
    }
    if (options.style !== undefined) {
        Object.assign($el.style, options.style)
    }
    if (options.children !== undefined) {
        for (const child of options.children) {
            $el.appendChild(child)
        }
    }
    if (options.attrs !== undefined) {
        for (const prop in options.attrs) {
            $el.setAttribute(prop, options.attrs[prop] + '')
        }
    }

    return $el
}
