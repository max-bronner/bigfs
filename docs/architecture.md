# bigFS architecture

How the extension is put together: the layers, the data, how a read and a
write flow through them, and where new file formats and tools plug in.

This describes the code as it stands. Open questions are at the end.

---

## 1. What a BIG archive actually is

Three properties of the format decide most of the design, so they come first.

**An archive stores file paths and nothing else.** There are no directory
records. A directory exists because some file's path contains it, which is why
a directory the user creates lives only in the tree and writes no bytes.

**The index table is derived, never edited.** It is a header, then one record
per entry giving an offset, a size and a name. You do not update it
independently: it is written from the entry set.

**There is no partial write.** Changing one entry shifts every offset after it,
so any change rewrites the whole file, through a temporary file that is renamed
over the original.

Entry names are stored with backslashes and matched case insensitively, which
is why the tree and the entry map are keyed case insensitively while keeping
the casing an entry was stored with.

---

## 2. The layers

```mermaid
flowchart TD
  VS["VS Code"]

  subgraph providers["providers - VS Code adapters"]
    FSP["fileSystemProvider"]
    TDP["treeDataProvider"]
    DND["dragAndDropController"]
    EXN["explorerNode"]
  end

  subgraph cmd["commands"]
    CC["commandCenter"]
    FC["fileCommands"]
    CLC["clipboardCommands"]
    EC["extractCommands"]
  end

  ACT["actions - fileActions"]
  UI["ui - dialogs"]

  subgraph model["model - owns the rules"]
    AM["archiveModel"]
    AR["archive"]
    VN["virtualNode"]
    NA["nodeAddress"]
    AS["archiveSource"]
  end

  subgraph plugins["plug-in surface"]
    TR["tools - toolRegistry"]
    FR["formats - formatRegistry"]
  end

  subgraph binary["binary - no vscode import"]
    AF["archiveFile"]
    BF["bigFormat"]
  end

  COM["common - paths, messages"]

  VS --> FSP & TDP & DND & CC
  CC --> FC & CLC & EC
  FC & CLC --> ACT
  DND --> ACT
  ACT --> UI
  ACT --> AM
  FSP & TDP --> AM
  EC --> AM
  FR --> AM
  FR --> TR
  AM --> AR & VN & NA & AS
  AR --> VN & AF
  AF --> BF
  ACT -.-> COM
  AM -.-> COM
```

The rule the arrows follow: **`binary` knows nothing about VS Code, `model`
knows nothing about commands or views, `common` knows nothing about this
extension at all.** Everything above the model works with nodes.

| directory | holds |
| --- | --- |
| `binary/` | the BIG file format: parse, serialize, read, write |
| `model/` | archives, the virtual tree, addressing, sources |
| `providers/` | the three VS Code adapters |
| `commands/` | what the palette and context menu invoke |
| `actions/` | operations shared by commands and drag and drop |
| `ui/` | prompts and confirmations |
| `tools/`, `formats/` | the plug-in surface |
| `common/` | generic helpers, no domain knowledge |

---

## 3. The data

```mermaid
classDiagram
  class ArchiveSource {
    +id: string
    +label: string
    +baseUri: Uri
  }

  class Archive {
    +archivePath: string
    +rootPath: string
    +sourceId: string
    +pathInSource: string
    +root: VirtualNode
    -entries: Map~string, BigFileEntry~
    -queue: Promise
    +ensureLoaded()
    +applyChanges(changes)
    +readFileNodes(items, onFile)
  }

  class VirtualNode {
    +name: string
    +type: FileType
    +entryPath: string
    +archive: Archive
    +parent: VirtualNode
    +children: Map~string, VirtualNode~
  }

  class BigFileEntry {
    +name: string
    +offset: number
    +size: number
    +pendingData: Uint8Array
    +pendingFile: string
  }

  class EntryChange {
    <<union>>
    put, remove, move, copy, addDirectory
  }

  ArchiveSource "1" --> "many" Archive : holds
  Archive "1" --> "1" VirtualNode : root
  Archive "1" --> "many" BigFileEntry : entries
  VirtualNode "1" --> "many" VirtualNode : children
  Archive ..> EntryChange : applies
```

**The entries own the content, the tree owns the structure.** A file appears in
both; a directory only in the tree. That is what lets a directory survive
losing its last file without anything tracking it separately, and it is why
the tree is mutated alongside the entries rather than rebuilt from them.

`pendingData` and `pendingFile` are how content that is not in the archive yet
travels to the writer: bytes held in memory, or a file on disk copied straight
across while the archive is written so it never passes through memory.

---

## 4. Addressing

The same entry has three names, and only one of them is stored.

| name | example | who uses it |
| --- | --- | --- |
| **entry path** *(stored)* | `data/ini/object.ini` | the index table, the entry map, the tree |
| node path *(rendered)* | `/bfme2/mods/textures.big/data/ini/object.ini` | tree row ids, tooltips, error messages |
| uri *(rendered)* | `bigfs:/bfme2/mods/textures.big/data/ini/object.ini` | VS Code only |

A node stores its `entryPath` and a reference to its `Archive`. Everything else
is derived, by `model/nodeAddress`:

```mermaid
flowchart LR
  subgraph stored["stored on the node"]
    EP["entryPath: data/ini/object.ini"]
    ARC["archive"]
  end

  subgraph archiveState["stored on the archive"]
    SRC["sourceId: bfme2"]
    PIS["pathInSource: mods/textures.big"]
  end

  EP --> RENDER["getNodePath"]
  ARC --> RENDER
  SRC --> ROOT["rootPath"]
  PIS --> ROOT
  ROOT --> RENDER
  RENDER --> URI["getNodeUri / getChildUri"]
  URI --> VSCODE["VS Code"]
  VSCODE -->|"a uri comes back"| PARSE["parseNodeUri"]
  PARSE -->|"longest matching root"| ARC2["archive + entryPath"]
```

Two consequences worth knowing:

- **A uri names its source first.** Two archives called `INI.big` in different
  folders have different paths, so neither can claim the other's entries.
- **Nothing outside `nodeAddress` takes an address apart.** `parseNodeUri` is
  the only parser, and it is reached only through the file system provider,
  which is the only place a uri arrives from outside.

---

## 5. Reading

Nothing is opened at startup. The scan lists what carries the extension, and an
archive is read when something needs it.

```mermaid
sequenceDiagram
  actor U as User
  participant TV as treeDataProvider
  participant AM as archiveModel
  participant AR as Archive
  participant BIN as binary

  Note over AM: activation
  AM->>AM: createWorkspaceSources
  AM->>AM: findFiles(**/*.big)
  AM->>AR: create, one per archive, nothing read
  Note over AM: tree is usable here

  U->>TV: expand an archive
  TV->>AM: loadArchiveOf(node)
  AM->>AR: ensureLoaded
  AR->>BIN: readArchiveIndexTable
  BIN-->>AR: magic + entries
  AR->>AR: syncFiles, entries into the tree
  AM-->>TV: changed, redraw this archive
  TV-->>U: rows, and the file count appears

  Note over AM: once quiet, read the rest ahead
  AM->>AR: ensureLoaded, one at a time, behind anything awaited
```

A file that carries the extension but is not an archive is dropped when reading
it says so, rather than by opening every candidate during the scan.

Reading content is a positional read: `openArchiveReader` keeps one handle open
so extracting a folder does not reopen the archive per entry.

---

## 6. Writing

Every mutation is described as changes and carried out by one runner. An
operation says *what changes*; nothing else.

```mermaid
flowchart TD
  CMD["a command or a drop"] --> ACT["actions: resolve conflicts, confirm"]
  ACT --> OP["archiveModel operation"]
  OP --> PLAN["a list of EntryChange"]
  PLAN --> APPLY["Archive.applyChanges"]

  subgraph runner["one sequence, in the archive's queue"]
    APPLY --> ENT["change the entries"]
    ENT --> NEED{"did the entries move?"}
    NEED -->|yes| WRITE["write the archive, temp file then rename"]
    NEED -->|no| SKIP["nothing on disk"]
    WRITE --> TREE["apply the same changes to the tree"]
    SKIP --> TREE
  end

  TREE --> EVENT["onDidChangeArchive"]
  EVENT --> TDP["tree redraws that archive"]
  EVENT --> FSP["file events, batched"]
```

The queue is per archive and shared with reads, so a reload triggered by the
watcher cannot land in the middle of a save.

| operation | changes | touches disk |
| --- | --- | --- |
| write a file | `put` | yes |
| create a directory | `addDirectory` | **no** |
| delete | `remove` | yes, unless nothing was stored |
| rename or move | `move` | yes |
| copy or duplicate | `copy` | yes |
| add files from disk | `put` per file, streamed | yes |

---

## 7. The plug-in surface

Two kinds of contribution, told apart by what they are allowed to know.

```mermaid
flowchart LR
  subgraph tools["tools - pure"]
    T1["decode a texture"]
    T2["parse a movie"]
    T3["encode an image"]
  end

  subgraph formats["formats - bound to archive and editor"]
    F1["open a dds"]
    F2["open an apt"]
  end

  CORE["model"]

  F1 --> T1
  F2 --> T2
  F2 --> T1
  F1 & F2 --> CORE
  CMDS["commands"] --> T3
```

| | tool | format |
| --- | --- | --- |
| answers | transform this data | open this entry |
| knows about archives | no | yes |
| knows about VS Code | no | yes |
| testable without a host | yes | no |

A tool is a pure function with an id. A format is handed a context that can
find a sibling by extension, list a directory, and read entries in a batch. It
gets a **reader**, not pre-resolved buffers, because a format cannot always
declare what it needs in advance: an `.apt` finds its `.const` and `.dat` by
name, then asks for textures it only discovers while parsing.

Both registries exist and are empty. Registering either is one line in
`extension.ts`.

**Not yet decided:** a format that needs its own viewer also needs a
`contributes.customEditors` entry in `package.json`, whose file pattern is
static. Either each format adds a manifest entry, or one editor registers at
`priority: "option"` so it is reachable through *Reopen With* without
hijacking anything.

---

## 8. Measurements

Taken against a real Battle for Middle-earth 2 install, 105 archives and
3.4 GB on disk.

| | |
| --- | --- |
| reading every index table | 174 ms total, 1.7 ms per archive |
| heap held for all 105 | 9.2 MB, 0.09 MB per archive |
| tree nodes across all of them | 41,049 |
| largest archive | `W3D.big`, 12,893 nodes |
| opening one file | 0.3 ms, independent of archive size |
| expanding a folder of 30,000 rows | 20 ms |

The lesson worth keeping: **archive size on disk says nothing about index
size.** 3.4 GB of BFME is textures and audio, not many files. Estimates made
from synthetic archives with tens of thousands of entries each were wrong by
more than an order of magnitude.

---

## 9. Decisions worth remembering

- **Node's `fs`, not `workspace.fs`, in `binary/`** — reading one entry out of
  a 2 GB archive needs a positional read, and `workspace.fs` can only read a
  whole file. The cost is that only local files work: a remote workspace has no
  path to open.
- **The tree is mutated, not rebuilt.** Rebuilding it from entries would lose
  every directory that holds no files, which is what a side table used to
  compensate for.
- **A node keeps its identity.** The tree view holds the elements it was
  handed, so refreshing one archive means firing the very root it already
  knows.
- **Errors are exceptions at the VS Code boundary**, because the provider API
  requires thrown `FileSystemError`s. Tagged errors such as `NotAnArchiveError`
  cover the cases callers branch on.
- **Mutation is confined by structure, not by interception.** Tree mutation
  happens only in `virtualNode`, entry mutation only in `archive`.

---

## 10. Still open

**Core**

- A plan targets one archive, so **cross archive move and copy** need the plan
  widened into a transaction over several. Ordering belongs in the runner:
  write the target before removing the source, so a failure leaves a duplicate
  rather than a hole.
- **The merged game view**: one index per source, entries resolved by load
  order, with the hover showing which archive wins. Needed before INI cross
  referencing, since a reference from a mod into the base game has to resolve.
- **Archives added by hand** from outside the workspace. The source layer takes
  this without changing: it is a source implementation, a command, and
  persistence.

**Plug-ins**

- `.dds` decoder and viewer, `.apt` parser and writer. The `.apt` tools depend
  on nothing here and can be written against fixtures whenever.
- Language support for `.ini` and `.inc`, which needs the merged view and a
  cache of parsed results keyed by archive version.

**Known gaps**

- Saving a large archive has no progress and cannot be cancelled.
- Every save rewrites the whole archive. Writing into free space and rewriting
  only the index would avoid it, at the cost of a compaction step.
- Drag and drop and the clipboard commands have no automated cover; neither is
  reachable through the extension host API the suite uses.
- Release: README and CHANGELOG are still scaffold text, there is no LICENSE or
  `license` field, no icon, and the publisher name is a guess.
