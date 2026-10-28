import {
  AUDIO_NAMESPACES,
  EVA_NAMESPACES,
  audioReferenceKind,
  lastContextSegment,
  namespacesOfKind,
} from './sageAudioFields';
import type { AudioReferenceKind } from './sageAudioFields';
import type { SageStatement, SageToken } from '../../formats/ini/sageIniParser';
import type { SageIniSchema } from '../../formats/ini/sageIniSchema';
import { parentOf } from '../../formats/ini/sageIniNames';
import { nameOffsetIn } from '../../formats/ini/sageReferenceFields';

/**
 * The sound and announcer names written inside the values of an audio field,
 * with the exact columns of each name.
 *
 * A value is not always a bare name. `EVA:Name` and `+SOUND:Name` carry a
 * prefix, `Subsounds` carry a `:weight` suffix, `AnimationSound` keys its
 * sound with `Sound:` among other keyed values, and a ship's death names
 * its sound as the second of two tokens. Navigation needs the name alone, so
 * the range excludes everything around it.
 *
 * This file knows nothing of the editor, so it runs in the unit tests.
 */

/** One name written in a statement */
export interface AudioName {
  name: string;
  /** Column the name starts at */
  start: number;
  /** Column one past the name's last character */
  end: number;
  /** The namespaces the name may be declared in */
  namespaces: readonly string[];
}

/** Values that mean no sound, in any casing */
const NO_SOUND = /^(?:none|nosound)$/i;

/** `EVA:Name`, which names an announcer event wherever a sound is expected */
const EVA_PREFIX = /^eva:/i;

/** `+SOUND:Name`, the explicit form of a sound name */
const SOUND_PREFIX = /^[+-]?sound:/i;

/** `Sound:Name` or `Sound:` alone, the key of a keyed value */
const SOUND_KEY = /^sound:/i;

/** Fields whose values are keyed (`Sound:Name Animation:X Frames:3`) */
const KEYED_FIELDS: ReadonlySet<string> = new Set([
  'animationsound',
  'modelcondition',
  'duck',
]);

/**
 * Whether a value is certainly not a name even where a name is expected:
 * numbers and percentages, SCREAMING_SNAKE words (enum values and macros)
 * and the `None` the engine accepts. Case sensitive, unlike the check the
 * other namespaces use, since sound names are ordinarily written in mixed
 * case and many retail ones are not.
 */
const AUDIO_SENTINEL =
  /^(?:[+-]?[\d.]+%?|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*|None|NONE|NoSound)$/;

export const isAudioSentinel = (text: string): boolean =>
  AUDIO_SENTINEL.test(text);

const named = (
  token: SageToken,
  from: number,
  to: number,
  namespaces: readonly string[],
): AudioName[] =>
  to > from
    ? [
        {
          name: token.text.slice(from, to),
          start: token.start + from,
          end: token.start + to,
          namespaces,
        },
      ]
    : [];

/** A bare name, an `EVA:` name, or a `+SOUND:` name */
const nameIn = (
  token: SageToken,
  namespaces: readonly string[],
): AudioName[] => {
  if (NO_SOUND.test(token.text)) {
    return [];
  }

  const eva = EVA_PREFIX.exec(token.text);

  if (eva) {
    return named(token, eva[0].length, token.text.length, EVA_NAMESPACES);
  }

  const sound = SOUND_PREFIX.exec(token.text);

  if (sound) {
    return named(token, sound[0].length, token.text.length, AUDIO_NAMESPACES);
  }

  return named(token, 0, token.text.length, namespaces);
};

/**
 * `name:weight`, as `Subsounds` writes them. A trailing colon part that is
 * not a whole number is left in the name.
 */
const weightedNameIn = (token: SageToken): AudioName[] => {
  const colon = token.text.lastIndexOf(':');

  return colon > 0 && /^\d+$/.test(token.text.slice(colon + 1))
    ? nameIn({ ...token, text: token.text.slice(0, colon) }, AUDIO_NAMESPACES)
    : nameIn(token, AUDIO_NAMESPACES);
};

/** The sound of each `Sound:` key, whether the name follows the colon or the next token */
const keyedSoundsIn = (values: readonly SageToken[]): AudioName[] =>
  values.flatMap((token, index) => {
    if (!SOUND_KEY.test(token.text)) {
      return [];
    }

    const length = 'Sound:'.length;

    return token.text.length > length
      ? nameIn(
          {
            text: token.text.slice(length),
            start: token.start + length,
            end: token.end,
          },
          AUDIO_NAMESPACES,
        )
      : values[index + 1]
        ? nameIn(values[index + 1], AUDIO_NAMESPACES)
        : [];
  });

/**
 * Every sound or announcer name a statement's values write. `kind` is what
 * `audioReferenceKind` answered for the statement's field; `contextName` is
 * the schema's name for its context, for the one field whose layout depends
 * on the block.
 */
export const audioNamesIn = (
  statement: Pick<SageStatement, 'keyword' | 'values'>,
  kind: AudioReferenceKind,
  contextName = '',
): AudioName[] => {
  const field = statement.keyword.text.toLowerCase();
  const { values } = statement;

  if (KEYED_FIELDS.has(field)) {
    return keyedSoundsIn(values);
  }

  if (field === 'subsounds') {
    return values.flatMap(weightedNameIn);
  }

  // `Sound = <PHASE> <event>`: the first token is the death phase
  if (
    field === 'sound' &&
    lastContextSegment(contextName) === 'shipslowdeathbehavior'
  ) {
    return values
      .slice(1, 2)
      .flatMap((token) => nameIn(token, AUDIO_NAMESPACES));
  }

  return values.flatMap((token) => nameIn(token, namespacesOfKind(kind)));
};

/** A name a statement's value refers to, and where it is written */
export interface ReferencedName extends AudioName {
  /** Whether the field is a sound or announcer one, whose names sit inside its values */
  isAudio: boolean;
}

/**
 * Every name a statement's field points at another definition with: the names
 * inside the values of a sound or announcer field, the parent a `ChildObject`
 * header inherits from, or each value of any other reference field that names
 * something. Nothing for a field that references nothing.
 */
export const referencedNames = (
  statement: SageStatement,
  schema: SageIniSchema,
): ReferencedName[] => {
  const { keyword, context, values } = statement;
  const parent = parentOf(statement);

  if (statement.block) {
    return parent
      ? [
          {
            name: parent.token.text,
            start: parent.token.start,
            end: parent.token.end,
            namespaces: [parent.namespace],
            isAudio: false,
          },
        ]
      : [];
  }

  const contextName = schema.describeContext(context);
  const kind = audioReferenceKind(contextName, keyword.text);

  if (kind) {
    return audioNamesIn(statement, kind, contextName).map((name) => ({
      ...name,
      isAudio: true,
    }));
  }

  return values.flatMap(({ text, start, end }, index) => {
    const namespaces = schema.getReferenceNamespaces(
      keyword.text,
      context,
      index,
    );

    const offset = nameOffsetIn(keyword.text, values, index);

    return namespaces.length && offset !== undefined
      ? [
          {
            name: text.slice(offset),
            start: start + offset,
            end,
            namespaces,
            isAudio: false,
          },
        ]
      : [];
  });
};
