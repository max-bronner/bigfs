# Rename backlog

Collected during the comment audit. Nothing here has been renamed — each entry
is a proposal with its blast radius, so the decision stays with the author.

Call-site counts were taken with `grep -rn` at the time of the audit. Re-check
before acting on the larger ones.

## Blocked on a decision

| symbol | file | now | suggested | why | sites |
| --- | --- | --- | --- | --- | --- |
| `ArchiveChange.type` | `model/archiveModel.ts` | `type` | `kind` | Collides with `node.type` (`FileType`) in `treeDataProvider`, and `EntryChange` already uses `kind` for this exact idea. **The uncommitted working tree just moved this the other way** (`kind` → `type`), so this contradicts an in-flight decision — resolve it deliberately rather than by merge order. | 1 + decl |

## High value

The `ExplorerNode` family is the largest single item and the one the existing
skill already has a precedent for (`BigTreeNode` → `BigTreeItem`).

| symbol | file | now | suggested | why | sites |
| --- | --- | --- | --- | --- | --- |
| explorer row union | `providers/explorerNode.ts` | `ExplorerNode`, `SourceNode`, `FolderNode`, `isSourceNode`, `isFolderNode`, file `explorerNode.ts` | `ExplorerRow`, `SourceRow`, `FolderRow`, `isSourceRow`, `isFolderRow`, file `explorerRow.ts` | `node` means `VirtualNode` in the vocabulary table, and two of the three members have no node behind them. `treeDataProvider` already says `compareRows`/`sortRows`/`rowName`, so the code speaks the right word everywhere except the type names. Keep `isVirtualNode` as is. | `ExplorerNode` 28, `FolderNode` 5, `isSourceNode` 5, `isFolderNode` 4, `SourceNode` 3, specifier 8 |
| method | `model/archiveModel.ts` | `apply` | `applyToArchive` | Reads as `Function.prototype.apply` at every use site, and hides that it also logs failure and fires the view event | 7 + decl |
| method | `model/archiveModel.ts` | `getArchiveContext` | `requireResolvedUri` | Returns `ResolvedUri`, not a "context"; `Context` is one of the empty words. Also hides that it throws `FileNotFound` rather than returning undefined, which is the only thing separating it from `resolveUri` | 4 + decl |
| function | `model/virtualNode.ts` | `isInside` | `isBelow` | Reads as a synonym of `common/paths`' `isPathBelow`, but is exclusive where that one is deliberately inclusive. Two near-identical names with opposite edge behaviour — see the bug note below | 1 use + 1 import + 1 internal |
| function | `model/virtualNode.ts` | `buildVirtualTree` | `createArchiveRoot` | "Virtual tree" is not in the vocabulary table, and the sole caller passes no entries — it builds a root node, and files arrive later through `syncFiles` | 1 use + 1 import |

## Layer violations and wrong vocabulary

| symbol | file | now | suggested | why | sites |
| --- | --- | --- | --- | --- | --- |
| function | `binary/bigFormat.ts` | `toTreeName` | `toEntryPath` | `binary/` knows nothing above it, and "tree" is `VirtualNode`'s word. It produces an entry path. Its partner `toStoredName` is already correct | 1 |
| type | `binary/bigFormat.ts` | `ParsedArchive` | `ArchiveIndex` | It is `{ magic, entries }` — no entry data. `readArchiveIndexTable` returns it, so function and type disagree about what was read | 3 |
| local | `commands/clipboardCommands.ts` | `getEntryPath` | `getStoredEntryPath` | The vocabulary table defines an entry path as `/` separated; this returns the backslash form. A reader who knows the term guesses wrong | 2 |
| local | `commands/clipboardCommands.ts` | `getAbsolutePath` | `getArchiveQualifiedPath` | Returns `…\textures.big\data\ini\x.ini`, which no fs call can open. "Absolute path" promises something openable | 1 |
| local | `actions/fileActions.ts` | `readFiles` | `readFilesFromDisk` | `ArchiveModel.readFiles` reads content *out of* archives; this reads files *from disk* on the way in. Same name, opposite direction, both in the `importFromDisk` call graph | 1 |
| property | `formats/formatRegistry.ts` | `EntryRef.path` | `entryPath` | Two paths in the vocabulary table and this picks the ambiguous word; the node beside it spells `entryPath` out | 1 decl + 4 |

## Shape: nouns that should be verbs, hidden constants

| symbol | file | now | suggested | why | sites |
| --- | --- | --- | --- | --- | --- |
| function | `binary/bigFormat.ts` | `alignBytes` | `alignToFourBytes` | Takes and returns an offset, and "bytes" hides the constant that matters — `(offset + 3) & ~3` is a 4-byte boundary | 3 |
| constant | `constants.ts` | `BIG_PATTERN` | `ARCHIVE_GLOB` | "BIG" names the format, not the value; "pattern" does not say glob. Both uses pass it to a glob API | 3 |
| function | `model/virtualNode.ts` | `reEntryPath` | `resetEntryPaths` | Not a verb phrase; "re" + noun reads as a typo, and it rewrites a subtree, not one path | 2 |
| function | `providers/treeDataProvider.ts` | `rowName` | `getRowName` | Noun sitting between `compareRows` and `sortRows`; `rowName(a)` reads like a property access | 2 |
| function | `ui/dialogs.ts` | `getListedNames` | `formatNameList` | Plural of names, but returns one joined string with an "and N more" tail — a rendered sentence fragment | 3 |
| function | `commands/extractCommands.ts` | `withoutRefusedFiles` | `withoutSkippedFiles` | "Refused" does not say by whom — reads as the extension refusing, when it is the user declining to overwrite. `skip` is the dialog's own word | 1 |
| factory | `commands/commandCenter.ts` | `createNodeCommandRegister` | `createNodeCommandRegistrar` | "Register" as a noun reads as a ledger, not an agent. The call site already names the result `registerNodeCommand` | 2 |
| file | `commands/commandCenter.ts` | `commandCenter.ts` | `nodeCommands.ts` | No `CommandCenter` exists here; the main export is `createNodeCommandRegister`. The name borrows VS Code's git extension, where it is a class | 4 importers |

## Tests

| symbol | file | now | suggested | why | sites |
| --- | --- | --- | --- | --- | --- |
| helper | `test/suite/archive.test.ts` | `nodeUri` | `toNodeUri` | Reads as a variable; constructs one. `nodeAddress` already exports `getNodeUri` doing this for real | 21 |
| helper | `test/suite/archive.test.ts` | `childNames` | `readChildNames` | Noun among verb-phrase peers (`readText`, `readNames`), and it is async and goes through the provider | 4 |
| helper | `test/suite/archive.test.ts` | `treeItem` | `toTreeItem` | Reads as a variable holding a `BigTreeItem`, but constructs one | 4 |
| suite | `test/suite/extension.test.ts` | `'Extension Test Suite'` | `'Extension activation'` | Generator scaffold text; every other suite names a behaviour | 1 |
| test | `test/suite/archive.test.ts:555` | `'reads several entries through one open archive'` | `'reads several entries in one pass'` | Names a mechanism the test never observes — it compares contents and would pass if each entry reopened the archive | 1 |

## Not worth changing

`node`, `entry`, `path`, `archiveFile`, `tempFile` all fit their contexts. A
generic name that genuinely fits is not a defect.

---

# Findings that are not renames

Collected while reading. None were acted on.

## Likely bugs

**`isInside` never matches an archive root** — `model/virtualNode.ts:28`.
Entry paths carry no leading slash, so when `other` is an archive root
(`entryPath === ''`) the prefix built is `"/"` and `startsWith` can never
match. Consequences: `getTopLevelNodes` does not collapse a selection holding
an archive root plus its own descendants, and `fileActions.canMoveInto` does
not stop an archive root being dropped into one of its own folders. Masked
today only because `groupByArchive` rejects archive roots outright.

**`FormatContext.sibling` resolves the wrong entry** —
`formats/formatRegistry.ts`. It calls `listIn(getParentPath(entry.path))`,
which uses `getFileNodes` (recursive), then matches on **name only**. So
`movies/sub/unit.const` is returned as a sibling of `movies/unit.apt`. For a
top-level entry it is worse: `getParentPath('unit.apt')` is `''`,
`findChild(root, '')` returns the root, and the whole archive is scanned for a
name match. The suite's fixture is flat, so nothing catches it. This matters
before the `.apt` work, which is precisely the case that finds `.const` and
`.dat` by name.

**`ArchiveSource.id` is not stable across sessions** — its doc says it is, but
when two workspace folders share a slug, which one gets the bare slug and which
gets the hash suffix depends on workspace-folder order. Reordering the folders
swaps their ids, and with them every stored uri.

## Dead and unreachable code

- `VirtualNode.archive` is non-optional, so every `!archive` / `archive?.`
  guard in `archiveModel.ts` is unreachable — `getArchiveOf` (its
  `FileSystemError.FileNotFound` can never fire), `loadArchiveOf`,
  `getEntryForNode`, `getFileContent`.
- `getTargetDirectory` cannot return `undefined`: `parent` is unset only on the
  archive root, which is a `Directory` and returns itself. The four
  `if (!directory) return;` guards in `fileCommands.ts` and
  `clipboardCommands.ts` are unreachable.
- `formatRegistry.createContext` guards `if (!archive) return undefined` for
  the same reason, and its `FormatContext | undefined` makes every caller
  null-check for nothing.
- `buildVirtualTree`'s `entryPaths` parameter — the sole call passes `[]`.
- After the lazy-read refactor nothing in `runScan` reads an index table, so
  its `Promise.allSettled` can only reject from `known.reload()`. The
  "N of M BIG archives could not be read" warning now only counts archives
  already loaded before a rescan; a new unreadable archive is dropped later by
  `readArchive` instead.

## Duplication

- `joinEntryPath` is defined twice, identically, in `archiveModel.ts:73` and
  `virtualNode.ts:45`.
- `archiveFile.ts:126-132` repeats the `pendingData` and empty-size fast paths
  that `openArchiveReader.readEntry` already has at lines 93-99.
- `archive.test.ts` repeats the same nine-line `suiteSetup` wait in four
  suites, with an identical comment each time.
- `BigFileSystemProvider.resolveNode` is a one-line delegate to
  `archiveModel.resolveNode` with no added decision, called three times in the
  same class.

## Smaller notes

- `archiveFile.ts:179` builds the temp path from `process.pid` only. Two hosts
  get different temp files, but two saves from the *same* host would collide on
  the name — unverified whether the per-archive queue rules that out.
- `bigFormat.ts:162` writes `totalSize` little-endian while the neighbouring
  three fields are big-endian, mirroring the documented quirk on the parse side.
  Only the parse side carries a comment.
- `treeDataProvider.listIn` rebuilds a `FolderNode` for every archive under the
  same folder instead of skipping names already in the map. Harmless, but it is
  repeated allocation when expanding a source.
- `virtualNode.ts:50` throws a template literal with no interpolation, and the
  same message covers two different causes (parent is a file / parent has no
  `children` map).
- The fourth address form composed in `clipboardCommands.ts` (`archivePath` +
  `\` + backslashed entry path) lives outside `model/nodeAddress` and is
  missing from the three-name table in `docs/architecture.md` §4.
