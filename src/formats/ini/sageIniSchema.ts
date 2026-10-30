/**
 * Grammar of the SAGE INI dialect as the language support knows it, read from the
 * data file `scripts/buildSageSchema.mjs` generates from mint's field tables.
 *
 * It answers four questions:
 *
 * - **Does this keyword open a block, hold a value, or not belong here?**
 *   Nothing in a line's syntax says so: `Body = ActiveBody Tag` opens one and
 *   `Armor = DEFAULT 100%` does not. The engine decides from compiled-in field
 *   tables; this holds the same tables, extracted from the games' own editors,
 *   per context and per game.
 * - **Is this field engine defined, and what type is it?**
 * - **What does this value point at?** Which is what makes go to definition
 *   possible.
 * - **What may be written here?** Which is what completion offers.
 *
 * Names are matched without regard to casing, as the shipped data writes them.
 */

import {
  getAudioReferenceKind,
  isAudioNamespace,
  getKindNamespaces,
} from './sageAudioFields';
import {
  NOT_REFERENCE_FIELDS,
  NOT_REFERENCE_NAMESPACES,
  toCanonicalNamespace,
  toCanonicalNamespaces,
  widenParticleNamespaces,
  isNameTokenAt,
  getScopedNamespaces,
} from './sageReferenceFields';

/** Role a keyword plays: opening a block or holding a value */
export type KeywordKind = 'block' | 'field';

/** File scope of a `.ini` file, where only the engine's root blocks are legal */
export const ROOT_CONTEXT = '<root>';

/**
 * File scope of an `.inc` fragment, which is pasted inside a block of
 * whichever file includes it, so any block or field of any context may open it
 */
export const FRAGMENT_CONTEXT = '<fragment>';

/**
 * Children of a block the grammar holds no table for, such as a module type it
 * does not know. Nothing below it is checked.
 */
export const UNCHECKED_CONTEXT = '<unchecked>';

/**
 * The game whose grammar applies. BFME II and Rise of the Witch-king differ
 * in a few dozen names; BFME has no extracted grammar of its own, so it is
 * read with every name either later game accepts, and unknown names are not
 * reported.
 */
export type SageGame = 'bfme1' | 'bfme2' | 'rotwk';

/** The title mask each game reads names under */
const GAME_MASKS: Record<SageGame, number> = { bfme1: 3, bfme2: 1, rotwk: 2 };

/** Engine dump record of a field name: its type and whether it is still read */
export interface EngineField {
  /**
   * The engine's own type. `Coord3D` and `Color` are the two that change how a
   * value is read: they carry keyed components such as `X:0 Y:0 Z:5` and
   * `R:255 G:255 B:255` rather than a bare token.
   */
  type: string;
  /** Whether any engine table still reads it, or it is a leftover */
  used: boolean;
}

/** Resolution of a keyword in its context: its kind, and where a block's lines are looked up */
export interface KeywordResolution {
  kind: KeywordKind;
  /** For a block, the context its own lines are looked up in */
  childContext?: string;
  /** For a module slot such as `Behavior`, the module type its first value names */
  moduleType?: string;
  /**
   * Set for a file-scope block the games do not read at all. It is still a
   * block, so its lines nest right, but nothing in it is checked.
   */
  isLegacy?: boolean;
}

/** Where a nested block's lines are looked up: a context, one per first value, or the module named */
type ChildTarget = number | Record<string, number> | 'module';

interface ContextData {
  /** Name, as the path the generator first reached it by */
  n: string;
  /** Field names with the title mask of the games that accept each */
  f: [string, number][];
  /** Title mask of the games that accept any field here */
  w: number;
  /** Keywords that open a nested block */
  c: ChildData[];
}

interface ChildData {
  k: string;
  m: number;
  t: ChildTarget;
  /**
   * The first value the line must carry to open a block. Any other value
   * leaves the keyword a field: `AddEmotion = OVERRIDE Name` defines an
   * emotion inline, `AddEmotion = Name` only names one.
   */
  a?: string;
}

interface SchemaFile {
  version: number;
  contexts: ContextData[];
  fileScope: Record<string, number>;
  /** File-scope keywords that are one-line records with no `End` */
  fileLeaves?: Record<string, number>;
  /** File-scope blocks no game reads, such as Generals' flat `ParticleSystem` */
  fileLegacy?: string[];
  modules: Record<string, number>;
  fields: Record<string, { t: string; u: 0 | 1 }>;
  references: Record<string, string[]>;
  slotTypes: Record<string, string[]>;
  enumValues: Record<string, string[]>;
}

/**
 * Query surface over the generated data file for one game. Built once by
 * `createSageIniSchema` and held for the session.
 */
export interface SageIniSchema {
  readonly game: SageGame;

  /**
   * Whether the grammar is the game's own, so a name it does not hold is a
   * mistake worth reporting. False for BFME, read with the later games'
   * grammar.
   */
  readonly isStrict: boolean;

  /**
   * Resolves a keyword in its context, or nothing when the keyword does not
   * belong there. `values` are the line's values, whose first one picks the
   * table of a typed block and the module of a module slot.
   */
  resolve(
    context: string,
    keyword: string,
    values: readonly string[],
  ): KeywordResolution | undefined;

  /** Whether lines in a context are checked against the grammar at all */
  isChecked(context: string): boolean;

  /** Describes a context by the name completion and diagnostics show */
  describeContext(context: string): string;

  /** Whether a keyword names a module slot, whose first value picks the module */
  isModuleSlot(keyword: string): boolean;

  /** Whether the engine reads a block of this name at file scope */
  isEngineBlock(name: string): boolean;

  /** Gets what the engine dump says about a field name, if it names one */
  getEngineField(name: string): EngineField | undefined;

  /**
   * Gets the namespaces a field's value names, widest first. Several fields
   * are polymorphic - `Sound` takes an `AudioEvent` or a `Multisound` - so a
   * caller tries each and only complains when none match. With the context
   * the field sits in, a field whose meaning depends on its block is resolved
   * too: `Name` names a particle system in an FX list's `ParticleSystem`
   * nugget and a sound in its `Sound` one.
   */
  getReferenceNamespaces(
    field: string,
    context?: string,
    tokenIndex?: number,
  ): readonly string[];

  /**
   * Whether some reference field names this kind of definition, which is
   * what makes a block of that kind written inside another block a
   * definition too (a `Region` inside a campaign)
   */
  isReferenceNamespace(namespace: string): boolean;

  /** Lists the keywords legal in a context, with the kind of each */
  getContextKeywords(
    context: string,
  ): readonly { name: string; kind: KeywordKind }[];

  /** Lists the module types a slot accepts, which complete its header */
  getSlotTypes(slot: string): readonly string[];

  /** Lists the engine values a field takes, which are its vocabulary */
  getEnumValues(field: string): readonly string[];
}

/** Creates a map keyed by lowercased name, so lookups ignore casing */
const foldKeys = <T>(record: Record<string, T>): Map<string, T> =>
  new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  );

/**
 * Creates the query surface over a parsed data file for one game. Throws when
 * the file is a version this build cannot read, which is worth failing loudly
 * on: silently reading every keyword as unknown would flag every line.
 */
export const createSageIniSchema = (
  parsed: unknown,
  game: SageGame = 'rotwk',
): SageIniSchema => {
  const file = parsed as SchemaFile;

  if (file?.version !== 4) {
    throw new Error(
      `Unsupported SAGE INI schema version: ${String(file?.version)}`,
    );
  }

  const mask = GAME_MASKS[game];
  const fileScope = foldKeys(file.fileScope);
  const modules = foldKeys(file.modules);
  const fields = foldKeys(file.fields);
  const references = new Map<string, readonly string[]>(
    [...foldKeys(file.references)].flatMap(([field, namespaces]) => {
      const kept = widenParticleNamespaces(
        toCanonicalNamespaces(
          namespaces.filter(
            (namespace) =>
              !NOT_REFERENCE_NAMESPACES.has(namespace.toLowerCase()),
          ),
        ),
      );

      return NOT_REFERENCE_FIELDS.has(field) || !kept.length
        ? []
        : [[field, kept] as const];
    }),
  );
  const referenceNamespaces = new Set(
    [...references.values()]
      .flat()
      .filter((namespace) => !isAudioNamespace(namespace))
      .map((namespace) => namespace.toLowerCase()),
  );
  const slotTypes = foldKeys(file.slotTypes);
  const enumValues = foldKeys(file.enumValues);

  // Each context with this game's names folded for lookup
  const contexts = file.contexts.map((context) => ({
    name: context.n,
    accepts: context.w & mask,
    fields: new Map(
      context.f
        .filter(([, fieldMask]) => fieldMask & mask)
        .map(([name]) => [name.toLowerCase(), name]),
    ),
    children: new Map(
      context.c
        .filter((child) => child.m & mask)
        .map((child) => [child.k.toLowerCase(), child]),
    ),
  }));

  type Context = (typeof contexts)[number];

  // An `.inc` fragment is pasted inside a block of whichever file includes it,
  // so a keyword it opens with can mean a different block in each context
  // that has one: `Region` is a campaign's region in two of them, and a
  // `Connection` inside it names a region rather than opening one. The
  // fragment cannot say which, so the block is read as the union of every
  // candidate, and a name any of them accepts is accepted.
  const mergedIds = new Map<string, number>();

  const mergeContexts = (ids: readonly number[]): number => {
    const unique = Array.from(new Set(ids)).sort((a, b) => a - b);

    if (unique.length === 1) {
      return unique[0];
    }

    const key = unique.join(',');
    const known = mergedIds.get(key);

    if (known !== undefined) {
      return known;
    }

    const members = unique.map((id) => contexts[id]);
    const merged: Context = {
      name: members[0].name,
      accepts: members.reduce((all, member) => all | member.accepts, 0),
      fields: new Map(members.flatMap((member) => Array.from(member.fields))),
      children: new Map(),
    };
    const id = contexts.push(merged) - 1;

    // Registered before the children are merged, so a cycle finds itself
    mergedIds.set(key, id);

    const byKeyword = new Map<string, ChildData[]>();

    members
      .flatMap((member) => Array.from(member.children))
      .forEach(([name, child]) => {
        byKeyword.set(name, [...(byKeyword.get(name) ?? []), child]);
      });

    byKeyword.forEach((children, name) => {
      const [first] = children;
      const numeric = children.every((child) => typeof child.t === 'number');

      merged.children.set(
        name,
        numeric && children.length > 1
          ? {
              ...first,
              t: mergeContexts(children.map((child) => child.t as number)),
            }
          : first,
      );
    });

    return id;
  };

  // Every block keyword and field name of any context, which is what an
  // `.inc` fragment may open with. A keyword several contexts open keeps all
  // of them, so the fragment can pick the union rather than the last one read.
  const fragmentCandidates = new Map<string, ChildData[]>();

  contexts.forEach((context) =>
    context.children.forEach((child, name) =>
      fragmentCandidates.set(name, [
        ...(fragmentCandidates.get(name) ?? []),
        child,
      ]),
    ),
  );

  const fragmentFields = new Set(
    contexts.flatMap((context) => Array.from(context.fields.keys())),
  );
  const fileLeaves = foldKeys(file.fileLeaves ?? {});
  const fileLegacy = new Set(
    (file.fileLegacy ?? []).map((name) => name.toLowerCase()),
  );

  fileLeaves.forEach((_, name) => fragmentFields.add(name));

  const moduleSlots = new Set(
    Array.from(fragmentCandidates.values())
      .flat()
      .filter((child) => child.t === 'module')
      .map((child) => child.k.toLowerCase()),
  );

  const contextOf = (context: string) =>
    /^\d+$/.test(context) ? contexts[Number(context)] : undefined;

  const opensBlock = (child: ChildData, values: readonly string[]): boolean =>
    child.a === undefined || values[0]?.toUpperCase() === child.a;

  const resolveChild = (
    child: ChildData,
    values: readonly string[],
  ): KeywordResolution => {
    const [first] = values;

    if (child.t === 'module') {
      const id =
        first === undefined ? undefined : modules.get(first.toLowerCase());

      return {
        kind: 'block',
        moduleType: first,
        childContext: id === undefined ? UNCHECKED_CONTEXT : String(id),
      };
    }

    if (typeof child.t === 'number') {
      return { kind: 'block', childContext: String(child.t) };
    }

    const id = first === undefined ? undefined : child.t[first];

    return {
      kind: 'block',
      childContext: id === undefined ? UNCHECKED_CONTEXT : String(id),
    };
  };

  const resolve = (
    context: string,
    keyword: string,
    values: readonly string[],
  ): KeywordResolution | undefined => {
    const key = keyword.toLowerCase();
    const rootBlock = fileScope.get(key);

    if (context === ROOT_CONTEXT) {
      if (rootBlock !== undefined) {
        return { kind: 'block', childContext: String(rootBlock) };
      }

      if (fileLegacy.has(key)) {
        return {
          kind: 'block',
          childContext: UNCHECKED_CONTEXT,
          isLegacy: true,
        };
      }

      return fileLeaves.has(key) ? { kind: 'field' } : undefined;
    }

    if (context === FRAGMENT_CONTEXT) {
      if (rootBlock !== undefined) {
        return { kind: 'block', childContext: String(rootBlock) };
      }

      const opening = (fragmentCandidates.get(key) ?? []).filter((candidate) =>
        opensBlock(candidate, values),
      );

      if (opening.length) {
        const resolved = opening.map((candidate) =>
          resolveChild(candidate, values),
        );
        const targets = resolved.map(({ childContext }) => childContext ?? '');

        // Candidates that open different blocks are read as their union
        if (
          new Set(targets).size > 1 &&
          targets.every((target) => /^\d+$/.test(target))
        ) {
          return {
            ...resolved[0],
            childContext: String(mergeContexts(targets.map(Number))),
          };
        }

        return resolved[0];
      }

      return fragmentFields.has(key) || fragmentCandidates.has(key)
        ? { kind: 'field' }
        : undefined;
    }

    const data = contextOf(context);

    if (!data) {
      return undefined;
    }

    const child = data.children.get(key);

    if (child && opensBlock(child, values)) {
      return resolveChild(child, values);
    }

    return data.fields.has(key) || data.accepts ? { kind: 'field' } : undefined;
  };

  return {
    game,
    isStrict: game !== 'bfme1',
    resolve,
    isChecked: (context) =>
      context === ROOT_CONTEXT ||
      context === FRAGMENT_CONTEXT ||
      Boolean(contextOf(context)),
    describeContext: (context) => contextOf(context)?.name ?? context,
    isModuleSlot: (keyword) => moduleSlots.has(keyword.toLowerCase()),
    isEngineBlock: (name) => fileScope.has(name.toLowerCase()),
    getEngineField: (name) => {
      const entry = fields.get(name.toLowerCase());

      return entry && { type: entry.t, used: entry.u === 1 };
    },
    getReferenceNamespaces: (field, context, tokenIndex) => {
      const contextName =
        context === undefined ? '' : (contextOf(context)?.name ?? context);
      const kind = getAudioReferenceKind(contextName, field);

      if (kind) {
        return getKindNamespaces(kind);
      }

      if (
        tokenIndex !== undefined &&
        !isNameTokenAt(contextName, field, tokenIndex)
      ) {
        return [];
      }

      // The table carries sound fields of its own, which name `AudioEvent`
      // alone; whatever audioReferenceKind does not recognise is no sound
      const scoped = getScopedNamespaces(contextName, field);

      return scoped
        ? toCanonicalNamespaces(scoped)
        : (references
            .get(field.toLowerCase())
            ?.filter((namespace) => !isAudioNamespace(namespace)) ?? []);
    },
    isReferenceNamespace: (namespace) =>
      referenceNamespaces.has(toCanonicalNamespace(namespace).toLowerCase()),
    getContextKeywords: (context) => {
      if (context === ROOT_CONTEXT) {
        return Object.keys(file.fileScope).map((name) => ({
          name,
          kind: 'block' as const,
        }));
      }

      const data = contextOf(context);

      if (!data) {
        return [];
      }

      return [
        ...Array.from(data.children.values(), (child) => ({
          name: child.k,
          kind: 'block' as const,
        })),
        ...Array.from(data.fields)
          .filter(([key]) => !data.children.has(key))
          .map(([, name]) => ({ name, kind: 'field' as const })),
      ];
    },
    getSlotTypes: (slot) =>
      slotTypes.get(slot.toLowerCase()) ?? Object.keys(file.modules),
    getEnumValues: (field) => enumValues.get(field.toLowerCase()) ?? [],
  };
};
