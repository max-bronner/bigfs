import { decodeBlock } from './aptBytecode';
import { getTexturePath, parseDat, parseRu } from './aptGeometry';
import type { DatLocation } from './aptGeometry';
import { parseAptMovie, parseConst, parseSpriteFrames } from './aptMovie';
import type { AptMovie, Character, ConstFile, Frame } from './aptMovie';
import { describeError } from '../../core/errors';

/**
 * Checks whether a movie and the files beside it hold together, as the game
 * needs them to (mint's apt-format research): every shape has its `.ru`,
 * every image a `.dat` line whose texture file is there, every texture
 * style samples an image, every id points at a character of the right
 * kind, every script decodes; and nothing beside it is left over.
 */

/** How serious a `Problem` is: `error` breaks the movie in game, `info` is only unusual */
export type Severity = 'error' | 'warning' | 'info';

/** One finding of `checkMovie` */
export interface Problem {
  severity: Severity;
  message: string;
  /** The character it is about, when there is one */
  character?: number;
  /** The file it is about, relative to the movie's folder */
  file?: string;
}

/** Read access to a movie and the files beside it, by path relative to its folder, matched without casing */
export interface MovieAccess {
  name: string;
  apt: Uint8Array;
  /** Reads a file beside the movie, or undefined when it is missing */
  read(relative: string): Promise<Uint8Array | undefined>;
  /** Lists the names in a folder beside the movie, or undefined when there is none */
  list(relative: string): Promise<string[] | undefined>;
}

const decodeLatin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** Reads a TGA's size from its header, or undefined when it is not one */
export const readTgaSize = (
  bytes: Uint8Array,
): { width: number; height: number } | undefined =>
  bytes.length >= 18 && [1, 2, 3, 9, 10, 11].includes(bytes[2])
    ? {
        width: bytes[12] | (bytes[13] << 8),
        height: bytes[14] | (bytes[15] << 8),
      }
    : undefined;

const describe = (character: Character) => `#${character.id} ${character.type}`;

/** Checks a movie and the files beside it for what would break it in game or is left over */
export const checkMovie = async (access: MovieAccess): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const report = (
    severity: Severity,
    message: string,
    extra: Partial<Problem> = {},
  ) => problems.push({ severity, message, ...extra });
  const { name, apt } = access;
  const constName = `${name}.const`;
  const constBytes = await access.read(constName);
  let constFile: ConstFile;
  let movie: AptMovie;

  if (!constBytes) {
    report('error', `${constName} is missing: the movie cannot be loaded`, {
      file: constName,
    });
    return problems;
  }
  try {
    constFile = parseConst(constBytes);
    movie = parseAptMovie(apt, constFile.movieOffset);
  } catch (error) {
    report(
      'error',
      `The movie does not parse: ${describeError(error)}`,
    );
    return problems;
  }

  const { characters } = movie;
  const isKind = (id: number | undefined, ...kinds: Character['type'][]) =>
    id !== undefined && kinds.includes(characters[id]?.type);
  const datName = `${name}.dat`;
  const datBytes = await access.read(datName);
  let dat = new Map<number, DatLocation>();

  if (!datBytes) {
    if (characters.some((character) => character.type === 'image')) {
      report('error', `${datName} is missing: no image can find its texture`, {
        file: datName,
      });
    }
  } else {
    try {
      dat = parseDat(decodeLatin1(datBytes));
    } catch (error) {
      report(
        'error',
        `${datName}: ${describeError(error)}`,
        { file: datName },
      );
    }
  }

  // Scripts: every block a frame, button or clip runs must decode
  const checkBlock = (block: number, where: string, character?: number) => {
    try {
      decodeBlock(apt, block);
    } catch (error) {
      report(
        'error',
        `The script ${where} does not decode: ${describeError(error)}`,
        { character },
      );
    }
  };
  const checkFrames = (frames: Frame[], owner: Character) => {
    frames.forEach((frame, index) => {
      for (const item of frame.items) {
        const where = `in frame ${index} of ${describe(owner)}`;

        if (item.type === 'action' || item.type === 'initAction') {
          checkBlock(item.block, where, owner.id);
        } else if (item.type === 'placeObject') {
          if (item.character !== undefined && !characters[item.character]) {
            report(
              'error',
              `${where} places #${item.character}, which does not exist`,
              { character: owner.id },
            );
          }
          item.clipActions?.forEach((clip) =>
            checkBlock(clip.block, `${where} on @${item.depth}`, owner.id),
          );
        }
      }
    });
  };

  checkFrames(movie.frames, characters[0]);

  const usedGeometry = new Set<string>();
  const usedTextures = new Set<string>();
  const usedDat = new Set<number>();

  for (const character of characters) {
    switch (character.type) {
      case 'sprite':
        try {
          checkFrames(parseSpriteFrames(apt, character), character);
        } catch (error) {
          report(
            'error',
            `The timeline of ${describe(character)} does not parse: ${describeError(error)}`,
            { character: character.id },
          );
        }
        break;
      case 'shape': {
        const file = `${name}_geometry/${character.geometry}.ru`;
        const bytes = await access.read(file);

        usedGeometry.add(`${character.geometry}.ru`);
        if (!bytes) {
          report(
            'error',
            `${describe(character)}: its geometry ${file} is missing`,
            { character: character.id, file },
          );
          break;
        }
        try {
          for (const run of parseRu(decodeLatin1(bytes))) {
            if (
              run.style.kind === 'texture' &&
              !isKind(run.style.character, 'image')
            ) {
              report(
                'error',
                `${describe(character)}: ${file} samples #${run.style.character}, which is not an image`,
                { character: character.id, file },
              );
            }
          }
        } catch (error) {
          report(
            'error',
            `${file}: ${describeError(error)}`,
            { character: character.id, file },
          );
        }
        break;
      }
      case 'image': {
        const location = dat.get(character.texture);

        usedDat.add(character.texture);
        if (character.texture !== character.id) {
          report(
            'info',
            `${describe(character)} names texture ${character.texture}; the shipped movies always name their own id`,
            { character: character.id },
          );
        }
        if (!location) {
          if (datBytes) {
            report(
              'error',
              `${describe(character)}: ${datName} has no line for texture ${character.texture}`,
              { character: character.id, file: datName },
            );
          }
          break;
        }

        const file = getTexturePath(name, character.texture, location);
        const bytes = await access.read(file);
        const size = bytes && readTgaSize(bytes);

        usedTextures.add(file.toLowerCase());
        if (!bytes) {
          report(
            'error',
            `${describe(character)}: its texture ${file} is missing`,
            { character: character.id, file },
          );
        } else if (!size) {
          report('error', `${describe(character)}: ${file} is not a TGA`, {
            character: character.id,
            file,
          });
        } else if (location.kind === 'standalone') {
          const [left, top, right, bottom] = location.rect;

          if (
            left < 0 ||
            top < 0 ||
            right > size.width ||
            bottom > size.height ||
            right <= left ||
            bottom <= top
          ) {
            report(
              'warning',
              `${describe(character)}: the box ${location.rect.join(' ')} is not inside the ${size.width}×${size.height} ${file}`,
              { character: character.id, file },
            );
          }
        }
        break;
      }
      case 'button':
        for (const record of character.records) {
          if (!characters[record.character]) {
            report(
              'error',
              `${describe(character)} shows #${record.character}, which does not exist`,
              { character: character.id },
            );
          }
        }
        character.actions.forEach((action) =>
          checkBlock(action.block, `of ${describe(character)}`, character.id),
        );
        break;
      case 'editText':
        if (!isKind(character.font, 'font', 'placeholder')) {
          report(
            'info',
            `${describe(character)} uses font #${character.font}, which is not a font`,
            { character: character.id },
          );
        }
        break;
    }
  }

  for (const entry of movie.exports) {
    if (!characters[entry.character]) {
      report(
        'error',
        `The export "${entry.name}" names #${entry.character}, which does not exist`,
      );
    }
  }
  for (const entry of movie.imports) {
    if (!isKind(entry.character, 'placeholder')) {
      report(
        'error',
        `The import ${entry.movie}:${entry.name} fills #${entry.character}, which is not an import slot`,
        { character: entry.character },
      );
    }
  }
  for (const id of dat.keys()) {
    if (!usedDat.has(id)) {
      report(
        'warning',
        `${datName} has a line for texture ${id}, which no image uses`,
        { file: datName },
      );
    }
  }

  // Files beside the movie that nothing uses
  for (const file of (await access.list(`${name}_geometry`)) ?? []) {
    if (/\.ru$/i.test(file) && !usedGeometry.has(file.toLowerCase())) {
      report('warning', `${name}_geometry/${file} belongs to no shape`, {
        file: `${name}_geometry/${file}`,
      });
    }
  }

  const prefix = `apt_${name.toLowerCase()}_`;

  for (const file of (await access.list('art/textures')) ?? []) {
    const path = `art/textures/${file}`;

    if (
      file.toLowerCase().startsWith(prefix) &&
      !usedTextures.has(path.toLowerCase())
    ) {
      report('warning', `${path} is used by no image`, { file: path });
    }
  }

  return problems;
};
