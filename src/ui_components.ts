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

// Reusable UI primitives built on top of Widget: WindowFrame (the panel-
// with-background-image container), SmallButton, Label, and List.

import { Point } from './geometry.js'
import { CSSBoundingBox, Widget } from './ui_widget.js'
import { getUiContainer } from './ui_panels.js'

export class WindowFrame {
    children: Widget[] = []
    elem: HTMLElement
    showing = false

    constructor(
        public background: string,
        public position: Point,
        public width: number,
        public height: number,
        children?: Widget[]
    ) {
        this.elem = document.createElement('div')

        Object.assign(this.elem.style, {
            position: 'absolute',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: `${width}px`,
            height: `${height}px`,
            backgroundImage: `url('${background}')`,
        })

        if (children) {
            for (const child of children) {
                this.add(child)
            }
        }
    }

    add(widget: Widget): this {
        this.children.push(widget)
        this.elem.appendChild(widget.elem)
        return this
    }

    show(): this {
        if (this.showing) {
            return this
        }
        this.showing = true
        getUiContainer().appendChild(this.elem)
        return this
    }

    close(): void {
        if (!this.showing) {
            return
        }
        this.showing = false
        this.elem.parentNode!.removeChild(this.elem)
    }

    toggle(): this {
        if (this.showing) {
            this.close()
        } else {
            this.show()
        }
        return this
    }
}

export class SmallButton extends Widget {
    constructor(x: number, y: number) {
        super('art/intrface/lilredup.png', { x, y, w: 15, h: 16 })
        this.mouseDownBG('art/intrface/lilreddn.png')
    }
}

export class AllButton extends Widget {
    constructor(x: number, y: number) {
        super('art/intrface/allbon.png', { x, y, w: 94, h: 33 })
        this.mouseDownBG('art/intrface/allboff.png')
    }
}

export class Label extends Widget {
    constructor(x: number, y: number, text: string, public textColor: string = 'yellow') {
        super(null, { x, y, w: 'auto', h: 'auto' })
        this.setText(text)
        this.elem.style.color = this.textColor
    }

    setText(text: string): void {
        this.elem.innerHTML = text
    }
}

interface ListItem {
    id?: any // identifier userdata
    uid?: number // unique identifier (filled in by List)
    text: string
    onSelected?: () => void
}

// TODO: disable-selection class
export class List extends Widget {
    items: ListItem[] = []
    itemSelected?: (item: ListItem) => void
    currentlySelected: ListItem | null = null
    currentlySelectedElem: HTMLElement | null = null
    _lastUID = 0

    constructor(
        bbox: CSSBoundingBox,
        items?: ListItem[],
        public textColor: string = '#00FF00',
        public selectedTextColor: string = '#FCFC7C'
    ) {
        super(null, bbox)
        this.elem.style.color = this.textColor

        if (items) {
            for (const item of items) {
                this.addItem(item)
            }
        }
    }

    onItemSelected(fn: (item: ListItem) => void): this {
        this.itemSelected = fn
        return this
    }

    getSelection(): ListItem | null {
        return this.currentlySelected
    }

    // Select the given item (and optionally, give its element for performance reasons)
    select(item: ListItem, itemElem?: HTMLElement): boolean {
        if (!itemElem) {
            // Find element belonging to this item
            itemElem = this.elem.querySelector(`[data-uid="${item.uid}"]`) as HTMLElement
        }

        if (!itemElem) {
            console.warn(`[UI] can't find item's element for item UID ${item.uid}`)
            return false
        }

        this.itemSelected && this.itemSelected(item)

        item.onSelected && item.onSelected()

        if (this.currentlySelectedElem) {
            // Reset text color for old selection
            this.currentlySelectedElem.style.color = this.textColor
        }

        // Use selection color for new selection
        itemElem.style.color = this.selectedTextColor

        this.currentlySelected = item
        this.currentlySelectedElem = itemElem

        return true
    }

    // Select item given by its id
    selectId(id: any): boolean {
        const item = this.items.filter((item) => item.id === id)[0]
        if (!item) {
            return false
        }
        this.select(item)
        return true
    }

    addItem(item: ListItem): ListItem {
        item.uid = this._lastUID++
        this.items.push(item)

        const itemElem = document.createElement('div')
        itemElem.style.cursor = 'pointer'
        itemElem.textContent = item.text
        itemElem.setAttribute('data-uid', item.uid + '')
        itemElem.onclick = () => {
            this.select(item, itemElem)
        }
        this.elem.appendChild(itemElem)

        // Select first item added
        if (!this.currentlySelected) {
            this.select(item)
        }

        return item
    }

    clear(): void {
        this.items.length = 0

        const node = this.elem
        while (node.firstChild) {
            node.removeChild(node.firstChild)
        }
    }
}
