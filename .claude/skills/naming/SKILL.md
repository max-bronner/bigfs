---
name: naming
description: >-
  Naming, comment and JSDoc/TSDoc conventions for the bigFS codebase. Consult
  this before introducing or renaming any identifier - function, type,
  constant, class, file or directory - and before writing, editing or deleting
  any comment or doc comment. Use it when adding a feature, extracting a
  helper, reviewing a diff for readability, auditing or tidying comments,
  deciding whether something needs a doc comment or which TSDoc tags to use,
  or whenever you catch yourself writing a comment to explain what a name
  means. Also use it when asked to make code cleaner, more readable, or better
  organised, even if naming and comments are not mentioned.
---

# Naming and comments in this codebase

Naming and commenting are one skill, not two. Most bad comments exist to prop
up a name that is not carrying its weight, and most good names remove the need
for a comment. Judge them together.

The target is library-grade names: the kind that would not look out of place in
VS Code's own source. `extensions/git/src/` and `vs/workbench/.../fileActions.ts`
are the reference points. Read a nearby module before naming something new;
matching the neighbours matters more than any rule below.

## The one test that catches most mistakes

**If a name needs a comment to justify it, the name is wrong.** Fix the name
instead of adding the comment. When you write a doc comment and it mostly
restates the identifier, that is the signal.

A real example from this repo. This was written, reviewed, and deleted:

```ts
/**
 * Gets the key a name or path is matched by. Archives are case insensitive,
 * so the key is what lookups compare while the stored casing is displayed.
 */
export const toLookupKey = (text: string): string => text.toLowerCase();
```

Two failures at once. The comment exists because `toLookupKey` says nothing
about what the key *is*, and the function wraps a standard method behind a
domain word, so every reader has to jump to the definition to confirm it is not
doing something cleverer. The fix was to delete it and write `.toLowerCase()`
at the call sites.

**Do not wrap a standard method in a domain name.** If the body is one built-in
call, inline it. A wrapper earns its place when it holds a decision that could
change, not when it renames something everyone already knows.

## Cut words that carry no information

Every word in a name should exclude something. If removing a word excludes
nothing, remove it.

```ts
const KNOWN_MAGICS = new Set(['BIGF', 'BIG4']);   // "known" excludes nothing
const MAGICS = new Set(['BIGF', 'BIG4']);         // better
```

Worse, `KNOWN` quietly asserts the list is complete, which discourages adding to
it. Watch for qualifiers that smuggle in a claim: `known`, `valid`, `final`,
`real`, `actual`, `simple`.

Also drop: `Manager`, `Helper`, `Util`, `Handler`, `Data`, `Info`, `Object`.
They mark a place where the thing was never named. Say what it does:
`resolveConflicts`, not `conflictHelper`.

## Name a thing after what it is

```ts
class BigTreeNode extends TreeItem { … }   // it is not a node
class BigTreeItem extends TreeItem { … }   // it is a tree item
```

`VirtualNode` is the node in this codebase. A class extending `TreeItem` that
claimed to be a node put two different concepts under one word, which is the
expensive kind of mistake because it spreads.

## Use the vocabulary this project already has

Reusing the wrong word for an existing concept is the most common failure here,
because these look interchangeable and are not:

| term | means |
| --- | --- |
| **archive** | one `.big` file on disk |
| **entry** | one file stored inside an archive, as the index table records it |
| **entry path** | archive relative, no leading slash: `data/ini/object.ini` |
| **node** (`VirtualNode`) | a file or directory in the virtual tree |
| **node path** | starts with a slash and includes the archive: `/mods/x.big/data/a.ini` |
| **root** / **root path** | where an archive is mounted in the virtual file system |
| **source** | a place archives come from: the workspace, or an added folder |
| **plan** / **change** | a described mutation, before it is applied |
| **tool** | a pure transform, no archive and no editor |
| **format** | opens an entry, binds archive and editor together |

Before inventing a synonym, check whether one of these already names the idea.
If a genuinely new concept appears, add it to this table in the same commit.

## Shapes

- **Functions read as verb phrases**: `getParentPath`, `keepEmptiedDirectories`,
  `resolveConflicts`. A noun-only function name usually hides a verb.
- **Booleans read as questions**: `isPathBelow`, `hasEntriesBelow`,
  `canMoveInto`. Prefixes: `is`, `has`, `can`, `should`.
- **Predicates passed as arguments** keep the question form: `isConflicting`.
- **No abbreviations** except ones the domain already uses: `archivePath`, not
  `archPath`. `uri` and `id` are fine; `idx`, `cfg`, `res` are not.
- **Files are camelCase and named after their main export**: `archiveModel.ts`
  exports `ArchiveModel`. Directories are lowercase and plural when they hold
  peers: `commands/`, `providers/`, `tools/`.
- **Types are PascalCase, constants SCREAMING_SNAKE** only for module level
  literals like `HEADER_LENGTH`.

## Doc comments

**Every exported or public symbol carries a doc comment.** Functions, types,
interfaces, classes, public methods, exported constants. An API surface without
docs is not finished — the hover is where a caller learns what a thing is, and
leaving it empty pushes them into the body.

Private helpers are judged case by case: document one when it is doing
something a reader would not predict, skip it when the name and three lines of
body say everything.

### Open with what the thing is

The first sentence is a neutral, declarative description. It names the
*category* of thing and what it is for. It is not an answer to an implied
question, not a fragment, and not conversational.

This is the failure to watch for, because it reads fine until compared:

```ts
/**
 * What happened to an archive, and where it sits in the virtual file system.
 */
export interface ArchiveChange { … }
```

"What happened to an archive" answers a question nobody asked, and never says
what `ArchiveChange` *is* — a reader still does not know it is an event
payload. State the category:

```ts
/**
 * Event payload emitted by `ArchiveModel.onDidChangeArchive` when an archive
 * is added, changed or removed. Only a changed archive can be refreshed on its
 * own; adding or removing one changes the set of roots.
 */
export interface ArchiveChange { … }
```

The house openings, by kind:

| kind | opens with | example |
| --- | --- | --- |
| function | third-person verb | "Reads the index table…", "Applies the changes…" |
| boolean function | `Whether…` | "Whether a node sits below another" |
| interface / type | a noun phrase naming the category | "Event payload…", "A described mutation…", "One archive on disk…" |
| class | a noun phrase naming the role | "Tree data provider backing the archive explorer" |
| constant | what the value is and where it is used | "Glob the workspace scan and the watcher both match on" |
| factory | "Creates…" plus what the result is for | "Creates the registry `extension.ts` holds…" |

### Then add what the name cannot carry

After the opening sentence, add only a constraint, a reason, or a non-local
consequence — an invariant that depends on something elsewhere, a value from an
external format, a decision that looks wrong until you know why. If there is
nothing, stop after the first sentence. Most doc comments here are one line.

**When the opening line only restates the name, that is not a signal to delete
it — it is a signal that you have not said what kind of thing it is or what it
is for.** Go up a level and say that instead. Deleting leaves the next reader
with a bare signature.

### Implementation comments

`//` is for someone reading the body, and sits on the line it concerns. `/** */`
is for a caller who will never open the body. Getting this backwards hides a
caller-visible constraint inside the body, or pushes a local trick into every
hover.

Do not write a comment that restates the type, narrates the next line, or
explains what the previous version did ("anything containing BIG used to pass")
— that last one is a message to the reviewer and becomes a lie on merge.

### Tags

No types in tags, ever — `@param {string}` is a JavaScript habit and TypeScript
already said it. Reach for `@param` or `@returns` only when a parameter or
result carries a constraint the signature cannot state, and then only for the
one that needs it. `@throws` is worth it when a caller has to catch something
specific.

**Read `references/comments.md` before a comment audit, or when writing docs
for a whole file** — it has the per-kind templates, the failure modes, the tag
rules in full, and worked before-and-after examples from this repo.

## Renaming existing code

A rename is cheap to suggest and not always cheap to make, so separate the two.

Judge the name on its own merits first, by the questions below. Then weigh the
blast radius: a local `const` is free, an exported symbol touches every
importer, and a term from the vocabulary table is a change to how the whole
team talks — those belong in their own commit with the table updated in the
same breath.

When you find a name worth changing but are not doing the rename now, record it
rather than papering over it with a comment. A useful record names the symbol
and its file, what it is now and what it should be, why the current name
misleads, and how many call sites move. "Descriptive" wins over "short", but a
generic name that genuinely fits — `node`, `entry`, `path` in a context where
nothing else could be meant — is not a defect and should not be inflated.

## Before you commit a name

1. Would this name look out of place in VS Code's source?
2. Does every word exclude something?
3. Am I writing a comment because the name is not carrying its weight?
4. Does this concept already have a word in the table above?
5. Would a reader guess wrong about what it does?
