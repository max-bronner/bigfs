import type { Uri } from 'vscode';
import type { SuggestionOption } from '../../game/apt/suggestionKinds';
import type { HeroSystem } from '../../game/objects/cahSystem';
import { readDefinitionFields, readFields } from './aptDefinitionFields';
import type { DefinitionFields, ReadText, SuggestionIndex } from './aptDefinitionFields';

/** Objects composed with their parents for one list, so a list costs a bounded number of file parses */
const MAX_COMPOSED = 200;

/** An object with its parents' fields composed, as the effective object view shows it */
export type ComposeObject = (uri: Uri, line: number) => Promise<string | undefined>;

const INHERITING = /^(childobject|objectreskin)$/i;

const namesHero = (kindOf: string): boolean => /(^|\s)HERO(\s|$)/i.test(kindOf);

/** Whether a `KindOf` line replaces the inherited set rather than editing it with `+` and `-` */
const replacesKinds = (kindOf: string): boolean => !/(^|\s)[+-]/.test(kindOf);

/** Adds a value to a list of options once, whatever its casing, noting the objects that use it */
const collect = (
  found: Map<string, { value: string; objects: string[] }>,
  value: string | undefined,
  object: string,
): void => {
  if (value && !/^none$/i.test(value)) {
    const entry = found.get(value.toLowerCase()) ?? { value, objects: [] };

    entry.objects.push(object);
    found.set(value.toLowerCase(), entry);
  }
};

const toOptions = (
  found: Map<string, { value: string; objects: string[] }>,
): SuggestionOption[] =>
  [...found.values()]
    .sort((a, b) => a.value.localeCompare(b.value))
    .map(({ value, objects }) => ({
      value,
      label: objects.slice(0, 3).join(', '),
    }));

/**
 * The `SelectPortrait` of every object, each once. A child object that writes
 * none shows its parent's, which the parent already lists, so the set is the
 * same as the composed objects' without composing any.
 */
export const readUnitPortraits = async (
  index: SuggestionIndex,
  read: ReadText,
): Promise<SuggestionOption[]> => {
  const found = new Map<string, { value: string; objects: string[] }>();

  for (const { definition, fields } of await readDefinitionFields(index, 'Object', read)) {
    collect(found, fields.get('selectportrait'), definition.name);
  }
  return toOptions(found);
};

/** Whether what a child object writes leaves its place in the hero row to what its parents write */
const needsParents = ({ definition, fields }: DefinitionFields): boolean => {
  const kindOf = fields.get('kindof');
  const hasImage = fields.has('buttonimage');

  if (!INHERITING.test(definition.keyword)) {
    return false;
  }
  if (kindOf !== undefined && replacesKinds(kindOf)) {
    return namesHero(kindOf) && !hasImage;
  }
  return hasImage || kindOf !== undefined;
};

/**
 * The `ButtonImage` of every object with `KindOf HERO`, the hero row's
 * portrait. An object that says both itself is read as written; a child that
 * leaves one to its parents is composed with them, up to a bound.
 */
export const readHeroImages = async (
  index: SuggestionIndex,
  read: ReadText,
  compose: ComposeObject,
): Promise<SuggestionOption[]> => {
  const found = new Map<string, { value: string; objects: string[] }>();
  let composed = 0;

  for (const object of await readDefinitionFields(index, 'Object', read)) {
    const { definition } = object;
    let fields = object.fields;

    if (needsParents(object) && composed < MAX_COMPOSED) {
      composed++;

      const text = await compose(definition.uri, definition.line).catch(() => undefined);

      fields = text ? readFields(text.split(/\r?\n/)) : fields;
    }

    const kindOf = fields.get('kindof');

    if (kindOf && replacesKinds(kindOf) && namesHero(kindOf)) {
      collect(found, fields.get('buttonimage'), definition.name);
    }
  }
  return toOptions(found);
};

const iconOptions = (
  icons: readonly { image?: string; label: string }[],
): SuggestionOption[] =>
  icons.flatMap(({ image, label }) => (image ? [{ value: image, label }] : []));

/** The `IconImage` of every create-a-hero class, in the order the class screen lists them */
export const readClassIcons = (system: HeroSystem | undefined): SuggestionOption[] =>
  iconOptions(
    (system?.classes ?? []).map((each, at) => ({
      image: each.iconImage,
      label: `class ${at}${each.nameTag ? `: ${each.nameTag}` : ''}`,
    })),
  );

/** The `IconImage` of every subclass of every class, in the order the class screen lists them */
export const readTypeIcons = (system: HeroSystem | undefined): SuggestionOption[] =>
  iconOptions(
    (system?.classes ?? []).flatMap((each, at) =>
      each.subclasses.map((sub, subAt) => ({
        image: sub.iconImage,
        label: `class ${at} type ${subAt}${sub.nameTag ? `: ${sub.nameTag}` : ''}`,
      })),
    ),
  );
