# bigFS conventions

Where code goes and what shape it takes. `architecture.md` explains how the
extension works; this file says where a change belongs. The codebase is being
moved into this layout wave by wave (`refactor-plan.md`), so older folders
(`model/`, `language/`, `providers/`, `commands/`, `tools/`, `binary/`,
`common/`, `actions/`, `ui/`) still exist. New code goes into the layout below,
not into them.

## Style in one paragraph

Functions and composition over class inheritance. A class stays only where the
VS Code API expects one (a `TreeDataProvider`, a `CustomEditorProvider`, a
`FileSystemProvider`), and then as a thin shell over functions that hold the
logic. Names are descriptive and follow the `naming` skill. Comments only where
they carry something the code cannot.

## The layers

From the bottom up. A layer imports only from the layers listed for it in the
import matrix.

| folder | holds | may not touch |
| --- | --- | --- |
| `src/core/` | generic, browser-safe helpers with no domain knowledge: paths, expressions, text encodings, binary readers | `vscode`, Node built-ins, anything else in `src` |
| `src/formats/<format>/` | one game file format each: parse, serialise, edit, with no host | `vscode`, Node built-ins |
| `src/game/` | the engine's rules: which file the game loads, install layering, the INI dialect's schema and resolution | `vscode`, Node built-ins |
| `src/node/` | Node I/O: reading and writing archives on disk, spawning FFmpeg or the game | `vscode` |
| `src/platform/` | thin VS Code adapters with no domain knowledge: settings, context keys, command errors, webview plumbing | the domain layers |
| `src/services/` | the long-lived host services built once at activation, and `createServices.ts`, which builds them | features, webview |
| `src/features/<feature>/` | one user-facing feature: its commands, providers, editors and views, wired in `index.ts` | other features |
| `src/webview/<feature>/` | the code that runs inside one feature's webview page | `vscode`, Node, the host layers, other pages |
| `src/webview/shared/` | page code more than one page uses | the same as a page |

`src/extension.ts` is the composition root: it calls `createServices` and then
each feature's register function, in order, and nothing else.

### Where new code goes

| you are adding | it goes in |
| --- | --- |
| a helper with no game or VS Code knowledge | `core/` |
| a parser, writer or editor for a file format | `formats/<format>/` |
| a rule of how the engine behaves (load order, field types, resolution) | `game/` |
| something that reads or writes the disk or starts a process | `node/` |
| a reusable wrapper over a VS Code API that knows nothing of BIG or SAGE | `platform/` |
| state that lives for the session and several features share | `services/`, added to `Services` in `createServices.ts` |
| a command, provider, editor, view or status bar item | `features/<feature>/` |
| the drawing and interaction inside a webview | `webview/<feature>/` |
| the messages a page and its feature exchange | `webview/<feature>/protocol.ts` |
| something two features both need | down a layer, never in one of the two features |

### Import matrix

Rows import from columns. `own` is the module's own folder.

| from \ to | core | formats | game | node | platform | services | features | webview | `vscode` | Node built-ins |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| core | own | | | | | | | | | |
| formats | yes | own | | | | | | | | |
| game | yes | yes | own | | | | | | | |
| node | yes | yes | yes | own | | | | | | yes |
| platform | yes | | | | own | | | | yes | yes |
| services | yes | yes | yes | yes | yes | own | | | yes | yes |
| features/x | yes | yes | yes | yes | yes | yes | own only | `webview/x/protocol` only | yes | yes |
| webview/x | yes | yes | yes | | | | | own and `shared` | | |

`eslint.config.mjs` enforces the matrix with `@typescript-eslint/no-restricted-imports`
for the new folders. The rules warn until the last wave, when they become
errors. While the older folders exist, `services/` and `features/` may import
them; the pure layers may not. `npm run check:cycles` lists import cycles; a
change may not add one.

## Module shape

- **One main export per file, and the file is named after it.**
  `createServices.ts` exports `createServices`; `archiveModel.ts` exports
  `ArchiveModel`. Types that only describe that export's inputs and outputs may
  sit beside it.
- **`index.ts` exists only in `features/<feature>/`.** Everywhere else a file
  is imported by its own name, so a search for the name finds the file.
- **Functions first.** A module is a set of functions over plain data. Reach
  for a class only when VS Code requires one, and keep the logic in functions
  the class calls.
- **Factories are `create*`.** A function that builds a stateful object with a
  `dispose` returns it from `createX`, not `new X` where a class is not needed.
- **No barrels.** Do not re-export a folder's files through one module.

## Feature anatomy

```
src/features/<feature>/
  index.ts          register<Feature>(context, services): void
  <otherFiles>.ts   the commands, providers and views it registers
src/webview/<feature>/
  main.ts           the page entry, bundled by esbuild.mjs
  protocol.ts       the messages between the page and the feature
```

- `index.ts` exports exactly one function,
  `register<Feature>(context: ExtensionContext, services: Services): void`, and
  pushes every disposable it creates onto `context.subscriptions` itself.
- A feature owns its command ids and writes them as full literals,
  `'bigfs.openBalanceSheet'`, so a search for the id in `package.json` lands on
  the registration.
- A feature never imports another feature. When two need the same thing, it
  moves down a layer or into a service.
- Adding a feature: create the folder, add the register function to the
  `FEATURES` list in `extension.ts`, contribute its commands in `package.json`.
  `src/test/suite/extension.test.ts` fails if a contributed command is not
  registered.
- A new webview page is one entry in `PAGES` in `esbuild.mjs`.
- Never rename a command id, custom editor view type, view id, context key,
  configuration key, language id, uri scheme or webview bundle name. Users'
  keybindings, settings and `when` clauses depend on them.

## Naming

Follow `.claude/skills/naming/SKILL.md`, and read it before naming anything.
It holds the project vocabulary (archive, entry, node, root, source, plan,
tool, format) and the shapes: verb-phrase functions, question-form booleans,
no `Manager`/`Helper`/`Util`, camelCase files named after their main export.

## Comments and TSDoc

- Every exported symbol has a TSDoc comment. The first sentence says what kind
  of thing it is and what it is for; it does not restate the name or the type.
- Add a second sentence only for a constraint, a reason or a non-local
  consequence. Most doc comments are one line.
- `@param` and `@returns` only for a constraint the signature cannot express,
  and only on the parameter that has one. Never a type in a tag. `@throws`
  when a caller has to catch something specific.
- `//` comments explain a decision in the body that would otherwise look like
  a mistake. They never narrate the next line or describe what the code used
  to do.

The detail and worked examples are in `.claude/skills/naming/references/comments.md`.

## Error handling

- **Parsers never throw into the editor.** Untrusted input fails with a
  message: a parse result carries its problems, and allocations are bounded by
  the bytes present, never by a header count.
- **Exceptions are for the VS Code boundary** and for tagged errors a caller
  branches on (`NotAnArchiveError`). The file system provider throws
  `FileSystemError`s because the API requires them.
- **A command reports, it does not crash.** A command body's error is shown
  with `window.showErrorMessage` and the message of the error.
- **Background work is never left floating.** A promise started at activation
  and not awaited ends in `.catch` that writes to `services.log`.

## Settings and context keys

Settings and context keys are read and written through `platform/`, which
holds their names in one place; a feature does not call
`workspace.getConfiguration()` or `setContext` with a string of its own. Until
the platform helpers land (`refactor-plan.md`, W7), keep each key a named
constant beside the code that owns it.

## Tests

- **Unit tests** live in `src/test/unit`, run with `npm run test:unit` and never
  start VS Code, so they cover `core`, `formats`, `game` and `node`. New
  behaviour gets one.
- **Integration tests** live in `src/test/suite` and run inside VS Code
  (`xvfb-run -a npm test`). They cover features through the commands and
  providers the extension registers.
- **No game content.** Tests build synthetic files in code; see `src/test/unit`
  for the pattern.
- The gate: `npm ci && npm run check-types && npm run lint && npm run test:unit`.
