// Test stand-in for js/logger.js (see register.mjs): same exports, no output, no globalState.
export function dbg() {}
export function dbgWarn() {}
export function eventLogPush(entry) { return entry }
export function eventLogClear() {}
