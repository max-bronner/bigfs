/**
 * What the language support knows about the SAGE INI dialect, read from the
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

/** Whether a keyword opens a block or holds a value */
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

/** The game whose grammar applies, which differs in a few dozen names */
export type SageGame = 'bfme2' | 'rotwk';

/** Bit each game sets in a title mask */
const GAME_MASKS: Record<SageGame, number> = { bfme2: 1, rotwk: 2 };

/** What the engine dump records about a field name */
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

/** How a keyword reads in its context */
export interface KeywordResolution {
  kind: KeywordKind;
  /** For a block, the context its own lines are looked up in */
  childContext?: string;
  /** For a module slot such as `Behavior`, the module type its first value names */
  moduleType?: string;
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
  c: { k: string; m: number; t: ChildTarget }[];
}

interface SchemaFile {
  version: number;
  contexts: ContextData[];
  fileScope: Record<string, number>;
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

  /** The name of a context as completion and diagnostics show it */
  describeContext(context: string): string;

  /** Whether a keyword names a module slot, whose first value picks the module */
  isModuleSlot(keyword: string): boolean;

  /** Whether the engine reads a block of this name at file scope */
  isEngineBlock(name: string): boolean;

  /** What the engine dump says about a field name, if it names one */
  getEngineField(name: string): EngineField | undefined;

  /**
   * The namespaces a field's value resolves into, widest first. Several fields
   * are polymorphic - `Sound` takes an `AudioEvent` or a `Multisound` - so a
   * caller tries each and only complains when none match.
   */
  getReferenceNamespaces(field: string): readonly string[];

  /** The keywords legal in a context, with what each one is */
  getContextKeywords(
    context: string,
  ): readonly { name: string; kind: KeywordKind }[];

  /** The module types a slot accepts, which complete its header */
  getSlotTypes(slot: string): readonly string[];

  /** The engine values a field takes, which are its vocabulary */
  getEnumValues(field: string): readonly string[];
}

/** A map keyed by lowercased name, so lookups ignore casing */
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
  const references = foldKeys(file.references);
  const slotTypes = foldKeys(file.slotTypes);
  const enumValues = foldKeys(file.enumValues);

  /** Each context with this game's names folded for lookup */
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

  /**
   * Every block keyword and field name of any context, which is what an
   * `.inc` fragment may open with
   */
  const fragmentChildren = new Map(
    contexts.flatMap((context) => Array.from(context.children)),
  );
  const fragmentFields = new Set(
    contexts.flatMap((context) => Array.from(context.fields.keys())),
  );

  const moduleSlots = new Set(
    Array.from(fragmentChildren.values())
      .filter((child) => child.t === 'module')
      .map((child) => child.k.toLowerCase()),
  );

  const contextOf = (context: string) =>
    /^\d+$/.test(context) ? contexts[Number(context)] : undefined;

  const resolveChild = (
    child: ContextData['c'][number],
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
      return rootBlock === undefined
        ? undefined
        : { kind: 'block', childContext: String(rootBlock) };
    }

    if (context === FRAGMENT_CONTEXT) {
      if (rootBlock !== undefined) {
        return { kind: 'block', childContext: String(rootBlock) };
      }

      const child = fragmentChildren.get(key);

      if (child) {
        return resolveChild(child, values);
      }

      return fragmentFields.has(key) ? { kind: 'field' } : undefined;
    }

    const data = contextOf(context);

    if (!data) {
      return undefined;
    }

    const child = data.children.get(key);

    if (child) {
      return resolveChild(child, values);
    }

    return data.fields.has(key) || data.accepts ? { kind: 'field' } : undefined;
  };

  return {
    game,
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
    getReferenceNamespaces: (field) =>
      references.get(field.toLowerCase()) ?? [],
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
