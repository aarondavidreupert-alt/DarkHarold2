// The element top-level UI windows are appended into. Its own module with no imports, so a
// window that only needs its container (uiDialog.ts) does not import the panels
// (wiki/code_quality.md Q14); uiPanels.ts re-exports it.

let $uiContainer: HTMLElement | null = null

export function initUiContainer(): HTMLElement {
    $uiContainer = (document.getElementById('uiStage') ?? document.getElementById('game-container'))!
    return $uiContainer
}

/**
 * Returns the element that top-level UI windows (skilldex / character / save-
 * load / worldmap) are appended into. Must be called after initUiContainer().
 */
export function getUiContainer(): HTMLElement {
    if (!$uiContainer) {
        // Fall back to locating it lazily — initUiContainer() is normally
        // called early in uiInit() but some code paths reach here before
        // that runs (e.g. hot module reload in dev).
        return initUiContainer()
    }
    return $uiContainer
}
