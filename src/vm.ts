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
        var rhs = this.pop()
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

export const opMap: { [opcode: number]: (this: ScriptVM) => void } = {
    0x8002: function () {}, // start critical (nop)
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
        var argc = this.pop()
        this.retStack.push(this.dvarBase)
        this.dvarBase = this.dataStack.length - argc
        // console.log("op_push_base (argc %d)", argc)
    },
    0x8019: function () {
        // op_swapa
        var a = this.popAddr()
        var b = this.popAddr()
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
        var num = this.pop()
        this.dataStack[this.svarBase + num] = this.popRaw()
    }, // op_store_global
    0x8012: function () {
        var num = this.pop()
        this.push(this.dataStack[this.svarBase + num])
    }, // op_fetch_global
    0x801c: function () {
        // op_pop_return
        var addr = this.popAddr()
        if (addr === -1) this.halted = true
        else this.pc = addr
    },
    0x8010: function () {
        this.halted = true /*console.log("op_exit_prog")*/
    }, // op_exit_prog

    0x802f: function () {
        if (!this.pop()) {
            this.pc = this.pop()
        } else this.pop()
    }, // op_if
    0x8031: function () {
        var varNum = this.pop()
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
        // op_while
        var cond = this.pop()
        if (!cond) {
            var pc = this.pop()
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
        var argc = this.pop()
        var procIdx = this.pop()
        var proc = this.intfile.proceduresTable[procIdx]
        dbg('script', 'CHECK ARGS: argc=%d procIdx=%d, proc=%o', argc, procIdx, proc)
        // CE opCheckProcedureArgumentCount → programFatalError
        if (argc !== proc.argc) throw new VMFatalError(`Wrong number of args to procedure ${proc.name}: expected ${proc.argc}, got ${argc}`)
    },

    //,0x806B: function() { console.log("DISPLAY: %s", this.pop()) }

    0x8005: function () {
        // op_call (TODO: verify)
        // the script should have already pushed the return value (and possibly argc)
        this.pc = this.intfile.proceduresTable[this.pop()].offset
    },
    0x9001: function () {
        // push a string from either the strings or identifiers table.
        // normally Fallout 2 checks the type of the operand per-instruction
        // and treats the actual operand however it wants. in this case,
        // it will either be treated like a string, or an identifier.
        //
        // we just check the next instruction and match it up with the set of
        // instructions who use it as an identifier (whom use interpretGetName).

        var num = this.script.read32()
        var nextOpcode = this.script.peek16()

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
    0x8033: binop(function (x, y) {
        return +(x == y)
    }),
    0x8034: binop(function (x, y) {
        return +(x != y)
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
    0x8039: arith((x, y) => x + y),
    0x803a: arith((x, y) => x - y),
    0x803b: arith((x, y) => x * y),
    0x803d: function () {
        checkDivisor(this, 'MOD')
        modulo.call(this)
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
const modulo = binop((x, y) => x % y)
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
        var offset = this.script.offset
        var disassembly = transpile(this.intfile, this.script)
        this.script.seek(offset)
        return disassembly
    }

    // CE interpreter.cc: a fatal error sets PROGRAM_FLAG_EXITED, and scripts.cc
    // scriptExecProc then skips every later proc of the script until it is loaded again
    dead = false

    // call a named procedure
    call(procName: string, args: any[] = []): any {
        if (this.dead) return 0
        var proc = this.intfile.procedures[procName]
        // console.log("CALL " + procName + " @ " + proc.offset + " from " + this.scriptObj.scriptName)
        if (!proc) throw 'ScriptVM: unknown procedure ' + procName
        const dataDepth = this.dataStack.length
        const retDepth = this.retStack.length
        // a call can come while this VM is running: an intrinsic of the running
        // procedure (game_time_advance firing this script's timed event) calls
        // back into it. CE _executeProcedure saves and restores the interpreter's
        // position around the nested run; so does this, or the outer procedure
        // would stop at the nested one's end (halted) or go on at its pc.
        const outer = { pc: this.pc, offset: this.script.offset, halted: this.halted, aborted: this.aborted, dvarBase: this.dvarBase }
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

            if (this.aborted) {
                // CE: the longjmp drops the procedure's frame; the caller sees 0
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
        const outer = { pc: this.pc, offset: this.script.offset, halted: this.halted, aborted: this.aborted, dvarBase: this.dvarBase }
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
            this.dvarBase = outer.dvarBase
        }
    }

    step(): boolean {
        if (this.halted) return false

        // fetch op
        var pc = this.pc
        this.script.seek(pc)
        var opcode = this.script.read16()

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

    run(): void {
        this.halted = false
        this.aborted = false
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
