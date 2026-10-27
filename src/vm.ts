/*
Copyright 2015 darkf

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

import { transpile } from './transpiler.js'
import { IntFile } from './intfile.js'
import { arrayIncludes, BinaryReader } from './util.js'
import { Config } from './config.js'
import { dbg, dbgWarn } from './logger.js'

// Scripting VM for .INT files

function binop(f: (x: any, y: any) => any) {
    return function (this: ScriptVM) {
        const rhs = this.pop()
        this.push(f(this.pop(), rhs))
    }
}

// CE VALUE_TYPE_FLOAT (pushed by 0xA001): floats travel the data stack boxed in a
// Number object so the arithmetic can tell them from integers (CE interpreter.cc
// opAdd..opDivide: int op int stays an int — division truncates —, anything with a
// float gives a float). pop() unboxes them for every other consumer.
export function isVMFloat(x: any): x is Number {
    return x instanceof Number
}
function vmFloat(v: number): Number {
    return new Number(Math.fround(v))
}
function unbox(x: any): any {
    return x instanceof Number ? x.valueOf() : x
}
// CE opAdd: a float joins a string as "%.5f"; a comparison result (a JS
// boolean here, an int in CE) as 0/1
function asText(x: any): any {
    if (typeof x === 'boolean') return x ? 1 : 0
    return x instanceof Number ? x.valueOf().toFixed(5) : x
}
// CE VALUE_TYPE_* of a stack value: a comparison result (a JS boolean) is an int
function vmType(x: any): 'int' | 'float' | 'string' | 'ptr' {
    if (x instanceof Number) return 'float'
    if (typeof x === 'number' || typeof x === 'boolean') return 'int'
    if (typeof x === 'string') return 'string'
    return 'ptr'
}
// the integer field of a value (a string's or pointer's is meaningless in CE: 0 here)
function intOf(x: any): number {
    return typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0
}
// CE opLogicalOperatorAnd/Or truthiness: an int or float is true when not 0, a
// string always, a pointer when not null
function sslTrue(x: any): boolean {
    if (typeof x === 'string') return true
    if (typeof x === 'number') return x !== 0
    return !!x
}

// CE programFatalError: logs and longjmps out of the running procedure; the
// script itself stays loaded. ScriptVM.run catches it (see there).
export class VMFatalError extends Error {}
let fatalHook: ((text: string) => void) | null = null
/** Also report VM fatal errors here (the VM-vs-Lua test page uses it). */
export function setVMFatalHook(hook: ((text: string) => void) | null): void {
    fatalHook = hook
}
// CE opDivide / opModulo: "Division (DIV|MOD) by zero" is a fatal error
function checkDivisor(vm: ScriptVM, op: string): void {
    const d = unbox(vm.dataStack[vm.dataStack.length - 1])
    if (d === 0 || d === false) throw new VMFatalError(`Division (${op}) by zero`)
}
function arith(f: (x: number, y: number) => number, intResult: (r: number) => number = (r) => r) {
    return function (this: ScriptVM) {
        const rhs = this.popRaw()
        const lhs = this.popRaw()
        if (typeof lhs === 'string' || typeof rhs === 'string') {
            this.push(f(asText(lhs), asText(rhs)))
        } else if (isVMFloat(lhs) || isVMFloat(rhs)) {
            this.push(vmFloat(f(unbox(lhs), unbox(rhs))))
        } else {
            this.push(intResult(f(lhs, rhs)))
        }
    }
}

// CE interpreter.h PROCEDURE_FLAG_*
const PROC_TIMED = 0x01
const PROC_CONDITIONAL = 0x02
const PROC_IMPORTED = 0x04

function nowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// CE Procedure.flags / time / conditionOffset for call_at / call_when (opDelayedCall,
// opConditionalCall); the VMs with one pending, for vmDoEvents
interface ProcEvent { flags: number; time: number; conditionOffset: number }
const eventVMs = new Set<ScriptVM>()

/** CE interpreter.cc _doEvents (from _updatePrograms, every game loop): a conditional
 *  procedure runs once its condition code gives true, a timed one once its time has
 *  passed; either is cleared before it runs. */
export function vmDoEvents(): void {
    const now = nowMs()
    for (const vm of [...eventVMs]) {
        if (vm.dead) { eventVMs.delete(vm); continue }
        for (const [index, ev] of [...vm.procEvents]) {
            if ((ev.flags & PROC_CONDITIONAL) !== 0) {
                const cond = vm.evalAt(ev.conditionOffset)
                if (cond === undefined || !sslTrue(cond)) continue
            } else if ((ev.flags & PROC_TIMED) === 0 || ev.time >= now) {
                continue
            }
            vm.procEvents.delete(index)
            const proc = vm.intfile.proceduresTable[index]
            if (proc) vm.call(proc.name)
        }
        if (vm.procEvents.size === 0) eventVMs.delete(vm)
    }
}

// CE export.cc external procedures (opExportProcedure): name → the exporting program
const externalProcedures = new Map<string, { vm: ScriptVM; name: string; argc: number }>()
/** A map change / new game: every program goes, and with it its exports and pending
 *  call_at / call_when procedures (CE programFree → _removeProgramReferences). */
export function vmClearPrograms(keep: (vm: ScriptVM) => boolean = () => false): void {
    for (const [name, ext] of [...externalProcedures]) if (!keep(ext.vm)) externalProcedures.delete(name)
    for (const vm of [...eventVMs]) {
        if (keep(vm)) continue
        vm.procEvents.clear()
        eventVMs.delete(vm)
    }
}

// CE runScript (callstart / spawn / fork / exec): loads a program and runs its startup
// code. Set by the scripting layer, which knows where scripts come from.
let childLoader: ((name: string) => ScriptVM | null) | null = null
export function setChildProgramLoader(loader: ((name: string) => ScriptVM | null) | null): void {
    childLoader = loader
}
function spawnChild(vm: ScriptVM): ScriptVM {
    const name = String(vm.pop())
    const child = childLoader ? childLoader(name.replace(/\.int$/i, '')) : null
    if (!child) throw new VMFatalError(`Error spawning child ${name}`)
    return child
}

// CE opPopFlags: the flags, checkWaitFunc and windowId the call put under the frame
function popFlags(vm: ScriptVM): void {
    vm.popRaw()
    vm.popRaw()
    vm.popRaw()
}
// back to the caller's address; -1 is the engine call's own sentinel (the procedure is over)
function returnTo(vm: ScriptVM, addr: number, exit: boolean): void {
    if (addr === -1 || exit) vm.halted = true
    if (addr !== -1) vm.pc = addr
}

export const opMap: { [opcode: number]: (this: ScriptVM) => void } = {
    0x8000: function () {}, // CE opNoop
    0x8001: function () {
        // CE opPush: the untyped push; the value's type is the opcode word's (an int)
        this.push(this.script.read32() | 0)
    },
    0x8002: function () {}, // start critical (nop)
    // CE OPCODE_START_CRITICAL / END_CRITICAL: the second slot of enter / leave critical
    // section; DH2 runs a procedure to its end anyway
    0x804a: function () {},
    0x804b: function () {},
    0x802e: function () {
        // CE opDump: pop a count, then that many values
        const n = this.pop()
        for (let i = 0; i < n; i++) this.popRaw()
    },
    0x8018: function () {
        // CE opSwapStack
        const a = this.popRaw()
        const b = this.popRaw()
        this.push(a)
        this.push(b)
    },
    0x801e: function () {
        this.popAddr()
    }, // CE opPopAddress
    0x802d: function () {
        // CE opFetchProcedureAddress: a procedure's body offset
        const proc = this.intfile.proceduresTable[this.pop()]
        if (!proc) throw new VMFatalError('fetch_proc_address: no such procedure')
        this.push(proc.offset)
    },
    0x8011: function () {
        // CE opStopProgram: PROGRAM_FLAG_STOPPED — the procedure ends here; the next call
        // starts with fresh flags (_setupCallWithReturnVal)
        this.stopped = true
        this.halted = true
    },
    0x801d: function () {
        returnTo(this, this.popAddr(), true)
    }, // CE opPopExit
    0x801f: function () {
        popFlags(this)
    }, // CE opPopFlags
    0x8020: function () {
        popFlags(this)
        returnTo(this, this.popAddr(), false)
    }, // CE opPopFlagsReturn
    0x8021: function () {
        popFlags(this)
        returnTo(this, this.popAddr(), true)
    }, // CE opPopFlagsExit
    0x8025: function () {
        const value = this.popRaw()
        popFlags(this)
        returnTo(this, this.popAddr(), true)
        this.push(value)
    }, // CE opPopFlagsReturnValExit
    // the *Extern forms end a call another program made (_setupExternalCall): the
    // caller's flags, checkWaitFunc and Program are on the return stack under the
    // return address. DH2 makes that call through ScriptVM.call, which takes the value.
    0x8022: function () {
        popFlags(this)
        this.popAddr(); this.popAddr(); this.popAddr()
        returnTo(this, this.popAddr(), false)
    }, // CE opPopFlagsReturnExtern
    0x8023: function () {
        popFlags(this)
        this.popAddr(); this.popAddr(); this.popAddr()
        returnTo(this, this.popAddr(), true)
    }, // CE opPopFlagsExitExtern
    0x8024: function () {
        const value = this.popRaw()
        popFlags(this)
        this.popAddr(); this.popAddr(); this.popAddr()
        returnTo(this, this.popAddr(), false)
        this.push(value)
    }, // CE opPopFlagsReturnValExtern
    0x8026: function () {
        const value = this.popRaw()
        popFlags(this)
        this.popAddr(); this.popAddr(); this.popAddr()
        returnTo(this, this.popAddr(), true)
        this.push(value)
    }, // CE opPopFlagsReturnValExitExtern
    0x8006: function () {
        // CE opDelayedCall (call_at): procedure index, then the delay in seconds
        const index = this.pop()
        const seconds = this.pop()
        const ev = this.procEvents.get(index) ?? { flags: 0, time: 0, conditionOffset: 0 }
        ev.flags |= PROC_TIMED
        ev.time = nowMs() + 1000 * seconds
        this.procEvents.set(index, ev)
        eventVMs.add(this)
    },
    0x8007: function () {
        // CE opConditionalCall (call_when): procedure index, then its condition code's offset
        const index = this.pop()
        const offset = this.pop()
        const ev = this.procEvents.get(index) ?? { flags: 0, time: 0, conditionOffset: 0 }
        ev.flags |= PROC_CONDITIONAL
        ev.conditionOffset = offset
        this.procEvents.set(index, ev)
        eventVMs.add(this)
    },
    0x8047: function () {
        // CE opWait: the program waits that many ms; a game script runs inside
        // _executeProcedure's loop, so the game stands still meanwhile (capped at 10 s)
        const ms = Math.min(10000, Math.max(0, this.pop()))
        const end = nowMs() + ms
        while (nowMs() < end) { /* CE _checkWait */ }
    },
    0x8048: function () {
        // CE opCancel
        const index = this.pop()
        if (index >= this.intfile.proceduresTable.length) throw new VMFatalError('Invalid procedure offset given to cancel')
        this.procEvents.delete(index)
    },
    0x8049: function () {
        this.procEvents.clear()
    }, // CE opCancelAll
    0x8017: function () {
        // CE opExportProcedure: procedure index, then its argument count
        const proc = this.intfile.proceduresTable[this.pop()]
        const argc = this.pop()
        if (!proc) throw new VMFatalError('Error exporting procedure')
        const key = proc.name.toLowerCase()
        const prev = externalProcedures.get(key)
        if (prev && prev.vm !== this && !prev.vm.dead) throw new VMFatalError(`Error exporting procedure ${proc.name}`)
        externalProcedures.set(key, { vm: this, name: proc.name, argc })
    },
    0x800e: function () {
        // CE opExit: the program is over for good (program->exited)
        this.dead = true
        this.stopped = true
        this.halted = true
    },
    0x800f: function () {}, // CE opDetach: DH2's child programs never keep a parent waiting
    0x8008: function () {
        // CE opCallStart: the parent waits (PROGRAM_FLAG_0x20) for the child, whose startup
        // code runScript runs; DH2 runs it to its end at once
        if (this.child) throw new VMFatalError('Error, already have a child process')
        spawnChild(this).parent = this // its startup run is over: nothing left to wait for
    },
    0x800a: function () {
        // CE opSpawn (PROGRAM_FLAG_0x0100), as callstart
        if (this.child) throw new VMFatalError('Error, already have a child process')
        const child = spawnChild(this)
        child.parent = this
    },
    0x800b: function () {
        spawnChild(this)
    }, // CE opFork
    0x8009: function () {
        // CE opExec: a forked child takes this program's place, which exits
        spawnChild(this).parent = this.parent
        this.dead = true
        this.stopped = true
        this.halted = true
    },
    0xc001: function () {
        // CE opPush: a signed 32-bit int (sslc folds `-1` into 0xFFFFFFFF)
        this.push(this.script.read32() | 0)
    }, // op_push_d
    0x800d: function () {
        this.retStack.push(this.pop())
    }, // op_d_to_a
    0x800c: function () {
        this.push(this.popAddr())
    }, // op_a_to_d
    0x801a: function () {
        this.pop()
    }, // op_pop
    0x8004: function () {
        this.pc = this.pop()
    }, // op_jmp
    0x8003: function () {}, // op_critical_done (nop)
    0x802b: function () {
        // op_push_base
        const argc = this.pop()
        this.retStack.push(this.dvarBase)
        this.dvarBase = this.dataStack.length - argc
        // console.log("op_push_base (argc %d)", argc)
    },
    0x8019: function () {
        // op_swapa
        const a = this.popAddr()
        const b = this.popAddr()
        this.retStack.push(a)
        this.retStack.push(b)
    },
    0x802a: function () {
        this.dataStack.splice(this.dvarBase)
    }, // op_pop_to_base
    0x8029: function () {
        this.dvarBase = this.popAddr()
    }, // op_pop_base
    0x802c: function () {
        this.svarBase = this.dataStack.length
    }, // op_set_global
    0x8013: function () {
        const num = this.pop()
        this.dataStack[this.svarBase + num] = this.popRaw()
    }, // op_store_global
    0x8012: function () {
        const num = this.pop()
        this.push(this.dataStack[this.svarBase + num])
    }, // op_fetch_global
    0x801c: function () {
        // op_pop_return
        const addr = this.popAddr()
        if (addr === -1) this.halted = true
        else this.pc = addr
    },
    0x8010: function () {
        this.halted = true /*console.log("op_exit_prog")*/
    }, // op_exit_prog

    0x802f: function () {
        // CE opIf → ProgramValue::isEmpty: 0 / 0.0 / a null object are false, a string true
        if (!sslTrue(this.pop())) {
            this.pc = this.pop()
        } else this.pop()
    }, // op_if
    0x8031: function () {
        const varNum = this.pop()
        this.dataStack[this.dvarBase + varNum] = this.popRaw()
    }, // op_store
    0x8032: function () {
        this.push(this.dataStack[this.dvarBase + this.pop()])
    }, // op_fetch
    0x8046: function () {
        const v = this.popRaw()
        this.push(isVMFloat(v) ? vmFloat(-v.valueOf()) : -v)
    }, // op_negate
    0x8044: function () {
        // CE opFloor: a float becomes (int)value — truncation; an int stays
        this.push(Math.trunc(this.pop()))
    }, // op_floor
    0xa001: function () {
        // CE: push a 32-bit float literal (VALUE_TYPE_FLOAT)
        const bits = this.script.read32()
        const view = new DataView(new ArrayBuffer(4))
        view.setUint32(0, bits)
        this.push(vmFloat(view.getFloat32(0)))
    }, // op_push_f
    0x806b: function () {
        // CE interpreter_lib.cc opDisplay: shows the image file named by the string in
        // the program's window. gcfestus.int passes a message text, so no file is found
        // and nothing is drawn — only the argument is consumed.
        this.pop()
    }, // display
    0x801b: function () {
        this.push(this.dataStack[this.dataStack.length - 1])
    }, // op_dup

    0x8030: function () {
        // op_while (CE opWhile: ProgramValue::isEmpty, as op_if)
        const cond = this.pop()
        if (!sslTrue(cond)) {
            const pc = this.pop()
            this.pc = pc
        }
    },

    0x8028: function () {
        // op_lookup_string_proc (look up procedure index by name)
        // CE opLookupStringProc → programFatalError when the name isn't a procedure
        const name = this.pop()
        const proc = this.intfile.procedures[name]
        if (!proc) throw new VMFatalError(`Could not find procedure ${name}`)
        this.push(proc.index)
    },
    0x8027: function () {
        // op_check_arg_count
        const argc = this.pop()
        const procIdx = this.pop()
        const proc = this.intfile.proceduresTable[procIdx]
        dbg('script', 'CHECK ARGS: argc=%d procIdx=%d, proc=%o', argc, procIdx, proc)
        // CE opCheckProcedureArgumentCount → programFatalError
        if (argc !== proc.argc) throw new VMFatalError(`Wrong number of args to procedure ${proc.name}: expected ${proc.argc}, got ${argc}`)
    },

    //,0x806B: function() { console.log("DISPLAY: %s", this.pop()) }

    0x8005: function () {
        // op_call (TODO: verify)
        // the script should have already pushed the return value (and possibly argc)
        const proc = this.intfile.proceduresTable[this.pop()]
        // CE opCall: an imported procedure is not followed ("TODO: Incomplete")
        if ((proc.flags & PROC_IMPORTED) === 0) this.pc = proc.offset
    },
    0x9001: function () {
        // push a string from either the strings or identifiers table.
        // normally Fallout 2 checks the type of the operand per-instruction
        // and treats the actual operand however it wants. in this case,
        // it will either be treated like a string, or an identifier.
        //
        // we just check the next instruction and match it up with the set of
        // instructions who use it as an identifier (whom use interpretGetName).

        const num = this.script.read32()
        const nextOpcode = this.script.peek16()

        if (
            arrayIncludes(
                [
                    0x8014, // op_fetch_external
                    0x8015, // op_store_external
                    0x8016, // op_export_var
                    //,0x8017 // op_export_proc (TODO: verify)
                    //,0x8005: // op_call (TODO: verify, might need more operands)
                ],
                nextOpcode
            )
        ) {
            // fetch an identifier
            if (this.intfile.identifiers[num] === undefined)
                throw Error('ScriptVM: 9001 requested identifier ' + num + " but it doesn't exist")
            this.push(this.intfile.identifiers[num])
        } else {
            // fetch a string
            if (this.intfile.strings[num] === undefined)
                throw Error('ScriptVM: 9001 requested string ' + num + " but it doesn't exist")
            this.push(this.intfile.strings[num])
        }
    },

    // logic/comparison
    // CE interpreter.cc: the comparisons and ! push an int 0 / 1
    0x8045: function () {
        this.push(sslTrue(this.pop()) ? 0 : 1)
    },
    // == / != stay loose on purpose: SSL values mix ints, floats and strings (and objects), and
    // scripts rely on the VM's comparison as it is; luadiff compares it with the Lua backend
    0x8033: binop(function (x, y) {
        return +(x == y) // eslint-disable-line eqeqeq
    }),
    0x8034: binop(function (x, y) {
        return +(x != y) // eslint-disable-line eqeqeq
    }),
    0x8035: binop(function (x, y) {
        return +(x <= y)
    }),
    0x8036: binop(function (x, y) {
        return +(x >= y)
    }),
    0x8037: binop(function (x, y) {
        return +(x < y)
    }),
    0x8038: binop(function (x, y) {
        return +(x > y)
    }),
    // CE opLogicalOperatorAnd/Or push 0/1, not an operand
    0x803e: binop(function (x, y) {
        return sslTrue(x) && sslTrue(y) ? 1 : 0
    }),
    0x803f: binop(function (x, y) {
        return sslTrue(x) || sslTrue(y) ? 1 : 0
    }),
    0x8040: binop(function (x, y) {
        return x & y
    }),
    0x8041: binop(function (x, y) {
        return x | y
    }),
    // CE interpreter.cc opBitwiseOperatorXor / opBitwiseOperatorNot (32-bit ints); no
    // vanilla script uses them, the Unofficial Patch's craps scripts do (wiki/upu_support.md)
    0x8042: binop(function (x, y) {
        return x ^ y
    }),
    0x8043: function () {
        this.push(~this.pop())
    },
    0x8039: function () {
        // CE opAdd: a string on either side concatenates (a float as "%.5f"); int + int that
        // overflows gives a float; a pointer adds only to a string, else nothing is pushed
        const rhs = this.popRaw()
        const lhs = this.popRaw()
        const l = vmType(lhs), r = vmType(rhs)
        if (l === 'string' || (r === 'string' && l !== 'ptr')) this.push(String(asText(lhs)) + String(asText(rhs)))
        else if (l === 'ptr') { if (r === 'string') this.push(String(lhs) + rhs) }
        else if (r === 'ptr') return
        else if (l === 'float' || r === 'float') this.push(vmFloat(unbox(lhs) + unbox(rhs)))
        else {
            const sum = intOf(lhs) + intOf(rhs)
            this.push(sum > 0x7fffffff || sum < -0x80000000 ? vmFloat(sum) : sum)
        }
    },
    0x803a: function () {
        // CE opSubtract: int - int wraps; a float on either side gives a float; a string or
        // pointer on the left pushes nothing
        const rhs = this.popRaw()
        const lhs = this.popRaw()
        const l = vmType(lhs)
        if (l === 'float') this.push(vmFloat(unbox(lhs) - (isVMFloat(rhs) ? unbox(rhs) : intOf(rhs))))
        else if (l === 'int') this.push(isVMFloat(rhs) ? vmFloat(intOf(lhs) - unbox(rhs)) : (intOf(lhs) - intOf(rhs)) | 0)
    },
    0x803b: function () {
        // CE opMultiply, as opSubtract (int * int wraps)
        const rhs = this.popRaw()
        const lhs = this.popRaw()
        const l = vmType(lhs)
        if (l === 'float') this.push(vmFloat(unbox(lhs) * (isVMFloat(rhs) ? unbox(rhs) : intOf(rhs))))
        else if (l === 'int') this.push(isVMFloat(rhs) ? vmFloat(intOf(lhs) * unbox(rhs)) : Math.imul(intOf(lhs), intOf(rhs)))
    },
    0x803d: function () {
        // CE opModulo: a float on either side is fatal, a non-int left side pushes nothing
        const rhs = this.popRaw()
        const lhs = this.popRaw()
        if (isVMFloat(lhs)) throw new VMFatalError('Trying to MOD a float')
        if (vmType(lhs) !== 'int') return
        if (isVMFloat(rhs)) throw new VMFatalError('Trying to MOD with a float')
        const d = intOf(rhs)
        if (d === 0) throw new VMFatalError('Division (MOD) by zero')
        this.push((intOf(lhs) % d) | 0)
    },
    // sfall math (CE sfall_opcodes.cc), here for the typed values: floats stay boxed
    // op_sqrt (0x81EC): a float
    0x81ec: function () {
        this.push(vmFloat(Math.sqrt(Number(unbox(this.popRaw())) || 0)))
    },
    // op_atof (0x8238): a float
    0x8238: function () {
        this.push(vmFloat(parseFloat(String(unbox(this.popRaw()))) || 0))
    },
    // opTypeOf (0x8253): 1 int, 2 float, 3 string (anything else)
    0x8253: function () {
        const v = this.popRaw()
        this.push(isVMFloat(v) ? 2 : typeof v === 'number' ? 1 : 3)
    },
    // op_power (0x8263, `^`): an int for two ints, else a float
    0x8263: function () {
        const exp = this.popRaw(), base = this.popRaw()
        const r = Math.fround(Math.pow(Number(unbox(base)) || 0, Number(unbox(exp)) || 0))
        this.push(!isVMFloat(base) && !isVMFloat(exp) && typeof base === 'number' && typeof exp === 'number' ? Math.trunc(r) | 0 : vmFloat(r))
    },
    // opRound (0x8267): to the nearest int, halves away from zero
    0x8267: function () {
        const f = Number(unbox(this.popRaw())) || 0
        let i = Math.trunc(f)
        const mod = f - i
        if (Math.abs(mod) >= 0.5) i += mod > 0 ? 1 : -1
        this.push(i | 0)
    },
    // op_div (0x827F): unsigned for two ints, a float division with a float; 0 on division by 0
    0x827f: function () {
        const divisor = this.popRaw(), dividend = this.popRaw()
        const d = Number(unbox(divisor)) || 0
        if ((d | 0) === 0 && !isVMFloat(divisor)) { this.push(0); return }
        if (isVMFloat(dividend) || isVMFloat(divisor)) this.push(vmFloat((Number(unbox(dividend)) || 0) / d))
        else this.push(Math.trunc((Number(dividend) >>> 0) / (d >>> 0)) | 0)
    },
    // CE opDivide: int / int truncates; with a float it is a float division
    0x803c: function () {
        checkDivisor(this, 'DIV')
        divide.call(this)
    },
}
const divide = arith((x, y) => x / y, (r) => r | 0)

// a procedure halted in gsay_end / gsay_message (ScriptVM.suspended)
interface Suspended {
    data: number // stack depths it was called at
    ret: number
    dvarBase: number
    dataFrame: any[] // its part of the stacks
    retFrame: number[]
}

export class ScriptVM {
    script: BinaryReader
    intfile: IntFile
    pc: number = 0
    dataStack: any[] = []
    retStack: number[] = []
    svarBase: number = 0
    dvarBase: number = 0
    halted: boolean = false
    aborted: boolean = false // the last run() stopped on a fatal error
    stopped: boolean = false // stop_program / exit / exec ended the last run(): its frame goes
    procEvents = new Map<number, ProcEvent>() // pending call_at / call_when by procedure index
    parent: ScriptVM | null = null // CE Program.parent / child (callstart, spawn, exec)
    child: ScriptVM | null = null
    // procedures halted inside gsay_end / gsay_message, innermost last; resume()
    // continues them. Each keeps its own stack frame (taken off the shared stacks
    // when it halted) and the depths it was called at: frame pointers are
    // absolute stack indices, so the frame goes back at the same depth.
    suspended: Suspended[] = []

    constructor(script: BinaryReader, intfile: IntFile) {
        this.script = script
        this.intfile = intfile
    }

    push(value: any): void {
        // CE programStackPushValue: more than 0x1000 values is a fatal error
        // (nimyrdor's use_skill_on_p_proc calls itself until it hits this)
        if (this.dataStack.length > 0x1000) throw new VMFatalError('programStackPushValue: Stack overflow.')
        this.dataStack.push(value)
    }

    // a value with its float box (arithmetic, stores)
    popRaw(): any {
        if (this.dataStack.length === 0) throw new VMFatalError('programStackPopValue: Stack underflow.')
        return this.dataStack.pop()
    }

    pop(): any {
        return unbox(this.popRaw())
    }

    popAddr(): any {
        if (this.retStack.length === 0) throw new VMFatalError('programReturnStackPopValue: Stack underflow.')
        return this.retStack.pop()
    }

    dis(): string {
        const offset = this.script.offset
        const disassembly = transpile(this.intfile, this.script)
        this.script.seek(offset)
        return disassembly
    }

    // CE interpreter.cc: a fatal error sets PROGRAM_FLAG_EXITED, and scripts.cc
    // scriptExecProc then skips every later proc of the script until it is loaded again
    dead = false

    // call a named procedure
    call(procName: string, args: any[] = []): any {
        if (this.dead) return 0
        const proc = this.intfile.procedures[procName]
        // console.log("CALL " + procName + " @ " + proc.offset + " from " + this.scriptObj.scriptName)
        if (!proc) throw new Error('ScriptVM: unknown procedure ' + procName)
        if ((proc.flags & PROC_IMPORTED) !== 0) {
            // CE _executeProcedure: an imported procedure runs in the program that exported
            // it (externalProcedureGetProgram), and only without arguments
            const ext = externalProcedures.get(procName.toLowerCase())
            if (!ext || ext.vm.dead) { dbgWarn('script', `External procedure ${procName} not found`); return 0 }
            if (ext.argc !== 0) { dbgWarn('script', 'External procedure cannot take arguments in interrupt context'); return 0 }
            return ext.vm.call(ext.name)
        }
        const dataDepth = this.dataStack.length
        const retDepth = this.retStack.length
        // a call can come while this VM is running: an intrinsic of the running
        // procedure (game_time_advance firing this script's timed event) calls
        // back into it. CE _executeProcedure saves and restores the interpreter's
        // position around the nested run; so does this, or the outer procedure
        // would stop at the nested one's end (halted) or go on at its pc.
        const outer = { pc: this.pc, offset: this.script.offset, halted: this.halted, aborted: this.aborted, stopped: this.stopped, dvarBase: this.dvarBase }
        try {
            // CE interpreter.cc _executeProcedure → _setupCallWithReturnVal: the
            // program's flags, checkWaitFunc and windowId (0, null, 0 for a game
            // script; programCreateByPath zeroes the Program) under the frame, popped
            // by the exit stub after the procedure returns. A procedure never
            // touches them unless it is broken: mitoilet's description_p_proc
            // compiles set_local_var without the variable number and takes the
            // windowId, 0 — its LVAR_Examined, as the source meant.
            this.push(0)
            this.push(0)
            this.push(0)
            // arguments first to last, then their count: a procedure's `fetch 0` is
            // its first argument (CE opCall / opPushBase)
            args.forEach((arg) => this.push(arg))
            this.push(args.length)

            this.retStack.push(-1) // push return address (TODO: how is this handled?)

            // run procedure code
            this.pc = proc.offset
            this.run()

            if (this.aborted || this.stopped) {
                // CE: the longjmp drops the procedure's frame; the caller sees 0 (and a
                // stopped / exited program is left where it stopped)
                this.dataStack.length = dataDepth
                this.retStack.length = retDepth
                return 0
            }
            if (this.retStack.length > retDepth) {
                // halted in gsay_end / gsay_message, not returned: its frame waits
                // for resume() (popping a "return value" here would eat a local).
                // It comes off the shared stacks: a procedure that halts in a
                // nested call (Den's Sheila: Node996's game_time_advance fires her
                // timed event, which opens the after-scene dialogue) must not leave
                // its frame under the outer procedure, which goes on running. (CE runs
                // the dialogue inside gsay_end, game_dialog.cc gameDialogEnter, so
                // there every nested run ends before the outer one continues.)
                this.suspended.push({
                    data: dataDepth, ret: retDepth, dvarBase: this.dvarBase,
                    dataFrame: this.dataStack.splice(dataDepth), retFrame: this.retStack.splice(retDepth),
                })
                return 0
            }
            const result = this.pop()
            // the exit stub's pop of the three call words (CE opPopFlags…); mitoilet
            // used one of them, which CE reports as a stack underflow after the
            // procedure has done its work
            this.dataStack.length = dataDepth
            return result
        } finally {
            this.pc = outer.pc
            this.script.seek(outer.offset)
            this.halted = outer.halted
            this.aborted = outer.aborted
            this.stopped = outer.stopped
            this.dvarBase = outer.dvarBase
        }
    }

    /** The dialogue is over: continue the suspended procedures, innermost
     *  first, as CE does (the dialogue runs inside gsay_end, which then
     *  returns). One that halts again (another gsay_message) waits for the
     *  next resume(). */
    // onlyOne: continue just the innermost suspended procedure (a gsay_message [Done]
    // returns into it, CE _gdialogSayMessage); the others keep waiting.
    resume(onlyOne = false): void {
        const outer = { pc: this.pc, offset: this.script.offset, halted: this.halted, aborted: this.aborted, stopped: this.stopped, dvarBase: this.dvarBase }
        try {
            while (this.suspended.length > 0) {
                const s = this.suspended.pop()!
                // put the frame back at the depth it was called at: set aside what
                // is above that depth now, fill up to it if the stacks are lower
                const aboveData = this.dataStack.splice(s.data)
                const aboveRet = this.retStack.splice(s.ret)
                const dataLen = this.dataStack.length
                const retLen = this.retStack.length
                while (this.dataStack.length < s.data) this.dataStack.push(0)
                while (this.retStack.length < s.ret) this.retStack.push(-1)
                this.dataStack.push(...s.dataFrame)
                this.retStack.push(...s.retFrame)
                this.dvarBase = s.dvarBase
                this.pc = this.popAddr()
                this.run()
                let halted = false
                if (!this.aborted && this.retStack.length > s.ret) {
                    // halted again (another gsay_message): wait for the next resume()
                    s.dvarBase = this.dvarBase
                    s.dataFrame = this.dataStack.splice(s.data)
                    s.retFrame = this.retStack.splice(s.ret)
                    this.suspended.push(s)
                    halted = true
                }
                // returned (its return value is dropped), aborted or halted again:
                // the stacks go back to what they were
                this.dataStack.length = dataLen
                this.retStack.length = retLen
                this.dataStack.push(...aboveData)
                this.retStack.push(...aboveRet)
                if (halted || onlyOne) return
            }
        } finally {
            this.pc = outer.pc
            this.script.seek(outer.offset)
            this.halted = outer.halted
            this.aborted = outer.aborted
            this.stopped = outer.stopped
            this.dvarBase = outer.dvarBase
        }
    }

    step(): boolean {
        if (this.halted) return false

        // fetch op
        const pc = this.pc
        this.script.seek(pc)
        const opcode = this.script.read16()

        // dispatch based on opMap
        if (opMap[opcode] !== undefined) opMap[opcode].call(this)
        else {
            // CE interpreter.cc: an unregistered opcode is programFatalError("Undefined
            // opcode") — the procedure ends (not a halt the dialogue code would resume)
            if (Config.engine.doDisasmOnUnimplOp) {
                dbg('script', 'disassembly:')
                dbg('script', transpile(this.intfile, this.script))
            }
            throw new VMFatalError(`Undefined opcode ${opcode.toString(16)} (pc=${this.pc.toString(16)}) in ${this.intfile.name}`)
        }

        // CE programReturnStackPushValue has the same 0x1000 limit; the opcodes
        // push return addresses directly, so it is checked here
        if (this.retStack.length > 0x1001) throw new VMFatalError('programReturnStackPushValue: Stack overflow.')

        if (this.pc === pc)
            // PC wasn't explicitly set, let's advance it to the current file offset
            this.pc = this.script.offset
        return true
    }

    /** Run the code at `offset` to its exit and give the value it leaves (CE _doEvents
     *  on a call_when condition), the VM's state kept; undefined on a fatal error. */
    evalAt(offset: number): any {
        const outer = { pc: this.pc, offset: this.script.offset, halted: this.halted, aborted: this.aborted, stopped: this.stopped, dvarBase: this.dvarBase }
        const dataDepth = this.dataStack.length
        const retDepth = this.retStack.length
        try {
            this.retStack.push(-1)
            this.pc = offset
            this.halted = false
            let steps = 0
            while (this.step()) {
                if (++steps > 1000000) throw new VMFatalError('call_when condition did not finish')
            }
            return this.dataStack.length > dataDepth ? this.pop() : 0
        } catch (e) {
            dbgWarn('script', 'call_when condition in %s: %o', this.intfile.name, e)
            return undefined
        } finally {
            this.dataStack.length = dataDepth
            this.retStack.length = retDepth
            this.pc = outer.pc
            this.script.seek(outer.offset)
            this.halted = outer.halted
            this.aborted = outer.aborted
            this.stopped = outer.stopped
            this.dvarBase = outer.dvarBase
        }
    }

    run(): void {
        this.halted = false
        this.aborted = false
        this.stopped = false
        try {
            while (this.step()) {}
        } catch (e) {
            // CE programFatalError longjmps out of the running procedure only. Any other
            // exception (an intrinsic's edge case, a broken mod script) ends the
            // procedure the same way instead of escaping into the game loop.
            if (!(e instanceof VMFatalError)) {
                dbgWarn('script', 'script error in %s at pc %s: %o', this.intfile.name, this.pc.toString(16), e)
            }
            const text = `${this.intfile.name}: ${e instanceof Error ? e.message : String(e)}`
            dbgWarn('script', 'fatal script error: %s', text)
            this.aborted = true
            this.halted = true
            this.dead = true
            if (fatalHook) fatalHook(text)
        }
    }
}
