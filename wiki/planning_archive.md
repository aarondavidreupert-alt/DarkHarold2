# Planning notes archive

> The early planning documents that used to live in `docs/planning/` as Word files (removed
> 2026-10-27, cleanup_audit CA28), kept here as text. They describe the state and plans of
> spring 2026 and are **superseded** by `ROADMAP.md`, `wiki/known_bugs.md` and
> `wiki/code_quality.md`; nothing here is current. The originals are in git history
> (`git show b3564e41:"docs/planning/<name>.docx"`). A pasted chat log (`new 5.txt`, a floor-lighting
> debugging session) was dropped.

## DarkHarold2_Analyse

### DarkHarold2 – Technische Analyse

Projektübersicht und Implementierungsstand

### 1. Projektübersicht

DarkHarold2 ist eine moderne Re-Implementierung der Fallout 1/2-Engine im Browser, basierend auf dem archivierten Open-Source-Projekt darkf/darkfo (archiviert November 2020). Das Projekt nutzt TypeScript (Frontend/Engine) und Python (Asset-Konvertierung) und läuft vollständig im Browser.

#### Tech Stack

| Komponente | Technologie |
|---|---|
| Engine / Frontend | TypeScript |
| Asset-Konvertierung | Python |
| UI-Rendering | HTML/CSS + Canvas |
| Schriften | HTML-Fonts (statt nativer Bitmap-Fonts) |
| Basis-Repo | darkf/darkfo (GitHub, archiviert) |

### 2. Implementierungsstand – Überblick

#### ✅ Funktioniert

- Map-Loading (Karten werden korrekt geladen)
- NPC-Dialoge
- Einige Quests (über globalVars)
- Sound
- Skills: Schlösserknacken, Reparieren
- Inventar mit Drag & Drop und Loot-Screen
- Charakter-Screen (SPECIAL, Skills, Level, XP, HP)
- Turn-Reihenfolge und AP-System im Kampf
- Hit-Chance-Formel (korrekt nach F1/F2-Specs)
- Crit-Würfelmechanik und Crit-Level-Berechnung
- Critical-Fail-Tabellen für alle Waffentypen
- AI.TXT-Parsing, Flee/Creep/Attack-Verhalten
- criticalTables.json wird aus Datei geladen
#### ❌ Fehlt / Buggy

- PipBoy komplett fehlend (Map, Status-UI, Quests/Archives)
- Weltkarte – vorhanden aber buggy
- Rüstungs-System – keine echten Armor-Werte aus .pro-Dateien
- Ammo-System – hardcoded, kein Lookup
- Alle Critical-Effekte sind Stubs (console.log only)
- Combat-UI komplett fehlend
- Perks nicht implementiert
- Talking Heads fehlen (#110)
- GAM-Dateien nicht geparst – GVAR/MVAR defaulten auf 0 (#122)
- Saving/Loading – Alpha-Stadium
- Bitmap-Fonts nicht implementiert (HTML-Fonts statt native)
### 3. PipBoy – Vollständig fehlend

Der PipBoy in Fallout 1/2 besteht aus drei Tabs. Keiner davon ist in DarkHarold2 implementiert. Die README erwähnt nur "PipBoy map" als fehlend – das ist eine Untertreibung, da der gesamte PipBoy fehlt.

| Tab | Inhalt | Status in DarkHarold2 |
|---|---|---|
| STATUS | HP, Rads, Poison, Zeit | Daten vorhanden, kein PipBoy-UI |
| AUTOMAP | Lokale Karte | Komplett fehlend |
| ARCHIVES | Quests / Notizen | Kein Quest-System, kein UI |

#### Quest-System

globalVars existieren für Quest-Flags, aber es gibt kein strukturiertes Quest-Tracking-System. Funktionen wie addQuest(), completeQuest() fehlen vollständig. Quest-Zustände sind rohe globalVars-Nummern ohne lesbare Struktur.

#### GAM-Dateien (Issue #122)

GAM-Dateien liefern die initialen Werte für GVAR/MVAR. Da diese nicht geparst werden, defaulten alle Werte auf 0 – was zu falschen Quest-Zuständen führen kann. Dies ist kritisch für die korrekte Quest-Funktionalität.

### 4. Combat-System – ~50% fertig

Die Grundstruktur des Kampfsystems ist solide und korrekt nach F1/F2-Spezifikationen implementiert. Das zentrale Problem: Fast alle Effekte sind Stubs – die Logik existiert, tut aber nichts.

#### 4.1 Was funktioniert

| Feature | Details |
|---|---|
| Action Points | AP = 5 + floor(AGI/2), exakt wie F1/F2; Move-AP und Combat-AP getrennt |
| Hit Chance | Weapon Skill − AC − Distanz-Modifier − Region-Modifier; Cap bei 95% |
| Critical Hits | Crit-Chance, Crit-Level 0–5, Würfelmechanik korrekt |
| Critical Miss | Fail-Level 1–5 pro Waffentyp implementiert |
| Damage-Formel | (CM/2) * ammoDamageMult * (RD+RB) * (CD/100) − ADT, dann × (1 − ADR/100) |
| AI-System | AI.TXT wird geladen; Flee, Creep, Attack-Verhalten; Taunt-Messages |
| Crit-Tabellen | criticalTables.json für alle Critter-Typen und Regionen geladen |
| Crit-Fail-Tabellen | Alle Waffentypen: unarmed, melee, firearms, energy, grenades, rocket, flamers |

#### 4.2 Critical Effects – Alle Stubs

criticalEffects.ts ist architektonisch komplett (Tabellen, StatChecks, CritTypes), aber jeder einzelne Effekt ist ein leerer console.log:

| Effekt | Was fehlt |
|---|---|
| knockout | Critter überspringt X Turns |
| knockdown | Bewegung blockiert für 1 Turn, Animation |
| crippledLeftLeg / crippledRightLeg | Bewegungs-AP reduziert, Animationsset wechseln |
| crippledLeftArm / crippledRightArm | Waffe fällt, Skill-Penalty |
| blinded | Trefferchance massiv reduziert |
| droppedWeapon | Waffe landet auf dem Boden als Objekt |
| loseNextTurn | Turn-Skip-Flag auf Critter |
| bypassArmor | DT/DR auf 0 setzen für diesen Hit |
| onFire | DoT-Schaden über mehrere Turns |

#### 4.3 Critical Fail Effekte – Alle Stubs

| Effekt | Was fehlt |
|---|---|
| damageSelf / hitSelf | Kein Schaden wird angewendet |
| hitRandomly | Kein zufälliges Ziel wird getroffen |
| destroyWeapon | Waffe wird nicht entfernt |
| crippleRandomAppendage | Nichts passiert |
| loseAmmo | Ammo wird nicht abgezogen |

#### 4.4 Weitere fehlende Combat-Features

| Feature | Problem |
|---|---|
| Rüstungs-System | ADR/ADT in Formel eingebaut, aber Werte kommen nicht aus .pro-Dateien; kein equippedArmor-Slot |
| Ammo-System | X=2, Y=1 hardcoded; kein Lookup aus Munitions-.pro-Dateien; kein Ammo-Wechsel im UI |
| Combat-UI | Keine AP-Anzeige, kein Waffenmodus-Wechsel, kein Targeting-Reticle, Kampflog nur console.log |
| Perks | Slayer, Sniper, Sharpshooter, Better Criticals – referenziert aber nicht implementiert |
| Partial Cover | Funktion existiert, gibt immer 0 zurück |
| AP → AC | // TODO: convert unused AP into AC am Turnende |
| AI Target-Logik | // TODO: find target according to AI rules – aktuell nur nächster Feind |
| Jinxed / Pariah Dog | Erwähnt, nicht implementiert |
| Bonus AP | bonusCombatAP = 0 // TODO: replace with get function |

### 5. UI-Refactor (Issue #105)

Issue #105 beschreibt einen Plan, die UI auf eine neue Widget-basierte Library umzustellen. Der uirefactor-Branch existiert und enthält ein neues Widget-System (WindowFrame, Widget, Label, List, SmallButton), das für Skilldex, Charakter-Screen und Save/Load genutzt wird. Der worldmapViewButton ist nicht mehr auskommentiert. Jedoch: Kein PipBoy-Code in diesem Branch. Der Refactor wurde nie fertiggestellt.

Empfehlung: DarkHarold2 sollte das neue Widget-System aus dem uirefactor-Branch als Basis nutzen. Der PipBoy muss trotzdem komplett neu gebaut werden.

### 6. Empfohlene Prioritätenliste

| Priorität | Feature | Aufwand | Begründung |
|---|---|---|---|
| 🔴 1 | GAM-Dateien parsen | Mittel | Kritisch für korrekte Quest-Zustände |
| 🔴 2 | Crit-Effekte implementieren | Mittel | Architektur fertig, nur Funktionen füllen |
| 🔴 3 | Rüstungs-Slot + .pro-Lookup | Mittel | Ohne Rüstung ist Damage-Berechnung unvollständig |
| 🔴 4 | Combat-UI | Hoch | AP-Anzeige, Kampflog, Waffenmodus |
| 🟡 5 | PipBoy – AUTOMAP | Hoch | Lokale Karte, komplett neu |
| 🟡 6 | PipBoy – ARCHIVES / Quest-System | Hoch | addQuest/completeQuest + UI |
| 🟡 7 | Ammo-System | Mittel | Lookup aus .pro-Dateien |
| 🟡 8 | Status-Effekte mit Animation | Hoch | Knockdown, Crippled, Animationsset |
| 🟢 9 | Weltkarte fixen | Mittel | Vorhanden aber buggy |
| 🟢 10 | Perks | Hoch | Slayer, Sniper, Sharpshooter etc. |
| 🟢 11 | Bitmap-Fonts | Mittel | Native Fonts statt HTML-Fonts |
| 🟢 12 | Talking Heads | Hoch | Issue #110 |

### 7. Bekannte Issues (darkf/darkfo)

| Issue | Titel | Relevanz |
|---|---|---|
| #122 | GAM files für GVAR/MVAR initial values | 🔴 Kritisch für Quests |
| #118 | Done dialogue bug | 🟡 Mittel |
| #112 | Unimplementierte Opcodes | 🟡 Mittel |
| #110 | Talking Heads fehlen | 🟢 Nice to have |
| #105 | UI Refactor – nie fertiggestellt | 🟡 Basis für neue UI |
| #129 | Multiplayer map changes | 🟢 Optional |

## Der beste Plan

Der beste Plan: Von innen nach außen

Das Prinzip: Erst die unsichtbaren Fundamente legen, dann die sichtbaren Features draufbauen.

Phase 1 – Fundament 🔧 (~1-2 Wochen)

Diese Sachen blockieren alles andere:

GAM-Parser – sonst starten Quests mit falschen Werten

Skill-Checks – eine universelle skillCheck(skill, difficulty) Funktion die überall genutzt wird

Rüstungs-Lookup aus .pro-Dateien – sonst ist Kampf-Damage sinnlos

Phase 2 – Kampf spielbar machen ⚔️ (~2-3 Wochen)

Ohne funktionierenden Kampf ist Fallout kein Fallout:

Crit-Effekte implementieren (Architektur ist fertig, nur füllen)

Combat-UI – AP-Anzeige, Waffenmodus, Kampflog

Ammo-System aus .pro-Dateien

Phase 3 – Navigation & Orientierung 🗺️ (~2-3 Wochen)

PipBoy – Status-Tab, Automap, Archives

Quest-System – addQuest(), completeQuest(), PipBoy-Integration

Weltkarte fixen

Phase 4 – Skills leben (~1-2 Wochen)

Speech-Checks in Dialogen

Steal, Sneak, Doctor, First Aid aktivieren

Perks (Slayer, Sniper, etc.)

Phase 5 – Polish 💅 (ongoing)

Bitmap-Fonts

Talking Heads

Saving/Loading stabilisieren

Visualisiert:

[GAM + Skills + Rüstung] → [Kampf] → [PipBoy/Quests] → [Skills leben] → [Polish]

Woche 1-2               3-5          6-8               9-10           11+

## TODOsDarkFo

```
output
Copy
File            TODO                                                              Type       Size
--------------------------------------------------------------------------------------------------------------
ui.ts           Reduce code duplication, circular references, general unmaintain  refactor   large
ui.ts           Combat UI on main bar                                             feature    medium
ui.ts           Stats/info view in inventory screen                               feature    small
ui.ts           Fix inventory image size                                          polish     small
ui.ts           Fix style for inventory image amount                              polish     small
ui.ts           Option for scaling the UI                                         feature    medium
ui.ts           List: disable-selection class                                     polish     small
ui.ts           Move skill/stat constants to proper place                         refactor   small
ui.ts           Use widget list for stats instead of hack                         refactor   small
ui.ts           Re-run char screen after window shown / level-up invoked          bug        small
ui.ts           setItemText on List instead of clear+rebuild                      refactor   small
ui.ts           isLevelUp / canChangeStats: replace hardcoded true with real log  bug        medium
ui.ts           Examine visibility vs show/hide usage                             refactor   small
ui.ts           playerUse() should take an object (context menu)                  bug        small
ui.ts           Weapon AP >9 display                                              polish     small
ui.ts           All melee weapon types in HUD                                     feature    small
ui.ts           Rewrite uiMoveSlot sanely (no direct player property mutation)    refactor   medium
ui.ts           Transition dialogue box down on close                             polish     small
ui.ts           checkOffer() or similar for barter                                refactor   small
ui.ts           Drop 'working copies' in barter?                                  refactor   small
combat.ts       bonusCombatAP / bonusMoveAP: replace with proper get function     bug        small
combat.ts       Initialize AI elsewhere (e.g. in Critter)                         refactor   small
combat.ts       accountForPartialCover: get intervening critters                  feature    medium
combat.ts       Visibility (light conditions) and distance in hit chance          feature    medium
combat.ts       bonusAC: AP at end of turn bonus                                  feature    small
combat.ts       bonusCrit: perk bonuses and other crit influencers                feature    small
combat.ts       Slayer/Sniper perk: second chance to crit                         feature    small
combat.ts       Jinxed/pariah dog: 50% crit miss chance                           feature    small
combat.ts       Sharpshooter perk bonus in hit distance                           feature    small
combat.ts       ADR/ADT: use actual armor stats                                   bug        medium
combat.ts       Map weapon type to crit fail table types                          bug        medium
combat.ts       Find target according to AI rules (not just closest)              feature    medium
combat.ts       Check nearest direction first in AI creep                         polish     small
combat.ts       Convert unused AP into AC at end of turn                          feature    small
combat.ts       Check number of active combatants before ending combat            bug        small
Total TODOs: 35
By type: {'refactor': 9, 'feature': 13, 'polish': 6, 'bug': 7}
By size: {'large': 1, 'medium': 9, 'small': 25}
By file: {'ui.ts': 20, 'combat.ts': 15}
Here's the full triage (just from ui.ts and combat.ts — there are likely more in object.ts, scripting.ts, etc.):
35 TODOs found across 2 files
By type:
🐛 Bug fixes: 7 — these are the most important to do first
✨ Features: 13 — mostly combat perk/stat stuff
🔧 Refactors: 9 — code quality, not gameplay
💅 Polish: 6 — visual/UX tweaks
My recommended batches for Claude Code:
Batch 1 — Quick wins (all small, low risk) ✅
Fix inventory image size + amount style
playerUse() takes an object
Weapon AP >9 display
Dialogue box transition down on close
bonusCombatAP/bonusMoveAP get function
Check active combatants before ending combat
Batch 2 — Combat correctness (medium risk) ⚔️
ADR/ADT use actual armor stats
Map weapon type to crit fail table
isLevelUp/canChangeStats real logic
Find target by AI rules, not just closest
bonusAC AP end-of-turn bonus
Batch 3 — Refactors (safe but boring) 🔧
uiMoveSlot rewrite
Stats widget cleanup in char screen
setItemText on List
Batch 4 — Skip for now ⛔
"Reduce code duplication / circular references" — too vague, too large, high risk of breaking things
Gesamtübersicht: DarkFO / DarkHarold2 – Analyse-Ergebnisse
1. Projektstand (laut README)
Funktioniert:
Map loading, Walking/Running
NPC-Dialoge, Bartering
Einige Quests (Scripting funktioniert größtenteils)
Einige Party Members
Skills: Lockpicking, Repair, passive Skills
Sound (gescriptete Effekte, Musik)
Teilweise / buggy:
Combat (nur SMG & Spear getestet, kein Ammo-Wechsel)
Kein Rüstungs-System
Weltmap: rough & buggy, Eingänge falsch platziert
Random Encounters: nicht alle setups implementiert
Lighting: funktioniert, aber langsam & ungenau
Save/Load: Alpha-Stadium – funktioniert rudimentär, nicht getestet
Animationen (besonders Combat)
Level-Up: teilweise
Komplett fehlend:
PipBoy (gesamte UI – nicht nur die Map!)
2. PipBoy – vollständig unimplementiert
Der README nennt nur "PipBoy map", aber tatsächlich fehlt die gesamte PipBoy-UI. Die drei Tabs in F1/F2:
| Tab | Status |
|---|---|
| STATUS (HP, Rads, Poison, Zeit) | Daten vorhanden im HUD, aber keine PipBoy-UI |
| AUTOMAP (lokale Karte) | Komplett fehlend |
| ARCHIVES (Quests/Notizen) | Kein Quest-System, keine UI |

Kein pipboy.ts existiert in src/. Muss komplett neu gebaut werden.
3. Quest-System – fehlt strukturell
In scripting.ts existieren globalVars für Quest-Flags, aber:
Kein addQuest() / completeQuest()
give_exp_points() und get_pc_stat() sind Stubs
Quest-States sind rohe globalVars-Nummern ohne lesbare Struktur
Kritisch: .GAM-Dateien werden nicht gelesen (Issue #122) → GVAR/MVAR-Initialwerte defaulten auf 0 → falsche Quest-States
4. Branches – wichtige Erkenntnisse
uirefactor-Branch:
Neues Widget-System implementiert: WindowFrame, Widget, Label, List, SmallButton
Skilldex, Character Screen, Save/Load bereits auf neues System portiert
worldmapViewButton nicht mehr auskommentiert
Kein PipBoy-Code – muss trotzdem neu gebaut werden
Empfehlung: Als UI-Basis für DarkHarold2 verwenden
serialize-Branch:
Obj.serialize() – vollständig implementiert
GameMap.serialize() / GameMap.deserialize() – vollständig
Script._serialize() / scriptingEngine.deserializeScript() – vorhanden
Fehlend: spatials-Serialisierung (auf null gesetzt), Player-State
Empfehlung: Als Basis für das Save/Load-System übernehmen
5. Offene Issues (relevant)
| Issue | Beschreibung | Priorität |
|---|---|---|
| #122 | .GAM-Dateien nicht gelesen → falsche GVAR/MVAR-Initialwerte | 🔴 Kritisch für Quests |
| #112 | Unimplementierte Script-Opcodes | 🔴 Hoch |
| #118 | "Done"-Dialogue-Bug | 🟡 Mittel |
| #110 | Talking Heads fehlen | 🟡 Mittel |
| #105 | UI-Refactor auf neues Widget-System (nie fertig) | 🟢 Basis für PipBoy |
| #129 | Multiplayer Map-Changes | 🔵 Low |

```
