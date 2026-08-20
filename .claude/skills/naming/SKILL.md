---
name: naming
description: >-
  Naming and comment conventions for the bigFS codebase. Consult this before
  introducing or renaming any identifier - function, type, constant, class,
  file or directory - and before writing a doc comment. Use it when adding a
  feature, extracting a helper, reviewing a diff for readability, or whenever
  you catch yourself writing a comment to explain what a name means. Also use
  it when asked to make code cleaner, more readable, or better organised, even
  if naming is not mentioned.
---

# Naming in this codebase

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

## Comments

Names carry the *what*. Comments carry only what a name cannot: a constraint, a
reason, a consequence that is not visible locally.

Write a comment when:

- an invariant depends on something elsewhere — "the tree view holds on to the
  root it was handed, so rebuilding has to keep it"
- a value comes from an external format — "16 bytes total"
- a decision looks wrong until you know why — "written first so a failure leaves
  a duplicate rather than a hole"

Do not write a comment that:

- restates the name — `/** Gets the parent path */` above `getParentPath`
- explains what the previous version did — "anything containing BIG used to
  pass". That is a message to the reviewer, and it is noise the moment it merges
- narrates the next line

Keep them short. One line is the default; three is already long. A doc comment
that runs to four lines is usually describing a design decision that belongs in
`docs/`, or a name that needs fixing.

## Before you commit a name

1. Would this name look out of place in VS Code's source?
2. Does every word exclude something?
3. Am I writing a comment because the name is not carrying its weight?
4. Does this concept already have a word in the table above?
5. Would a reader guess wrong about what it does?
