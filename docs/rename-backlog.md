# Rename backlog

Naming decisions still open. Wave 13 applied the rest of the original audit
(the `ExplorerNode` family is now `ExplorerRow`, `SourceRow`, `FolderRow`;
`getArchiveContext` is `requireResolvedUri`; `isInside` is `isBelow`;
`toTreeName` is `toEntryPath`; `ParsedArchive` is `ArchiveIndex`;
`alignBytes` is `alignToFourBytes`; `BIG_PATTERN` is `ARCHIVE_GLOB`;
`getListedNames` is `formatNameList`; `createNodeCommandRegister` is
`createNodeCommandRegistrar` in `services/archives/nodeCommands.ts`; the test
helpers `toNodeUri` and `readChildNames`) together with about 550 verb-phrase
renames across the tree.

## Blocked on a decision

| symbol | file | now | suggested | why | sites |
| --- | --- | --- | --- | --- | --- |
| `ArchiveChange.type` | `services/archives/archiveRegistry.ts` | `type` | `kind` | Collides with `node.type` (`FileType`) in the tree provider, and `EntryChange` already uses `kind` for this exact idea. The field was moved from `kind` to `type` on purpose once, so this needs a deliberate call. | 1 + decl |

## Not applied

| symbol | file | now | suggested | why it waits |
| --- | --- | --- | --- | --- |
| function | `services/archives/virtualNode.ts` | `buildVirtualTree` | `createArchiveRoot` | Still takes entry paths, which the archive policy tests pass; the rename fits only once that parameter goes. |
| methods | `features/apt/aptScripts.ts`, `aptTextView.ts` | `document`, `changed` | `findDocument`, `notifyChanged` | `aptEditorProvider` already declares the proposed names, so the rename needs the two hosts and the provider settled together. |
| functions | `webview/shared/modelRenderer.ts` | `compile`, `uniform` | `compileShader`, `getUniformLocation` | The proposed names are WebGL methods the module calls, so they would read as the same call. |
| function | `webview/shared/element.ts` | `element` | `createElement` | Shadows `document.createElement` at every call site. |
| suite | `test/suite/extension.test.ts` | `'Extension Test Suite'` | `'Extension activation'` | A test title, not an identifier. |
| test | `test/suite/archive.test.ts` | `'reads several entries through one open archive'` | `'reads several entries in one pass'` | A test title; names a mechanism the test never observes. |

## Not worth changing

`node`, `entry`, `path`, `archiveFile`, `tempFile` all fit their contexts. A
generic name that genuinely fits is not a defect.

---

# Findings that are not renames

Collected while reading. None were acted on.

## Likely bugs

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
  `\` + backslashed entry path) lives outside `services/archives/nodeAddress` and is
  missing from the three-name table in `docs/architecture.md` §4.
