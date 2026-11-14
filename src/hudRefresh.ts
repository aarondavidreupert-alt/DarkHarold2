// The HUD redraws game logic asks for (HP, AC and AP counters, the weapon button, the indicator
// bar). A leaf module: uiHud.ts plugs its functions in when it loads (setHudRefresh), so combat,
// objects, scripting and the rest do not import the HUD (wiki/code_quality.md Q14). The calls
// all happen while the game runs, after uiHud.ts has loaded.

interface HudRefresh {
    drawHP(hp: number): void
    drawAC(ac: number): void
    drawAP(current: number, max: number, freeMove?: number, isPlayerTurn?: boolean): void
    uiDrawWeapon(): void
    updateIndicatorBar(): void
    syncHP(): void
}

let hud: HudRefresh | null = null

export function setHudRefresh(impl: HudRefresh): void {
    hud = impl
}

/** Once per frame (gameTick.ts): the HUD's hit points follow the player's, whatever changed them.
 *  CE calls interfaceRenderHitPoints at each place that changes the dude's HP; a path that misses
 *  it (as critter_heal did) left the counter stale until the next redraw. DH2 safety net. */
export function syncHudHP(): void {
    hud?.syncHP()
}

export function drawHP(hp: number): void {
    hud?.drawHP(hp)
}
export function drawAC(ac: number): void {
    hud?.drawAC(ac)
}
export function drawAP(current: number, max: number, freeMove: number = 0, isPlayerTurn: boolean = true): void {
    hud?.drawAP(current, max, freeMove, isPlayerTurn)
}
export function uiDrawWeapon(): void {
    hud?.uiDrawWeapon()
}
export function updateIndicatorBar(): void {
    hud?.updateIndicatorBar()
}
