"""
Copyright 2026 DarkHarold2 contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
"""

# Static disassembler for compiled Fallout 2 .INT scripts (data/scripts/*.int),
# targeted at finding create_object_sid(pid, tile, elev, sid) call sites that
# place the Highwayman car body (PID 33555441 / 0x020003F1) or its trunk
# (PID 455). Used to extract ground-truth per-map parking tiles for
# lut/car_parking.json straight from the original developers' compiled
# scripts, instead of guessing/heuristic placement.
#
# Header/procedure-table format ported from src/intfile.ts. Opcode table
# ported from src/vm.ts + src/vm_bridge.ts (0xc001 = push literal int32,
# 0x9001 = push string/identifier by table offset — the only two opcodes
# that consume inline operand bytes; every other opcode, including all game
# intrinsics, is a bare 2-byte opcode whose arguments are already on the VM
# data stack from prior pushes). 0x80B7 = create_object_sid, argc=4, and
# DH2's bridged() calling convention preserves push order as declaration
# order: (pid, tile, elev, sid).
#
# METHODOLOGY NOTE (see wiki/car_system.md §7 for the full writeup): a first
# attempt at this tool used a general backward stack-effect scanner to find
# each call's 4 arguments, and produced ~254 hits, nearly all false
# positives. Fallout 2 scripts heavily reuse generic helper procedures (e.g.
# a shared "placeCritter"-style wrapper) whose pid/tile arguments are local
# variable fetches, not literals — the backward scanner misattributed
# unrelated, coincidentally-matching literals from earlier in the file as
# call arguments. This was caught by manually inspecting raw instruction
# dumps, not by trusting the tool. The fix implemented here is a strict
# pattern match: only 4 *consecutive* literal-push instructions immediately
# followed by the call, with zero intervening instructions, count as a hit.
# This unambiguously selects direct hardcoded calls and correctly excludes
# variable/computed-argument calls. Verified by hand against sfchina.int's
# real car placement before trusting it at scale.
#
# Usage:
#   python tools/extract_car_tiles.py [data/scripts] [--json out.json]

import sys
import os
import struct
import json
import argparse

PID_CAR = 33555441   # 0x020003F1 — PROTO_ID_CAR (proto_types.h:195)
PID_TRUNK = 455       # PROTO_ID_CAR_TRUNK (proto_types.h:184)

OP_PUSH_LITERAL = 0xC001   # op_push_d — push signed 32-bit literal
OP_PUSH_STRING = 0x9001    # push string/identifier by table offset
OP_CREATE_OBJECT_SID = 0x80B7  # create_object_sid(pid, tile, elev, sid)

INLINE_OPERAND_OPCODES = (OP_PUSH_LITERAL, OP_PUSH_STRING)


class BinaryReader:
    def __init__(self, data):
        self.data = data
        self.offset = 0
        self.length = len(data)

    def seek(self, offset):
        self.offset = offset

    def read8(self):
        v = self.data[self.offset]
        self.offset += 1
        return v

    def read16(self):
        v = struct.unpack_from(">H", self.data, self.offset)[0]
        self.offset += 2
        return v

    def read32(self):
        v = struct.unpack_from(">I", self.data, self.offset)[0]
        self.offset += 4
        return v

    def read32s(self):
        v = struct.unpack_from(">i", self.data, self.offset)[0]
        self.offset += 4
        return v


def parse_int_file(reader, name=""):
    # Ported from src/intfile.ts parseIntFile()
    reader.seek(0x2A)  # seek to procedure table

    num_procs = reader.read32()
    procs = []
    for _ in range(num_procs):
        name_index = reader.read32()
        reader.read32()  # flags
        assert reader.read32() == 0, "unk0 != 0"
        assert reader.read32() == 0, "unk1 != 0"
        offset = reader.read32()
        argc = reader.read32()
        procs.append({"nameIndex": name_index, "name": "", "offset": offset, "argc": argc})

    # offset -> identifier table
    ident_end = reader.read32()
    identifiers = {}
    base_offset = reader.offset
    while reader.offset - base_offset < ident_end:
        length = reader.read16()
        offset = reader.offset - base_offset + 4
        chars = []
        for _ in range(length):
            c = reader.read8()
            if c:
                chars.append(chr(c))
        identifiers[offset] = "".join(chars)

    sig = reader.read32()
    if sig != 0xFFFFFFFF:
        raise ValueError(f"{name}: bad identifier-table signature")

    for p in procs:
        p["name"] = identifiers.get(p["nameIndex"], "")

    proc_offsets = {p["offset"]: p["name"] for p in procs}

    # offset -> string table (unused by this tool, but parsed to keep the
    # cursor correctly positioned at codeOffset)
    string_end = reader.read32()
    if string_end != 0xFFFFFFFF:
        base_offset = reader.offset
        while reader.offset - base_offset < string_end:
            length = reader.read16()
            reader.offset += length

    code_offset = reader.offset
    return {"procOffsets": proc_offsets, "codeOffset": code_offset}


def decode_instructions(reader, code_offset):
    reader.seek(code_offset)
    instrs = []
    while reader.offset < reader.length - 1:
        off = reader.offset
        opcode = reader.read16()
        operand = None
        if opcode in INLINE_OPERAND_OPCODES:
            operand = reader.read32s()
        instrs.append((off, opcode, operand))
    return instrs


def scan_file(path):
    with open(path, "rb") as f:
        data = f.read()
    reader = BinaryReader(data)
    name = os.path.basename(path)
    intfile = parse_int_file(reader, name)
    instrs = decode_instructions(reader, intfile["codeOffset"])
    proc_offsets = intfile["procOffsets"]

    hits = []
    cur_proc = "?"
    proc_at = {}
    for off, _, _ in instrs:
        if off in proc_offsets:
            proc_at[off] = proc_offsets[off]

    for i in range(4, len(instrs)):
        off, opcode, _ = instrs[i]
        if off in proc_at:
            cur_proc = proc_at[off]
        if opcode != OP_CREATE_OBJECT_SID:
            continue
        window = instrs[i - 4:i]
        if not all(op == OP_PUSH_LITERAL for _, op, _ in window):
            continue  # not 4 direct literals — skip (likely a dynamic/reused-helper call)
        pid = window[0][2]
        if pid not in (PID_CAR, PID_TRUNK):
            continue
        hits.append({
            "file": name,
            "proc": cur_proc,
            "pid": pid,
            "pidLabel": "CAR" if pid == PID_CAR else "TRUNK",
            "tile": window[1][2],
            "elev": window[2][2],
            "sid": window[3][2],
            "offset": hex(off),
        })
    return hits


def main():
    parser = argparse.ArgumentParser(description="Extract Highwayman car/trunk placement tiles from compiled Fallout 2 scripts")
    parser.add_argument("scripts_dir", nargs="?", default="data/scripts", help="directory of .int files (default: data/scripts)")
    parser.add_argument("--json", dest="json_out", default=None, help="write raw hit list to this JSON file")
    args = parser.parse_args()

    files = sorted(f for f in os.listdir(args.scripts_dir) if f.endswith(".int"))
    all_hits = []
    for f in files:
        try:
            hits = scan_file(os.path.join(args.scripts_dir, f))
        except Exception as e:
            print(f"{f}: PARSE ERROR: {e}", file=sys.stderr)
            continue
        all_hits.extend(hits)

    print(f"Scanned {len(files)} .int files in {args.scripts_dir}")
    print(f"Found {len(all_hits)} direct-literal create_object_sid(CAR|TRUNK,...) call(s):\n")
    for h in all_hits:
        print(f"{h['file']} [{h['proc']}]: {h['pidLabel']} tile={h['tile']} elev={h['elev']} sid={h['sid']} @{h['offset']}")

    if args.json_out:
        with open(args.json_out, "w") as f:
            json.dump(all_hits, f, indent=2)
        print(f"\nWrote {len(all_hits)} hits to {args.json_out}")


if __name__ == "__main__":
    main()
