// Attach methods kept in other files to a class's prototype (wiki/code_quality.md Q16: a class
// over 1500 lines is split by topic, e.g. combat/combatAttack.ts for Combat). Each method gets the
// property descriptor a method written in the class body has (writable, configurable, not
// enumerable), so instances behave exactly as before; the class's interface merge
// (`interface Combat extends CombatMethods`) gives callers their types.

export function installMethods(prototype: object, ...groups: object[]): void {
    for (const group of groups) {
        for (const key of Object.keys(group)) {
            Object.defineProperty(prototype, key, {
                value: (group as Record<string, unknown>)[key],
                writable: true,
                configurable: true,
                enumerable: false,
            })
        }
    }
}
