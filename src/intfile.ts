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

import { assertEq, BinaryReader } from "./util.js";

// Parser for .INT files

interface Procedure {
    nameIndex: number;
    name: string;
    offset: number;
    index: number;
    argc: number;
    flags: number; // CE PROCEDURE_FLAG_* (0x04 imported, 0x08 exported, 0x10 critical)
}

export interface IntFile {
    procedures: { [name: string]: Procedure };
    proceduresTable: Procedure[];
    identifiers: { [offset: number]: string };
    strings: { [offset: number]: string };
    codeOffset: number;
    name: string;
}

// parse .INT files
export function parseIntFile(reader: BinaryReader, name: string=""): IntFile {
    reader.seek(0x2A) // seek to procedure table

    // read procedure table
    const numProcs = reader.read32()
    const procs: Procedure[] = []
    const procedures: { [name: string]: Procedure } = {}

    for(let i = 0; i < numProcs; i++) {
        const nameIndex = reader.read32()
        const flags = reader.read32()
        assertEq(reader.read32(), 0, "unk0 != 0")
        assertEq(reader.read32(), 0, "unk1 != 0")
        let offset = reader.read32()
        const argc = reader.read32()

        procs.push({nameIndex: nameIndex
                   ,name: ""
                   ,offset: offset
                   ,index: i
                   ,argc: argc
                   ,flags: flags
                   })
    }

    // offset->identifier table
    const identEnd = reader.read32()
    const identifiers: { [offset: number]: string } = {}

    let baseOffset = reader.offset
    while(true) {
        if(reader.offset - baseOffset >= identEnd)
            break

        let len = reader.read16()
        let offset = reader.offset - baseOffset + 4
        let str = ""

        for(let j = 0; j < len; j++) {
            let c = reader.read8()
            if(c)
                str += String.fromCharCode(c)
        }

        identifiers[offset] = str
    }

    assertEq(reader.read32(), 0xFFFFFFFF, "did not get 0xFFFFFFFF signature")

    // give procedures their names from the identifier table
    procs.forEach(proc => proc.name = identifiers[proc.nameIndex])

    // and populate the procedures table
    procs.forEach(proc => procedures[proc.name] = proc)


    // offset->strings table
    const stringEnd = reader.read32()
    const strings: { [offset: number]: string } = {}

    if(stringEnd !== 0xFFFFFFFF) {
        // read string table
        let baseOffset = reader.offset
        while(true) {
            if(reader.offset - baseOffset >= stringEnd)
                break

            let len = reader.read16()
            let offset = reader.offset - baseOffset + 4
            let str = ""

            for(let j = 0; j < len; j++) {
                let c = reader.read8()
                if(c)
                    str += String.fromCharCode(c)
            }

            strings[offset] = str
        }
    }

    const codeOffset = reader.offset

    return {procedures: procedures
           ,proceduresTable: procs
           ,identifiers: identifiers
           ,strings: strings
           ,codeOffset: codeOffset
           ,name: name}
}