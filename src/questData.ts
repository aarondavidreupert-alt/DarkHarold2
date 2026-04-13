// Quest definitions derived from fallout2-ce data/quests.txt and quests.msg.
// Format matches the original: location msg ID, description msg ID, GVAR
// index, display threshold, completed threshold.
//
// Since quests.msg is not bundled with DarkHarold2 we inline the quest
// description strings directly (taken from the comment annotations in
// the canonical quests.txt and cross-referenced with fallout2-ce).

export interface QuestDef {
    location: string
    locationId: number
    descMsgId: number
    description: string
    gvarIndex: number
    displayThreshold: number
    completedThreshold: number
}

const LOCATIONS: Record<number, string> = {
    1500: 'Arroyo',
    1501: 'The Den',
    1502: 'Klamath',
    1503: 'Modoc',
    1504: 'Vault City',
    1505: 'Gecko',
    1506: 'Broken Hills',
    1507: 'New Reno',
    1508: 'Sierra Army Depot',
    1509: 'Vault 15',
    1510: 'New California Republic',
    1511: 'Vault 13',
    1512: 'Military Base',
    1513: 'Redding',
    1514: 'San Francisco',
    1515: 'Navarro',
    1516: 'The Enclave',
}

// Raw quest table: [locationId, descMsgId, gvarIndex, displayThreshold, completedThreshold, description]
type RawQuest = [number, number, number, number, number, string]

const RAW_QUESTS: RawQuest[] = [
    // --- Arroyo ---
    [1500, 100,   9, 2, 6, 'Kill the evil plants that infest Hakunin\'s garden.'],
    [1500, 110, 183, 1, 3, 'Fix the well for Feargus.'],
    [1500, 120, 191, 1, 3, 'Rescue Nagor\'s dog, Smoke, from the wilds.'],
    [1500, 130, 480, 0, 1, 'Return the GECK to Arroyo.'],
    [1500, 140, 619, 1, 2, 'Find Vic the Trader.'],

    // --- The Den ---
    [1501, 200, 100, 1, 2, 'Free Vic from his debt by paying Metzger.'],
    [1501, 201, 101, 1, 2, 'Get info about Becky\'s still from Frankie.'],
    [1501, 202, 101, 2, 3, 'Sabotage Becky\'s still.'],
    [1501, 203, 550, 1, 2, 'Get car part for Smitty.'],
    [1501, 204, 551, 1, 2, 'Return Anna\'s locket.'],
    [1501, 205, 371, 1, 2, 'Collect money from Fred.'],
    [1501, 206, 371, 3, 4, 'Get book from Derek.'],
    [1501, 207, 450, 1, 2, 'Deliver meal to Smitty.'],
    [1501, 208, 454, 1, 2, 'Investigate the "Church" in the Den.'],
    [1501, 209, 454, 2, 3, 'Get permission from Metzger for a gang.'],
    [1501, 210, 454, 4, 5, 'Find a weakness in the slaver\'s defenses.'],
    [1501, 211, 454, 6, 7, 'Help Lara attack Tyler\'s gang.'],

    // --- Klamath ---
    [1502, 300, 198, 1, 3, 'Refuel the still.'],
    [1502, 301, 197, 1, 2, 'Rescue Smiley the Trapper.'],
    [1502, 302, 182, 1, 2, 'Guard the brahmin.'],
    [1502, 303, 102, 1, 2, 'Rustle the brahmin.'],
    [1502, 304, 390, 1, 2, 'Kill the rat god.'],
    [1502, 305, 391, 1, 2, 'Rescue Torr.'],

    // --- Modoc ---
    [1503, 400, 631, 1, 2, 'Investigate the Ghost Farm.'],
    [1503, 401, 105, 4, 7, 'Cornelius has lost his gold watch. Find it and return it to him.'],
    [1503, 402, 106, 4, 7, 'Farrel wants you to find Cornelius\'s gold watch.'],
    [1503, 403, 693, 1, 2, 'Jonny is missing. Find him and bring him home to Balthas.'],
    [1503, 404, 693, 3, 4, 'Jonny\'s in the Slag caves. Convince him to come home.'],
    [1503, 405, 110, 4, 7, 'Deliver Slag message to Jo in Modoc.'],
    [1503, 406, 631, 2, 3, 'Deliver a message to the Slags.'],
    [1503, 407, 631, 4, 5, 'Find Karl, or find out what happened to him.'],
    [1503, 408, 631, 5, 6, 'Send Karl on his way back to Modoc.'],
    [1503, 409, 107, 4, 7, 'Guard the brahmin for Grisham.'],

    // --- Vault City ---
    [1504, 500,  80, 3, 6, 'Get a plow for Mr. Smith.'],
    [1504, 501, 321, 1, 2, 'Deliver Moore\'s briefcase to Mr. Bishop in New Reno.'],
    [1504, 502,  85, 2, 3, 'Get a sample of Jet for Dr. Troy.'],
    [1504, 503,  82, 2, 8, 'Solve the Gecko powerplant problem.'],
    [1504, 504,  89, 1, 3, 'Deliver Lynette\'s holodisk to Westin in NCR.'],
    [1504, 505, 459, 1, 2, 'Rescue Amanda\'s husband, Joshua.'],
    [1504, 506, 497, 1, 2, 'Deliver alcohol and booze to Lydia.'],
    [1504, 507, 493, 1, 2, 'Get the tools from Valerie.'],
    [1504, 508, 529, 1, 2, 'Scout the area around Gecko for Stark.'],
    [1504, 509, 529, 3, 4, 'Scout the area around NCR for Stark.'],
    [1504, 510, 142, 1, 2, 'Solve the problem with the Vault City village.'],
    [1504, 511, 143, 1, 3, 'Get weapons for the Vault City village.'],

    // --- Gecko ---
    [1505, 600,  82, 1, 8, 'Solve the Gecko powerplant problem.'],
    [1505, 601, 396, 1, 2, 'Repair the powerplant.'],
    [1505, 602, 397, 1, 2, 'Optimize the powerplant.'],
    [1505, 603, 158, 1, 3, 'Give the economy disk to McClure in Vault City.'],
    [1505, 604, 393, 1, 2, 'Get the super repair kit for Skeeter.'],
    [1505, 605, 160, 1, 2, 'Get the 3-step plasma transformer for Jeremy.'],
    [1505, 606, 616, 1, 3, 'Find Woody the ghoul.'],

    // --- Broken Hills ---
    [1506, 700, 300, 1, 6, 'Chad is skimming money from the mine. Find evidence.'],
    [1506, 701, 302, 3, 7, 'Fix the mine\'s air purifier.'],
    [1506, 702, 305, 2, 9, 'Find the missing people for Marcus.'],
    [1506, 703, 306, 2, 5, 'Beat Francis at arm-wrestling.'],
    [1506, 704, 303, 3, 4, 'Break Manson and Franc out of jail.'],
    [1506, 705, 304, 4, 5, 'Blow up the mine\'s air purifier.'],
    [1506, 706, 542, 3, 6, 'Fix the power supply for Eric.'],

    // --- New Reno ---
    [1507, 800, 348, 1, 2, 'Recover your stolen car.'],
    [1507, 801, 286, 1, 2, 'Find out who was responsible for Richard Wright\'s overdose.'],
    [1507, 806, 343, 1, 2, 'Help crack the Sierra Army Base.'],
    [1507, 807, 312, 2, 4, 'Track down Pretty Boy Lloyd, recover the stolen money.'],
    [1507, 808, 316, 1, 3, 'Collect tribute from the Corsican Brothers for Salvatore.'],
    [1507, 809, 313, 2, 3, 'Attend the secret transaction at the desert.'],
    [1507, 810, 370, 3, 4, 'Find a cure for Jet.'],
    [1507, 811, 346, 1, 2, 'Help the Wrights with their decadence problem.'],
    [1507, 812, 547, 1, 2, 'Assassinate Westin in NCR for Bishop.'],
    [1507, 813, 548, 1, 2, 'Murder Carlson in NCR for Bishop.'],
    [1507, 814, 501, 1, 2, 'Collect Cat\'s Paw magazines for Miss Kitty.'],
    [1507, 815, 549, 1, 2, 'Find a laser pistol for Eldridge.'],
    [1507, 816, 354, 1, 2, 'Deliver package to Ramirez at the Stables.'],
    [1507, 817, 355, 1, 3, 'Collect tribute from Renesco for the Salvatores.'],
    [1507, 818, 356, 1, 2, 'Assassinate Boss Salvatore for Big Jesus Mordino.'],

    // --- Vault 15 ---
    [1509, 3200, 473, 1, 2, 'Rescue Chrissy.'],
    [1509, 3201, 474, 1, 2, 'Kill Darion.'],
    [1509, 3202, 475, 1, 2, 'Complete the deal with NCR.'],
    [1509, 3203, 476, 1, 2, 'Discover the NCR spy.'],

    // --- New California Republic ---
    [1510, 1100, 169, 1, 2, 'Retrieve parts/gain access to Vault 15 for Tandi.'],
    [1510, 1101, 217, 3, 5, 'Take care of Officer Jack for Mira.'],
    [1510, 1102, 481, 1, 2, 'Complete the Brahmin Drive from Redding to NCR.'],
    [1510, 1103, 482, 1, 2, 'Retrieve the papers from Dr. Henry.'],
    [1510, 1104, 237, 1, 2, 'Test mutagenic serum on a super-mutant for Dr. Henry.'],
    [1510, 1105, 483, 1, 2, 'Eliminate Mr. Bishop for NCR.'],
    [1510, 1106, 484, 1, 2, 'Deliver holodisk to Lynette in Vault City.'],
    [1510, 1107, 195, 1, 2, 'Retrieve the Ranger\'s map for Vortis.'],
    [1510, 1108, 502, 1, 2, 'Free the slaves to become a Ranger.'],
    [1510, 1109, 485, 1, 2, 'Deliver the Hubologist\'s field report to San Francisco.'],
    [1510, 1110, 486, 1, 3, 'Kill the Hubologist in NCR for Merk.'],
    [1510, 1111, 500, 1, 2, 'Stop the brahmin raids.'],
    [1510, 1112, 195, 3, 4, 'Wipe out the Ranger safe houses.'],

    // --- Vault 13 ---
    [1511, 1200, 487, 1, 2, 'Fix the Vault 13 computer.'],
    [1511, 1201, 488, 1, 2, 'Talk to Goris.'],

    // --- Redding ---
    [1513, 1398, 703, 1, 2, 'Clear out the Wanamingo mine.'],
    [1513, 1399, 332, 1, 2, 'Find the excavator chip.'],
    [1513, 1400, 702, 1, 2, 'Help Widow Rooney.'],
    [1513, 1401, 380, 1, 2, 'Break up the bar brawl at the Malamute.'],
    [1513, 1402, 292, 1, 2, 'Cut the whore\'s take at the Malamute.'],
    [1513, 1403, 385, 1, 3, 'Kill Frog Morton.'],

    // --- San Francisco ---
    [1514, 1500, 532, 1, 2, 'The Shi need fuel for the tanker.'],
    [1514, 1501, 533, 1, 2, 'The Hubologists need fuel for the tanker.'],
    [1514, 1502, 534, 1, 2, 'Get the vertibird plans for the Shi.'],
    [1514, 1503, 559, 1, 2, 'Kill the Emperor.'],
    [1514, 1504, 561, 1, 2, 'Get the vertibird plans from Navarro for the Hubologists.'],
    [1514, 1505, 557, 1, 2, 'Steal the vertibird plans for the Hubologists from the Shi.'],
    [1514, 1506, 535, 1, 2, 'The tanker needs fuel.'],
    [1514, 1507, 366, 32, 64, 'The navigation computer needs the NavCom parts.'],
    [1514, 1508, 555, 1, 2, 'Kill Badger so the Tanker vagrants will embrace the Hub.'],
    [1514, 1509, 560, 1, 2, 'Get the vertibird plans from Navarro for the Shi.'],
    [1514, 1510, 558, 1, 2, 'Steal the vertibird plans from the Hubologists for the Shi.'],
    [1514, 1511, 536, 1, 2, 'The Elronologist needs to be rescued from the Hubologists.'],
    [1514, 1512, 538, 1, 2, 'The Dragon wants you to take out Lo Pan.'],
    [1514, 1513, 537, 1, 2, 'Lo Pan wants you to take out the Dragon.'],
    [1514, 1514, 367, 1, 7, 'Ring fights for Dragon or Lo Pan.'],
    [1514, 1515, 539, 1, 2, 'Get the vertibird plans for the Brotherhood of Steel.'],
    [1514, 1516, 565, 1, 4, 'Get the vertibird plans for the Brotherhood of Steel.'],
    [1514, 1517, 362, 1, 5, 'Disable the Shi Emperor\'s computer.'],

    // --- Navarro ---
    [1515, 1600, 554, 1, 2, 'Deal with the deathclaw.'],
    [1515, 1601, 513, 1, 3, 'Fix K-9.'],
    [1515, 1602, 512, 1, 2, 'Retrieve the FOB from the base commander.'],
]

export const questDefs: QuestDef[] = RAW_QUESTS.map(([locationId, descMsgId, gvarIndex, displayThreshold, completedThreshold, description]) => ({
    location: LOCATIONS[locationId] ?? `Location ${locationId}`,
    locationId,
    descMsgId,
    description,
    gvarIndex,
    displayThreshold,
    completedThreshold,
}))

// Set of all GVAR indices used by quest definitions, for the debug
// "unknown active GVARs" section.
export const questGvarSet = new Set(questDefs.map(q => q.gvarIndex))
