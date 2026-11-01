import type { Uri } from 'vscode';
import {
  IMAGE_NAME_PATTERNS,
  PALANTIR_STATES,
} from '../../game/apt/engineSuggestions';
import type {
  SuggestionKind,
  SuggestionOption,
} from '../../game/apt/engineSuggestions';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';

/** Most options answered for one kind, so a page cannot be sent a whole INI */
export const MAX_OPTIONS = 5000;

/** The part of the INI index the lookup reads */
export type SuggestionIndex = Pick<SageIniIndex, 'getNames' | 'findDefinitions'>;

/** Reads a file's text, as the editor shows it */
export type ReadText = (uri: Uri) => Promise<string>;

/** What a `PlayerTemplate` says of its side */
interface SideFacts {
  side: string;
  evil: boolean;
  playable: boolean;
}

const isYes = (value: string | undefined): boolean =>
  /^yes$/i.test(value ?? '');

/** Reads `name = value` lines, the first of each name, lowercased; a comment ends a value */
const readFields = (lines: readonly string[]): Map<string, string> => {
  const fields = new Map<string, string>();

  for (const line of lines) {
    const match = /^\s*(\w+)\s*=\s*([^;]*)/.exec(line);

    if (match && !fields.has(match[1].toLowerCase())) {
      fields.set(match[1].toLowerCase(), match[2].trim());
    }
  }
  return fields;
};

/**
 * Reads the fields of every definition of a namespace, one file read per file.
 * A file that cannot be read leaves its definitions out.
 */
const readDefinitionFields = async (
  index: SuggestionIndex,
  namespace: string,
  read: ReadText,
): Promise<Map<string, string>[]> => {
  const definitions = index
    .getNames(namespace)
    .flatMap((name) => index.findDefinitions(namespace, name).slice(0, 1));
  const texts = new Map<string, Promise<string[] | undefined>>();
  const lines = (uri: Uri) => {
    const key = uri.toString();

    if (!texts.has(key)) {
      texts.set(
        key,
        read(uri).then(
          (text) => text.split(/\r?\n/),
          () => undefined,
        ),
      );
    }
    return texts.get(key)!;
  };
  const fields: Map<string, string>[] = [];

  for (const definition of definitions) {
    const body = (await lines(definition.uri))?.slice(
      definition.line + 1,
      definition.endLine,
    );

    if (body) {
      fields.push(readFields(body));
    }
  }
  return fields;
};

const readSides = async (
  index: SuggestionIndex,
  read: ReadText,
): Promise<SideFacts[]> => {
  const sides = new Map<string, SideFacts>();

  for (const fields of await readDefinitionFields(index, 'PlayerTemplate', read)) {
    const side = fields.get('side');

    if (side && !sides.has(side.toLowerCase())) {
      sides.set(side.toLowerCase(), {
        side,
        evil: isYes(fields.get('evil')),
        playable: isYes(fields.get('playableside')),
      });
    }
  }
  return [...sides.values()];
};

const describeSide = ({ evil, playable }: SideFacts): string =>
  playable ? (evil ? 'evil' : 'good') : 'not playable';

const sideOptions = (sides: readonly SideFacts[]): SuggestionOption[] =>
  sides.map((each) => ({ value: each.side, label: describeSide(each) }));

const sideStateOptions = (sides: readonly SideFacts[]): SuggestionOption[] =>
  sides.length
    ? PALANTIR_STATES.map(({ value, evil, note }) => {
        const named = sides
          .filter((each) => each.evil === evil && each.playable)
          .map((each) => each.side);

        return {
          value,
          label: named.length ? `${note}: ${named.join(', ')}` : note,
        };
      })
    : [];

const imageNameOptions = (
  index: SuggestionIndex,
  pattern: RegExp,
): SuggestionOption[] =>
  index
    .getNames('MappedImage')
    .filter((name) => pattern.test(name))
    .map((value) => ({ value }));

const buttonImageOptions = async (
  index: SuggestionIndex,
  read: ReadText,
): Promise<SuggestionOption[]> => {
  const images = new Map<string, string>();

  for (const fields of await readDefinitionFields(index, 'CommandButton', read)) {
    const image = fields.get('buttonimage');

    if (image && !images.has(image.toLowerCase())) {
      images.set(image.toLowerCase(), image);
    }
  }
  return [...images.values()].sort().map((value) => ({ value }));
};

/**
 * Gets the options a kind of field offers, out of the INI the editor has
 * indexed. Without a game, or without the records a kind reads, there are none
 * and the field stays plain text.
 */
export const resolveSuggestions = async (
  kind: SuggestionKind,
  index: SuggestionIndex,
  read: ReadText,
): Promise<SuggestionOption[]> => {
  const options = await (async () => {
    switch (kind) {
      case 'side':
        return sideOptions(await readSides(index, read));
      case 'sideState':
        return sideStateOptions(await readSides(index, read));
      case 'buttonImage':
        return buttonImageOptions(index, read);
      default:
        return imageNameOptions(index, IMAGE_NAME_PATTERNS[kind] ?? /$^/);
    }
  })();

  return options.slice(0, MAX_OPTIONS);
};
