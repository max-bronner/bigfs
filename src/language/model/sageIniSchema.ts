/**
 * What the language support knows about the SAGE INI dialect, read from the
 * data file `scripts/buildSageSchema.mjs` generates.
 *
 * It answers three different questions, from three different sources:
 *
 * - **Does this keyword open a block?** Nothing in a line's syntax says so:
 *   `Body = ActiveBody Tag` opens one and `Armor = DEFAULT 100%` does not, and
 *   they are lexically identical. The engine decides from a compiled-in field
 *   table, so this holds the same table, observed from the shipped corpus.
 * - **Is this field engine defined, and what type is it?** From the engine
 *   dump, which is what lets a hover distinguish a field the engine reads from
 *   one that merely appears in the data.
 * - **What does this value point at?** From the field to namespace map, which
 *   is what makes go to definition possible.
 *
 * Every key is folded to lower case, because the dialect is case insensitive
 * throughout.
 */

/** Whether a keyword opens a block or holds a value, as the corpus recorded it */
export type KeywordKind = 'block' | 'field';

/** File scope, which is the context a root block is looked up in */
export const ROOT_CONTEXT = '<root>';

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

interface SchemaFile {
  version: number;
  game: string;
  slots: string[];
  contexts: Record<string, Record<string, 0 | 1>>;
  engineBlocks: string[];
  fields: Record<string, { t: string; u: 0 | 1 }>;
  references: Record<string, string[]>;
  slotTypes: Record<string, string[]>;
  enumValues: Record<string, string[]>;
  /** Folded keyword to the casing the corpus writes it with */
  casing: Record<string, string>;
}

/**
 * Query surface over the generated data file. Built once by
 * `createSageIniSchema` and held for the session, since it never changes.
 */
export interface SageIniSchema {
  /** Which game's engine dump the data was built from */
  readonly game: string;

  /**
   * Whether a keyword names a module slot, whose first value picks the
   * concrete type and with it the legal field set. `Behavior` alone spans 881
   * field names across 210 unrelated modules, so the type has to be part of
   * the context or nothing below it resolves.
   */
  isModuleSlot(keyword: string): boolean;

  /**
   * Classifies a keyword inside a context, or nothing when the corpus never
   * recorded it there. A miss is expected and never an error: the corpus shows
   * only what the data used, while the engine accepts more.
   */
  classify(context: string, keyword: string): KeywordKind | undefined;

  /** Builds the context a block's children are looked up in */
  childContext(keyword: string, moduleType?: string): string;

  /** What the engine dump says about a field name, if it names one */
  getEngineField(name: string): EngineField | undefined;

  /** Whether the engine dispatches on a block name at file scope */
  isEngineBlock(name: string): boolean;

  /**
   * The namespaces a field's value resolves into, widest first. Several fields
   * are polymorphic - `Sound` takes an `AudioEvent` or a `Multisound` - so a
   * caller tries each and only complains when none match.
   */
  getReferenceNamespaces(field: string): readonly string[];

  /**
   * The keywords legal inside a context, with what each one is. This is what
   * completion offers at the start of a line, and it is why completing inside
   * a `Behavior` needs the module type: the slot alone spans every module.
   */
  getContextKeywords(
    context: string,
  ): readonly { name: string; kind: KeywordKind }[];

  /** The module types observed after a slot, which complete its header */
  getSlotTypes(slot: string): readonly string[];

  /** The values observed on a field, which are its vocabulary */
  getEnumValues(field: string): readonly string[];
}

/**
 * Creates the query surface over a parsed data file. Throws when the file is a
 * version this build cannot read, which is worth failing loudly on: silently
 * treating every keyword as a field would fold and outline everything wrongly.
 */
export const createSageIniSchema = (parsed: unknown): SageIniSchema => {
  const file = parsed as SchemaFile;

  if (file?.version !== 3) {
    throw new Error(
      `Unsupported SAGE INI schema version: ${String(file?.version)}`,
    );
  }

  const slots = new Set(file.slots);
  const engineBlocks = new Set(
    file.engineBlocks.map((name) => name.toLowerCase()),
  );
  const { contexts, fields, references, slotTypes, enumValues } = file;

  // The tables are folded, so completion needs the casing back before it can
  // insert a keyword the way the corpus writes it
  const { casing } = file;

  const classify = (
    context: string,
    keyword: string,
  ): KeywordKind | undefined => {
    const key = keyword.toLowerCase();
    const entry = contexts[context.toLowerCase()]?.[key];

    if (entry !== undefined) {
      return entry === 1 ? 'block' : 'field';
    }

    // A module context falls back to its slot, which holds the fields every
    // module of that slot shares
    const separator = context.indexOf(':');

    if (separator > 0) {
      const slotEntry =
        contexts[context.slice(0, separator).toLowerCase()]?.[key];

      if (slotEntry !== undefined) {
        return slotEntry === 1 ? 'block' : 'field';
      }
    }

    return undefined;
  };

  return {
    game: file.game,
    isModuleSlot: (keyword) => slots.has(keyword.toLowerCase()),
    classify,
    childContext: (keyword, moduleType) =>
      moduleType && slots.has(keyword.toLowerCase())
        ? `${keyword}:${moduleType}`
        : keyword,
    getEngineField: (name) => {
      const entry = fields[name.toLowerCase()];

      return entry && { type: entry.t, used: entry.u === 1 };
    },
    isEngineBlock: (name) => engineBlocks.has(name.toLowerCase()),
    getReferenceNamespaces: (field) => references[field.toLowerCase()] ?? [],
    getContextKeywords: (context) =>
      Object.entries(contexts[context.toLowerCase()] ?? {}).map(
        ([name, kind]) => ({
          name: casing[name] ?? name,
          kind: kind === 1 ? 'block' : 'field',
        }),
      ),
    getSlotTypes: (slot) => slotTypes[slot.toLowerCase()] ?? [],
    getEnumValues: (field) => enumValues[field.toLowerCase()] ?? [],
  };
};
