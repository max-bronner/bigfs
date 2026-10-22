# Comments and doc comments

The detail behind the Doc comments section of `SKILL.md`. Read this when
writing docs across a whole file, or auditing them.

## Contents

- [Coverage: what gets a doc comment](#coverage-what-gets-a-doc-comment)
- [The opening sentence](#the-opening-sentence)
- [Templates by kind](#templates-by-kind)
- [What goes after the opening](#what-goes-after-the-opening)
- [The two kinds of comment](#the-two-kinds-of-comment)
- [Tags](#tags)
- [Failure modes](#failure-modes)
- [Length and form](#length-and-form)
- [Worked examples from this repo](#worked-examples-from-this-repo)
- [The audit checklist](#the-audit-checklist)

## Coverage: what gets a doc comment

**Every exported or public symbol.** Exported functions, types, interfaces,
classes, public methods, exported constants. No exceptions for "obvious" ones —
obvious to the person who just wrote it is not obvious on hover six months
later, and a half-documented API surface is worse than a consistently
documented one because the gaps read as oversights.

**Private helpers: case by case.** Document one when it does something a reader
would not predict from the name, when it holds a constraint, or when it is long
enough that the body is not a quick read. Skip it for a three-line helper whose
name says everything.

**Interface and class members** get a doc line when the field name leaves a
question open — units, what an empty value means, what sets it and when. A
field like `name: string` on a node needs nothing; `lastWrittenAt: number`
needs to say it is an mtime and what zero means.

Do not pad to hit coverage. If you genuinely cannot say more than the name
says, the problem is usually that you have not named the *category* of the
thing — see below.

## The opening sentence

The first sentence is a **neutral, declarative description**: what the thing is
and what it is for. Three properties:

**It names the category.** A reader should learn from the first four words
whether this is an event payload, a factory, a predicate, a description of a
pending mutation, or a thing that exists on disk.

**It is declarative, not interrogative.** "What happened to an archive…" and
"Whether or not we should…" framings read as answers to an implied question and
leave the subject unstated. The exception is a boolean function, where
`Whether…` is the established idiom and does name the thing (the condition).

**It is a statement about the symbol, not about the reader or the code.** Not
"You can use this to…", not "This function will…", not "Here we…". Start with
the verb or the noun.

## Templates by kind

| kind | opens with | example |
| --- | --- | --- |
| function | third-person verb | `Reads the index table, once, however many callers ask for it` |
| boolean function | `Whether…` | `Whether a node sits below another` |
| interface / type | noun phrase naming the category | `Event payload emitted by …`, `A described mutation, before it is applied` |
| union type | noun phrase plus what distinguishes the members | `Where the content of a written entry comes from` |
| class | noun phrase naming the role | `One archive on disk: the entries read from its index table, …` |
| exported constant | what the value is and where it is used | `Glob the workspace scan and the watcher both match on` |
| factory | `Creates…` plus what the result is for | `Creates the registry `extension.ts` holds for the life of the session` |
| method | third-person verb, from the caller's side | `Applies changes to the entries and the tree together` |
| field | what it holds, and what an absent or zero value means | `Unset on the archive itself, which is the top of its tree` |

## What goes after the opening

Only a constraint, a reason, or a consequence that is not visible locally:

- **A constraint the signature cannot state.** "Must be called after
  `ensureLoaded`." "The unit has to pluralise with a trailing `s`."
- **A reason the code looks wrong without.** "Written first so a failure leaves
  a duplicate rather than a hole."
- **A non-local consequence.** "The tree view holds on to the root it was
  handed, so rebuilding has to keep it."
- **A fact from outside the code.** A number from the binary format, a quirk of
  the VS Code API.
- **What distinguishes this from a near neighbour.** When two functions could
  be confused, say which is which.

If none apply, stop after the opening sentence. Most doc comments here are one
line, and that is the target, not a compromise.

## The two kinds of comment

Google's TypeScript style guide draws the line this codebase follows:

> Use `/** JSDoc */` comments for documentation, i.e. comments a user of the
> code should read. Use `//` line comments for implementation comments, i.e.
> comments that only concern the implementation of the code itself.

A question about audience, not length. Would a caller who never opens the body
need this? Then it is a doc comment and belongs above the declaration, where
the editor surfaces it. Does it only matter to someone reading the body? Then
it is a `//` on the line it concerns.

Multi-line implementation comments use several `//` lines, not `/* */`.

## Tags

TSDoc is the standard vocabulary, and its tags are the only ones to reach for.

**Never write a type in a tag.** `@param {string} name` is a JavaScript idiom.
TypeScript already states the type, and a hand-written one goes stale silently.

**`@param` and `@returns` are for when the prose cannot carry it.** In a
codebase of small, well-named functions they usually restate the signature:

```ts
/**
 * Gets the parent path.
 * @param nodePath - The node path
 * @returns The parent path
 */
```

Three lines of tags saying what the signature says. Prefer one declarative
line. Use `@param` only when a parameter carries a constraint or unit its name
and type do not — a value that must already be lowercased, a path that must be
absolute, a millisecond count — and document only that parameter. TSDoc does
not require completeness, and a partial block that says something beats a full
block that says nothing.

Use `@returns` only when the result needs a caveat the description could not
hold, such as what an empty result means when that is not obvious.

**Worth using:** `@throws` when a caller has to catch something specific, such
as `NotAnArchiveError`. `@deprecated` with a pointer to the replacement.
`@example` for a helper whose shape is hard to picture — rare, and short.

**Leave alone:** `@public`, `@private`, `@readonly`, `@override`. TypeScript
has real keywords, and a tag that disagrees with the keyword is worse than
nothing.

## Failure modes

The first three are fixed by **rewriting the opening sentence**, not by
deleting the comment. The last three are fixed by deleting or correcting.

1. **Interrogative or conversational opening.** "What happened to an archive…",
   "Here we build…", "You can use this to…". Rewrite to name the category.
2. **Restates the name and nothing more.** `/** Gets the parent path */` over
   `getParentPath`. This means the category and purpose are still unstated —
   go up a level and say what kind of thing it is and what it is for. Deleting
   leaves a bare signature, which is worse.
3. **Missing entirely on an exported symbol.** The most common defect in this
   repo. Write one.
4. **Restates the type.** "Returns a string", "takes an optional array".
   Delete that clause.
5. **Narrates the next line, or describes a previous version.** "Loop over the
   entries." "Anything containing BIG used to pass." Delete.
6. **Has drifted.** Names a renamed parameter, a deleted function, changed
   behaviour. Correct it against the code as it stands — a wrong comment costs
   more than a missing one, because it is believed.

## Length and form

One line is the default. Three is already long. Past four lines it is usually a
design decision that belongs in `docs/architecture.md`, a name that needs
fixing, or two comments that should sit on the two declarations they describe.

Use the one-line form `/** … */` when it fits; expand to the block form only
when it does not.

Sentence case. No trailing period on a single-sentence fragment, normal
punctuation on multi-sentence comments — that is the prevailing style here, and
consistency matters more than the choice.

Markdown renders in the editor: backticks for identifiers, hyphens for lists.
Link to the symbol a reader should look at next — `` `ArchiveModel.onDidChangeArchive` ``
in a payload's doc pays for itself.

## Worked examples from this repo

**Interrogative opening, category never stated.** `model/archiveModel.ts`:

```ts
/**
 * What happened to an archive, and where it sits in the virtual file system.
 * Only a changed archive can be refreshed on its own; adding or removing one
 * changes the set of roots.
 */
export interface ArchiveChange { … }
```

The second sentence is good — it is a real consequence. The first never says
this is the payload of an event, which is the one thing a reader needs:

```ts
/**
 * Event payload emitted by `ArchiveModel.onDidChangeArchive` when an archive
 * is added, changed or removed. Only a changed archive can be refreshed on its
 * own; adding or removing one changes the set of roots.
 */
```

**Restating the name in the expensive form.** `common/paths.ts`:

```ts
/**
 * Splits a path into its non-empty segments
 */
export const splitPath = (nodePath: string): string[] => …
```

Three lines to say the name again. Keep the verb opening, and make the second
half carry the fact a caller needs:

```ts
/** Splits a path into segments, dropping empty ones so a leading slash costs nothing */
```

**A comment that is a rename in disguise.** Written, reviewed, and deleted:

```ts
/**
 * Gets the key a name or path is matched by. Archives are case insensitive,
 * so the key is what lookups compare while the stored casing is displayed.
 */
export const toLookupKey = (text: string): string => text.toLowerCase();
```

Here deleting *was* right, because the fix was deleting the function — it
wrapped a built-in behind a domain word. That is the one case where a
name-restating comment means "remove the code", and it is rare. Do not
generalise it into deleting comments off symbols that are staying.

**A doc doing real work.** `model/archiveSource.ts`:

```ts
/** Short and stable, only needed when two folders share a name */
const toSuffix = (text: string): string => …
```

Nothing in the signature says when this is called or why it is a hash rather
than a counter.

**An implementation comment in the right place.** `model/archiveModel.ts`:

```ts
if (!source) {
  return; // outside every source, so not ours to show
}
```

A caller does not need this; someone reading the early return does, because a
bare `return` otherwise looks like an oversight.

## The audit checklist

Per exported or public symbol:

1. Is there a doc comment at all? If not, write one.
2. Does the opening sentence name what kind of thing this is and what it is
   for? If it only restates the name, rewrite it — do not delete it.
3. Is it declarative, third-person, and about the symbol?
4. Is everything in it still true of the code as it stands?
5. Does it restate a type, narrate the next line, or describe a past version?
   Cut those clauses.
6. Could it be one line instead of three?
7. Is it compensating for a bad name? Record the rename.

Per file, once the symbols are covered: are there body-level decisions that
look like oversights — an early return, an empty disposable, a field set and
never cleared — with no `//` explaining them?
