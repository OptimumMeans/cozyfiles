# Graph Report - .  (2026-06-16)

## Corpus Check
- Corpus is ~16,607 words - fits in a single context window. You may not need a graph.

## Summary
- 103 nodes · 172 edges · 8 communities (6 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.86)
- Token cost: 0 input · 38,289 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Apps, Eggs & Registry|Apps, Eggs & Registry]]
- [[_COMMUNITY_WindowManager Internals|WindowManager Internals]]
- [[_COMMUNITY_Design Spec & Docs|Design Spec & Docs]]
- [[_COMMUNITY_Entry, Styling & Boot|Entry, Styling & Boot]]
- [[_COMMUNITY_Gate & Bootstrap|Gate & Bootstrap]]
- [[_COMMUNITY_FILES Explorer|FILES Explorer]]
- [[_COMMUNITY_PLAYER & Audio|PLAYER & Audio]]
- [[_COMMUNITY_Guestbook Egg|Guestbook Egg]]

## God Nodes (most connected - your core abstractions)
1. `WindowManager` - 20 edges
2. `wm` - 10 edges
3. `registerApp()` - 9 edges
4. `index.html entry` - 7 edges
5. `WindowManager API (wm.open)` - 7 edges
6. `App Registry (registerApp)` - 7 edges
7. `onTap()` - 6 edges
8. `initDesktop()` - 5 edges
9. `The Desktop (cozyOS)` - 5 edges
10. `Easter Egg Discovery` - 5 edges

## Surprising Connections (you probably didn't know these)
- `index.html entry` --implements--> `Boot/Glitch Transition`  [INFERRED]
  index.html → docs/superpowers/specs/2026-06-16-cozyfiles-awge-design.md
- `index.html entry` --implements--> `The Desktop (cozyOS)`  [INFERRED]
  index.html → docs/superpowers/specs/2026-06-16-cozyfiles-awge-design.md
- `index.html entry` --implements--> `The Gate`  [INFERRED]
  index.html → docs/superpowers/specs/2026-06-16-cozyfiles-awge-design.md
- `css/tokens.css` --implements--> `Design Tokens (tokens.css)`  [INFERRED]
  index.html → docs/superpowers/specs/2026-06-16-cozyfiles-awge-design.md
- `js/main.js (module entry)` --implements--> `main.js boot orchestration`  [INFERRED]
  index.html → docs/superpowers/specs/2026-06-16-cozyfiles-awge-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Four desktop apps participate in the app-registry pattern** — specs_app_files, specs_app_about, specs_app_contact, specs_app_player, specs_app_registry [EXTRACTED 1.00]
- **Gate -> boot -> desktop init flow** — specs_the_gate, specs_boot_transition, specs_the_desktop, specs_main_js [EXTRACTED 1.00]
- **Hidden easter eggs launched via secret triggers** — specs_egg_terminal, specs_egg_guestbook, specs_egg_notepad, specs_egg_recycle, specs_easter_eggs [EXTRACTED 1.00]

## Communities (8 total, 2 thin omitted)

### Community 0 - "Apps, Eggs & Registry"
Cohesion: 0.14
Nodes (11): PARAGRAPHS, WE_MAKE, SOCIALS, LORE, TRASH, FILES, LORE, openApp() (+3 more)

### Community 2 - "Design Spec & Docs"
Cohesion: 0.18
Nodes (15): cozyfiles.us README, ABOUT.TXT app, CONTACT app, FILES.EXE app, PLAYER app, App Registry (registerApp), COZYFILES.US Design Spec, Easter Egg Discovery (+7 more)

### Community 3 - "Entry, Styling & Boot"
Cohesion: 0.24
Nodes (12): css/apps.css, css/tokens.css, index.html entry, js/main.js (module entry), Per-app CSS files, AWGE Aesthetic, Boot/Glitch Transition, Design Tokens (tokens.css) (+4 more)

### Community 4 - "Gate & Bootstrap"
Cohesion: 0.31
Nodes (5): initDesktop(), startClock(), BOOT_LINES, runGate(), start()

### Community 5 - "FILES Explorer"
Cohesion: 0.32
Nodes (6): coverMarkup(), escapeHtml(), findFile(), FOLDERS, openViewer(), TYPE_GLYPH

### Community 6 - "PLAYER & Audio"
Cohesion: 0.33
Nodes (4): CHORDS, PLAYLIST, render(), onTap()

## Knowledge Gaps
- **17 isolated node(s):** `PARAGRAPHS`, `WE_MAKE`, `SOCIALS`, `SEED`, `LORE` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `WindowManager` connect `WindowManager Internals` to `Apps, Eggs & Registry`?**
  _High betweenness centrality (0.208) - this node is a cross-community bridge._
- **Why does `The Desktop (cozyOS)` connect `Entry, Styling & Boot` to `Design Spec & Docs`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `App Registry (registerApp)` connect `Design Spec & Docs` to `Entry, Styling & Boot`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `index.html entry` (e.g. with `Boot/Glitch Transition` and `The Desktop (cozyOS)`) actually correct?**
  _`index.html entry` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `PARAGRAPHS`, `WE_MAKE`, `SOCIALS` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Apps, Eggs & Registry` be split into smaller, more focused modules?**
  _Cohesion score 0.13666666666666666 - nodes in this community are weakly interconnected._