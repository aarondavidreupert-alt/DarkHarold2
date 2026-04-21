// Copyright 2014-2026 darkf
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

// Base Widget primitive. Lives in its own file so that modules like
// font.ts can subclass Widget without re-entering ui.ts (which would
// form an import cycle: ui.ts → font.ts → ui.ts).

// Bounding box that accepts strings as well as numbers
export interface CSSBoundingBox {
    x: number | string
    y: number | string
    w: number | string
    h: number | string
}

export class Widget {
    elem: HTMLElement
    hoverBackground: string | null = null
    mouseDownBackground: string | null = null

    constructor(public background: string | null, public bbox: CSSBoundingBox) {
        this.elem = document.createElement('div')

        Object.assign(this.elem.style, {
            position: 'absolute',
            left: `${bbox.x}px`,
            top: `${bbox.y}px`,
            width: `${bbox.w}px`,
            height: `${bbox.h}px`,
            backgroundImage: background && `url('${background}')`,
        })
    }

    onClick(fn: (widget?: Widget) => void): this {
        this.elem.onclick = () => {
            fn(this)
        }
        return this
    }

    hoverBG(background: string): this {
        this.hoverBackground = background

        if (!this.elem.onmouseenter) {
            // Set up events for hovering/not hovering
            this.elem.onmouseenter = () => {
                this.elem.style.backgroundImage = `url('${this.hoverBackground}')`
            }
            this.elem.onmouseleave = () => {
                this.elem.style.backgroundImage = `url('${this.background}')`
            }
        }

        return this
    }

    mouseDownBG(background: string): this {
        this.mouseDownBackground = background

        if (!this.elem.onmousedown) {
            // Set up events for mouse down/up
            this.elem.onmousedown = () => {
                this.elem.style.backgroundImage = `url('${this.mouseDownBackground}')`
            }
            this.elem.onmouseup = () => {
                this.elem.style.backgroundImage = `url('${this.background}')`
            }
        }

        return this
    }

    css(props: object): this {
        Object.assign(this.elem.style, props)
        return this
    }
}
