import type { SageBlock, SageDocument } from '../../formats/ini/sageIniParser';

/**
 * What a name given to the audio system can play: the files behind an audio
 * event, a `Multisound`, an EVA event or a movie, each labelled by the part
 * of the definition it came from. Pure: the definitions come from an
 * injected lookup, so the walk is testable without an index or an editor.
 *
 * The shapes follow mint's audio runtime (`crates/sage/audio/src/runtime.rs`:
 * `played_keys` and `resolve_def` follow a `Multisound` to its subsounds at
 * most `MAX_MULTISOUND_DEPTH` (4) deep, and a `Multisound` naming itself
 * ends) and its movie rule (`docs/design/presentation/movies.md`: a video
 * starts the events `<stem>_Music` and `<stem>` when they exist).
 */

/** How many `Multisound` or EVA levels are followed, as the runtime does */
export const MAX_AUDIO_DEPTH = 4;

/** An audio-family block, reduced to the fields this walk reads */
export interface AudioDefinition {
  /** The block keyword: `AudioEvent`, `Multisound`, `Video`, ... */
  keyword: string;
  /** The block's own fields, with their values as written */
  fields: { key: string; values: string[] }[];
  /** `SideSound` children of an EVA event */
  sideSounds: { side: string; sound: string }[];
}

/** Finds a definition by event name; a lookup may read files, so may wait */
export type AudioLookup = (
  name: string,
) => AudioDefinition | undefined | Promise<AudioDefinition | undefined>;

/** One file a name can play, and where in the definitions it came from */
export interface AudioVariant {
  /** Where in the definition it came from: a role, a side, a subsound path */
  label: string;
  /** The file name as written, without a weight */
  file: string;
  /** The `name:weight` weight of a `Sounds` variant, when one was written */
  weight?: number;
}

/** `EVA:` and `+SOUND:` mark where a name is looked up; the event is the rest */
const NAME_PREFIX = /^\s*(?:eva:|\+sound:)/i;
/** The fields of an audio event that list files, each a role of the event */
const SOUND_ROLES = /^(sounds\w*|attack|decay)$/i;
const STREAMED = /^(dialogevent|musictrack|ambientstream|streamedsound)$/i;
const MULTISOUND = /^multisound$/i;
const EVA = /^(newevaevent|predefinedevaevent)$/i;

/** Strips the `EVA:` and `+SOUND:` lookup prefixes, leaving the name an event is registered under */
export const stripAudioPrefix = (name: string): string => {
  let result = name;

  for (let again = true; again; ) {
    const next = result.replace(NAME_PREFIX, '');

    again = next !== result;
    result = next;
  }
  return result.trim();
};

const unquote = (text: string) => text.replace(/^"|"$/g, '');

/** Splits `name:weight` into a file or event and its weight, when a whole number */
const splitWeight = (token: string): { name: string; weight?: number } => {
  const match = /^(.*):(\d+)$/.exec(unquote(token));

  return match
    ? { name: match[1], weight: Number(match[2]) }
    : { name: unquote(token) };
};

const fieldsNamed = (definition: AudioDefinition, pattern: RegExp) =>
  definition.fields.filter((field) => pattern.test(field.key));

const getFileStem = (name: string) =>
  name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

/** Resolves the files `name` can play; none when nothing by that name is defined */
export const resolveAudio = async (
  name: string,
  lookup: AudioLookup,
): Promise<AudioVariant[]> => walk(stripAudioPrefix(name), lookup, [], 0);

const prefixLabels = (prefix: string, variants: AudioVariant[]): AudioVariant[] =>
  variants.map((variant) => ({
    ...variant,
    label: `${prefix} › ${variant.label}`,
  }));

const walk = async (
  name: string,
  lookup: AudioLookup,
  path: string[],
  depth: number,
): Promise<AudioVariant[]> => {
  const key = name.toLowerCase();

  // A `Multisound` that contains itself, however indirectly, plays nothing more
  if (!name || path.includes(key)) {
    return [];
  }

  const definition = await lookup(name);

  if (!definition) {
    return [];
  }

  const here = [...path, key];
  const follow = async (next: string): Promise<AudioVariant[]> =>
    depth < MAX_AUDIO_DEPTH
      ? walk(stripAudioPrefix(next), lookup, here, depth + 1)
      : [];

  if (/^audioevent$/i.test(definition.keyword)) {
    const variants: AudioVariant[] = [];

    for (const field of definition.fields) {
      if (!SOUND_ROLES.test(field.key)) {
        continue;
      }
      for (const token of field.values) {
        const { name: file, weight } = splitWeight(token);

        if (file && !/^none$/i.test(file)) {
          variants.push({
            label: field.key,
            file,
            ...(weight === undefined ? {} : { weight }),
          });
        }
      }
    }
    return variants;
  }

  if (STREAMED.test(definition.keyword)) {
    return fieldsNamed(definition, /^filename$/i).flatMap((field) =>
      field.values
        .map(unquote)
        .filter(Boolean)
        .map((file) => ({ label: 'Filename', file })),
    );
  }

  if (MULTISOUND.test(definition.keyword)) {
    const variants: AudioVariant[] = [];

    for (const field of fieldsNamed(definition, /^subsounds?$/i)) {
      for (const token of field.values) {
        const subsound = splitWeight(token).name;

        variants.push(...prefixLabels(subsound, await follow(subsound)));
      }
    }
    return variants;
  }

  if (EVA.test(definition.keyword)) {
    const variants: AudioVariant[] = [];

    for (const { side, sound } of definition.sideSounds) {
      if (sound) {
        variants.push(...prefixLabels(side || '?', await follow(sound)));
      }
    }
    return variants;
  }

  if (/^video$/i.test(definition.keyword)) {
    const stem = getFileStem(
      fieldsNamed(definition, /^filename$/i)[0]?.values[0] ?? name,
    );
    const variants: AudioVariant[] = [];

    // The score first, as the movie starts them
    for (const event of [`${stem}_Music`, stem]) {
      variants.push(...prefixLabels(event, await follow(event)));
    }
    return variants;
  }
  return [];
};

/**
 * Reads one block of a parsed file as an audio definition: its own fields,
 * and the sides of its `SideSound` children
 */
export const readAudioDefinition = (
  parsed: SageDocument,
  block: SageBlock,
): AudioDefinition => {
  const inside = (line: number, of: SageBlock) =>
    of.startLine < line && line <= of.endLine;
  const fieldsOf = (of: SageBlock) =>
    parsed.statements.filter(
      (statement) =>
        statement.kind === 'field' &&
        inside(statement.line, of) &&
        !of.children.some((child) => inside(statement.line, child)),
    );

  return {
    keyword: block.keyword,
    fields: fieldsOf(block).map((statement) => ({
      key: statement.keyword.text,
      values: statement.values.map((value) => value.text),
    })),
    sideSounds: block.children
      .filter((child) => /^sidesound$/i.test(child.keyword))
      .map((child) => {
        const own = fieldsOf(child);
        const read = (key: string) =>
          own
            .find((statement) => statement.keyword.text.toLowerCase() === key)
            ?.values[0]?.text.replace(/^"|"$/g, '') ?? '';

        return { side: read('side'), sound: read('sound') };
      }),
  };
};
