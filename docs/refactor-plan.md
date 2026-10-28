# Refactor plan

The codebase is being moved into the layout `conventions.md` describes, one
wave at a time, so that each PR stays reviewable and the extension behaves the
same after every one. A wave moves and renames modules; it does not change
what they do. Waves joined by `||` touch disjoint files and can run in
parallel.

Every wave keeps these unchanged: command ids, custom editor view types, view
ids, context keys, configuration keys, language ids, uri schemes and webview
bundle names. Every wave passes the gate, adds no import cycle
(`npm run check:cycles`) and no new layer warning in the folders it touches.

| wave | scope |
| --- | --- |
| **W1** | One composition root: `services/createServices.ts`, a `register<Feature>` per feature under `features/`, `extension.ts` reduced to the ordered list, `esbuild.mjs` driven by `PAGES`, layer rules at `warn`, `check:cycles`, this plan and `conventions.md`. |
| **W2** | `core/`: move `common/` (paths, expression, windows1252, debounce, messages) and the generic parts of `binary/` in; nothing in it imports `vscode` or Node. |
| **W3a** | `formats/`: the BIG format out of `binary/`, the decoders out of `tools/` (TGA, DDS, WAV, W3D), each format in its own folder. |
| **W3b** | `formats/`: the INI, STR and WND dialects out of `language/model/` and `language/sage*Language.ts`, so `formats/particles` stops importing the INI lexer from `language/`. |
| **W4** | `game/` and `node/`: the game view, install discovery and layering, mod diff and packaging out of `model/`; disk and process I/O (archive files, FFmpeg, launch) into `node/`. `entryLocator` leaves `formats/`. |
| **W5** | `services/` and `platform/`: `ArchiveModel`, `GameViewModel`, `EntryLocator`, the INI documents and index and `GameLanguage` move under `services/`; VS Code adapters with no domain knowledge into `platform/`. Settle whether the CAH editor can share `iniDocuments` instead of building its own. |
| **W6a** | Features: explorer, mods, installs. Give `features/mods` the mod row commands now registered from `features/explorer`, by moving the node command register into a service or `platform/`. |
| **W6b** | Features: apt. |
| **W6c** | Features: iniLanguage and the INI panels (armorTable, balanceSheet, bulkEdit, commandSet, objects, particles, audio). |
| **W6d** | Features: the editors (strings, wnd, map, cah, preview, scripts, textures, w3d, video). |
| **W7** | Shared helpers: `snapshotEditor`, `singletonPanel`, and the `platform/` helpers for commands, errors, settings and context keys. |
| **W8** | `core/byteReader` for every binary parser, and `webview/shared/vscodeApi` for every page. |
| **W9** | Split `archiveModel`. |
| **W10** | Split `aptEditorProvider`. |
| **W11** | Split `movieText`, `movieTextEdits` and `aptWriter`. |
| **W12** | The page scripts still inlined as strings (`*Script.ts`) become bundled TypeScript pages under `webview/`, each an entry in `PAGES`. |
| **W13** | Comments, TSDoc and naming pass across the moved code (`naming` skill, `rename-backlog.md`); the layer rules go from `warn` to `error`. |

## Baseline at W1

- **Layer warnings:** 36, all in code that already sits in a target folder:
  `formats/` importing `tools/`, `common/`, `language/` or `vscode`
  (`entryLocator`), and `webview/` pages importing `language/model/`,
  `common/`, `tools/` or `webview/scene/` (which becomes `webview/shared/`).
- **Import cycles:** 22, the same before and after W1, so `check:cycles` exits
  non-zero until they are gone. They sit in `webview/apt/` (the AVM, player,
  scene and protocol modules, and `details` with its block cards), in
  `providers/aptEditorProvider` with `aptScripts` and `aptTextView`, in
  `formats/particles` (`particleIni` with `fxEffects`) and in `model/archive`
  with `virtualNode`. The waves that move those files break them.
