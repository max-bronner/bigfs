/**
 * Which INI values name a definition, decided per block and field.
 *
 * The generated schema's reference table is keyed by field name alone, which
 * is how mint's parse tables list them but is not how the engine reads: the
 * same `Image` names a mapped image in a command button and a cursor texture
 * in a `MouseCursor`. This file corrects that table the way `sageAudioFields`
 * does for sounds - by the last segment of the block's context name and the
 * field - and holds the three shapes the table cannot say:
 *
 * - fields that are not references at all, whatever block they sit in;
 * - fields that are references in some blocks only;
 * - fields whose value is several tokens of which only some name anything.
 *
 * It also says which names are one namespace. mint reads `Object`,
 * `ChildObject` and `ObjectReskin` as one template namespace (its
 * `OBJECT_KEYWORDS`, `crates/sage/ini/src/object.rs`), so a `ChildObject`
 * answers a reference to an `Object` and the other way round.
 *
 * This file knows nothing of the editor, so it runs in the unit tests.
 */

import { lastContextSegment } from './sageAudioFields';

/** The namespace the three object-defining keywords share */
export const OBJECT_NAMESPACE = 'Object';

const NAMESPACE_ALIASES: Record<string, string> = {
  childobject: OBJECT_NAMESPACE,
  objectreskin: OBJECT_NAMESPACE,
};

/** The namespace a block keyword or a table entry means, with aliases folded */
export const canonicalNamespace = (namespace: string): string =>
  NAMESPACE_ALIASES[namespace.toLowerCase()] ?? namespace;

/** Folds aliases and drops repeats, keeping the first spelling */
export const canonicalNamespaces = (
  namespaces: readonly string[],
): string[] => [...new Set(namespaces.map(canonicalNamespace))];

/**
 * Header keywords whose second value names the definition they inherit from:
 * `ChildObject Name Parent` and `ObjectReskin Name Parent`
 */
const PARENT_HEADERS: ReadonlySet<string> = new Set([
  'childobject',
  'objectreskin',
]);

/** The namespace the parent a header names is declared in, if it names one */
export const parentNamespace = (keyword: string): string | undefined =>
  PARENT_HEADERS.has(keyword.toLowerCase()) ? OBJECT_NAMESPACE : undefined;

/**
 * Fields no block gives a definition to, whatever the table says. Three are
 * flag lists the table filed under each flag word; `Filename` is an asset
 * file of the block that writes it.
 */
export const NOT_REFERENCE_FIELDS: ReadonlySet<string> = new Set([
  'filename',
  'armorsetflag',
  'geometryissmall',
  'shadowoverridelodvisibility',
]);

/**
 * Namespaces nothing declares: model condition flags and animation states are
 * values the engine matches by name, and a `ModelConditionState` block names
 * the flags it applies to rather than a definition
 */
export const NOT_REFERENCE_NAMESPACES: ReadonlySet<string> = new Set([
  'animationstate',
  'modelconditionstate',
]);

/**
 * Block and field to the namespaces the value names there; empty when the
 * field names nothing in that block. The block is the last segment of its
 * context's name, or a full path name when the field depends on the nesting.
 */
const SCOPED_REFERENCES: Record<string, readonly string[]> = {
  // EA's FXList.cpp parses a ParticleSystem nugget's Name as a particle system
  'fxlist > particlesystem/name': ['FXParticleSystem', 'ParticleSystem'],
  // The cursor's own texture, not a mapped image
  'mousecursor/image': [],
  // The auto-resolve tables are keyed by their own vocabulary: `Armor` and
  // `Weapon` there are not the file-scope `Armor` and `Weapon` definitions
  'autoresolvearmor/armor': [],
  'autoresolveweapon/weapon': [],
};

/**
 * Which tokens of a multi-token value name something, by zero based position,
 * for a field and (when a block makes the difference) a block. The other
 * tokens are not names: `ParticleSysBone = BONE01 FireSmall` gives a bone and
 * then the system attached to it.
 */
const REFERENCE_TOKENS: Record<string, readonly number[]> = {
  particlesysbone: [1],
};

/** Looks a field up by the full context name, then by its last segment */
const scoped = <T>(
  table: Record<string, T>,
  contextName: string,
  field: string,
): T | undefined => {
  const name = field.toLowerCase();

  return (
    table[`${contextName.toLowerCase()}/${name}`] ??
    table[`${lastContextSegment(contextName)}/${name}`]
  );
};

/** The namespaces a block corrects its field to, if it does */
export const scopedReference = (
  contextName: string,
  field: string,
): readonly string[] | undefined =>
  scoped(SCOPED_REFERENCES, contextName, field);

/**
 * Whether the value token at `index` of this field is where a name is
 * written. Every token is, for a field that does not say otherwise.
 */
export const namesTokenAt = (
  contextName: string,
  field: string,
  index: number,
): boolean => {
  const tokens =
    scoped(REFERENCE_TOKENS, contextName, field) ??
    REFERENCE_TOKENS[field.toLowerCase()];

  return tokens === undefined || tokens.includes(index);
};

/**
 * A word written in capitals with underscores: an enum value or a macro,
 * never a definition's name. Underscores may repeat (`FOO__BAR`), as macro
 * names do in the shipped data. Case sensitive on purpose: `HumanArmor` is a
 * name and `HUMAN_ARMOR` is not.
 */
export const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
