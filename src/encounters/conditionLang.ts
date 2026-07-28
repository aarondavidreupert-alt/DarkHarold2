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

// Encounter-condition mini-language: tokenizer, parser, AST, evaluator.
// Split out of encounters.ts. See wiki/ts-split-refactor.md →
// "Per-file split proposals" §20.

import globalState from "../globalState.js"
import { Scripting } from "../scripting.js"
import { getRandomInt } from "../util.js"
import { dbg } from "../logger.js"
import { getHourMilitary, getTotalDays } from "../gametime.js"

enum Tok {
    IF = 0,
    LPAREN = 1,
    RPAREN = 2,
    IDENT = 3,
    OP = 4,
    INT = 5
}

type Token = [Tok, string /* Matched text */, number /* length (or number value for Tok.INT tokens) */];

interface IfNode { type: "if", cond: Node }
interface OpNode { type: "op", op: string, lhs: Node, rhs: Node }
interface CallNode { type: "call", name: string, arg: Node }
interface VarNode { type: "var", name: string }
interface IntNode { type: "int", value: number }

export type Node = IfNode | OpNode | CallNode | VarNode | IntNode;

function tokenizeCond(data: string): Token[] {
    var tokensRe: { [re: string]: number } = {
        "if": Tok.IF,
        "and": Tok.OP,
        "[a-z_]+": Tok.IDENT,
        "-?[0-9]+": Tok.INT,
        "[><=&]+": Tok.OP,
        "\\(": Tok.LPAREN,
        "\\)": Tok.RPAREN,
    }

    function match(str: string): Token|null {
        for(var re in tokensRe) {
            var m = str.match(new RegExp("^\\s*(" + re + ")\\s*"))
            if(m !== null)
                return [tokensRe[re], m[1], m[0].length]
        }
        return null
    }

    var acc = data
    var toks: Token[] = []
    while(acc.length > 0) {
        var m = match(acc)
        if(m === null)
            throw "error parsing condition: '" + data + "': choked on '" + acc + "'"
        toks.push(m[0] === Tok.INT ? [Tok.INT, m[1], parseInt(m[1])] : m)
        acc = acc.slice(m[2])
    }

    return toks
}

function parseCond(data: string) {
    data = data.replace("%", "") // percentages don't really matter
    var tokens = tokenizeCond(data)
    var curTok = 0

    function expect(t: Tok) {
        if(tokens[curTok++][0] !== t)
            throw "expect: expected " + t + ", got " + tokens[curTok-1] +
                  ", input: " + data
    }

    function next() {
        return tokens[curTok++]
    }

    function peek() {
        if(curTok >= tokens.length)
            return null
        return tokens[curTok]
    }

    function call(name: string): Node {
        expect(Tok.LPAREN)
        var arg = expr()
        expect(Tok.RPAREN)
        return {type: 'call', name, arg}
    }

    function checkOp(node: Node): Node {
        var t = peek()
        if(t === null || t[0] !== Tok.OP)
            return node

        curTok++
        var rhs = checkOp(expr())
        return {type: 'op', op: t[1], lhs: node, rhs: rhs}
    }

    function expr(): Node {
        var t = next()
        switch(t[0]) {
            case Tok.IF:
                expect(Tok.LPAREN)
                var cond = expr()
                expect(Tok.RPAREN)
                return checkOp({type: 'if', cond: cond})
            case Tok.IDENT:
                if(peek()![0] === Tok.LPAREN)
                    return checkOp(call(t[1]))
                return checkOp({type: 'var', name: t[1]})
            case Tok.INT:
                return checkOp({type: 'int', value: t[2]})
            default:
                throw "unhandled/unexpected token: " + t + " in: " + data
        }
    }

    return expr()
}

export function parseConds(data: string) {
    // conditions are formed by conjunctions, so
    // x AND y AND z can just be collapsed to [x, y, z] here

    var cond = parseCond(data)
    var out: Node[] = []

    function visit(node: Node) {
        if(node.type === "op" && node.op === "and") {
            visit(node.lhs)
            visit(node.rhs)
        }
        else
            out.push(node)
    }

    visit(cond)
    return out
}

export function printTree(node: Node, s: string) {
    switch(node.type) {
        case "if":
            dbg('encounters', s + "if")
            printTree(node.cond, s + "  ")
            break
        case "op":
            dbg('encounters', s + "op " + node.op + "")
            printTree(node.lhs, s + "  ")
            printTree(node.rhs, s + "  ")
            break
        case "call":
            dbg('encounters', s + "call " + node.name + "")
            printTree(node.arg, s + "  ")
            break
        case "var":
            dbg('encounters', s + "var " + node.name)
            break
        case "int":
            dbg('encounters', s + "int " + node.value)
            break
    }
}

// evaluates conditions against game state
// critterCount: total critter count for this encounter group (for enctr(num_critters))
function evalCond(node: Node, critterCount?: number): number|boolean {
    switch(node.type) {
        case "if": // condition
            return evalCond(node.cond, critterCount)
        case "call": // call (more like a property access)
            switch(node.name) {
                case "global": // GVAR
                    if(node.arg.type !== "int") throw "evalCond: GVAR not a number";
                    return Scripting.getGlobalVar(node.arg.value)
                case "player":
                    if(node.arg.type !== "var") throw "evalCond: player arg not a var";
                    if(node.arg.name !== "level")
                        throw "player( " + node.arg.name + ")"
                    return globalState.player?.getStat('Level') ?? 1
                case "rand": // random percentage
                    if(node.arg.type !== "int") throw "evalCond: rand arg not a number";
                    return getRandomInt(0, 100) <= node.arg.value
                case "enctr":
                    // CE ref: worldmap.cc wmEvalConditional ENCOUNTER_CONDITION_TYPE_NUMBER_OF_CRITTERS
                    // enctr(num_critters) — critter count for the current encounter group
                    if(node.arg.type !== "var" || node.arg.name !== "num_critters")
                        throw "evalCond: enctr arg must be num_critters"
                    return critterCount ?? 0
                default: throw "unhandled call: " + node.name
            }
        case "var":
            switch(node.name) {
                case "time_of_day":
                    // CE ref: worldmap.cc wmEvalConditional ENCOUNTER_CONDITION_TYPE_TIME_OF_DAY
                    // gameTimeGetHour() / 100 → 24h hour (0-23)
                    return Math.floor(getHourMilitary() / 100)
                case "days_played":
                    // CE ref: worldmap.cc wmEvalConditional ENCOUNTER_CONDITION_TYPE_DAYS_PLAYED
                    // gameTimeGetTime() / GAME_TIME_TICKS_PER_DAY
                    return getTotalDays()
                default: throw "unhandled var: " + node.name
            }
        case "int": return node.value
        case "op": {
            const lhs = evalCond(node.lhs, critterCount)
            const rhs = evalCond(node.rhs, critterCount)
            const op: { [op: string]: (l: boolean|number, r: boolean|number) => boolean|number } = {
                "<":   (l, r) => +l < +r,
                ">":   (l, r) => +l > +r,
                "<=":  (l, r) => +l <= +r,
                ">=":  (l, r) => +l >= +r,
                "==":  (l, r) => +l === +r,
                "!=":  (l, r) => +l !== +r,
                "and": (l, r) => (l as boolean) && (r as boolean),
                "or":  (l, r) => (l as boolean) || (r as boolean),
            }
            if(op[node.op] === undefined)
                throw "unhandled op: " + node.op
            return op[node.op](lhs, rhs)
        }
        default: throw "unhandled node: " + node
    }
}

export function evalConds(conds: Node[], critterCount?: number): boolean {
    // TODO: Array.every
    for(var i = 0; i < conds.length; i++) {
        if(evalCond(conds[i], critterCount) === false)
            return false
    }
    return true
}
