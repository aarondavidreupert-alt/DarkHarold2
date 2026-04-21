/*
Copyright 2024

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.

Panel-drag helper: lets the user click on an empty area of a UI panel's
background and drag it to reposition it within its parent container.

Dragging is initiated only when the mousedown happens on the panel root
itself (or on a non-interactive descendant). Any descendant that is
interactive — has an onclick handler, is a button/input/anchor, or has
`data-drag="no"` on it — is skipped so e.g. inventory-item clicks,
tab buttons, and close buttons keep working normally.

The panel position is written to `elem.style.left / top` as pixels,
interpreted relative to the offsetParent (which for panels mounted in
#uiStage is the 800×600 stage, so drag coords stay in the same frame the
rest of the UI uses). Movement is clamped to keep at least one panel edge
visible within the parent.
*/

function isInteractiveDescendant(target: EventTarget | null, root: HTMLElement): boolean {
    let el: HTMLElement | null = target as HTMLElement | null
    while (el && el !== root) {
        if (el.dataset && el.dataset.drag === 'no') return true
        if (el.onclick || el.onmousedown) return true
        const tag = el.tagName
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' ||
            tag === 'TEXTAREA' || tag === 'A' || tag === 'IMG') return true
        // Honor `cursor: pointer` as a hint that this child is clickable
        const cs = window.getComputedStyle(el)
        if (cs.cursor === 'pointer' || cs.cursor === 'grab') return true
        el = el.parentElement
    }
    return false
}

export function makePanelDraggable(elem: HTMLElement): void {
    let isDragging = false
    let startMouseX = 0, startMouseY = 0
    let startLeft = 0, startTop = 0

    const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return
        if (isInteractiveDescendant(e.target, elem)) return

        isDragging = true
        startMouseX = e.clientX
        startMouseY = e.clientY
        // Read current offset from the element itself — parse inline styles
        // or fall back to offsetLeft/Top which is relative to offsetParent.
        const cs = window.getComputedStyle(elem)
        startLeft = parseFloat(cs.left) || elem.offsetLeft || 0
        startTop = parseFloat(cs.top) || elem.offsetTop || 0
        e.preventDefault()
    }

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return
        if (!elem.isConnected) { isDragging = false; return }
        const dx = e.clientX - startMouseX
        const dy = e.clientY - startMouseY
        elem.style.left = `${startLeft + dx}px`
        elem.style.top = `${startTop + dy}px`
    }

    const onMouseUp = () => {
        if (!isDragging) return
        isDragging = false
    }

    elem.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
}
