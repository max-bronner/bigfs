import {
  AptReader,
  PLACE_FLAGS,
  parseAptMovie,
  parseConst,
  parseFrames,
} from '../aptMovie';
import type {
  AptMovie,
  ButtonRecord,
  Character,
  ConstFile,
  Frame,
  FrameItem,
  Matrix2,
} from '../aptMovie';
import { normalizeScript } from './textModel';
import type {
  ButtonRecordText,
  CharacterText,
  FrameText,
  ItemText,
  MovieText,
  Placement,
  ScriptText,
} from './textModel';

/** The fields a placed button or text needs, whatever the record */
const placementOf = (
  matrix: Matrix2,
  translate: [number, number],
): Placement => ({
  matrix: [...matrix] as Matrix2,
  translate: [...translate] as [number, number],
});

/** Reads the script of a block, given its offset */
export type ScriptReader = (block: number) => ScriptText;

const itemOf = (
  item: FrameItem,
  reader: AptReader,
  script: ScriptReader,
): ItemText => {
  const origin = { offset: item.offset };

  switch (item.type) {
    case 'action':
      return { ...origin, type: 'action', script: script(item.block) };
    case 'frameLabel':
      return {
        ...origin,
        type: 'label',
        label: item.label,
        flags: item.flags,
        frame: item.frame,
      };
    case 'placeObject': {
      const list =
        item.flags & PLACE_FLAGS.hasClipActions
          ? reader.u32(item.offset + 60)
          : 0;
      const array = list ? reader.u32(list + 4) : 0;

      return {
        ...origin,
        type: 'place',
        flags: item.flags,
        depth: item.depth,
        character: item.character,
        placement:
          item.matrix && item.translate
            ? placementOf(item.matrix, item.translate)
            : undefined,
        colorTransform: item.colorTransform,
        colorAdd: item.colorAdd,
        ratio: item.ratio,
        name: item.name,
        clipDepth: item.clipDepth,
        clipActions: item.clipActions?.map((action, index) => ({
          offset: array + index * 12,
          events: action.events,
          script: script(action.block),
        })),
      };
    }
    case 'removeObject':
      return { ...origin, type: 'remove', depth: item.depth };
    case 'backgroundColor':
      return { ...origin, type: 'background', color: item.color };
    case 'initAction':
      return {
        ...origin,
        type: 'initAction',
        sprite: item.sprite,
        script: script(item.block),
      };
    default:
      return { ...origin, type: 'unknown', itemType: item.itemType };
  }
};

const framesOf = (
  frames: Frame[],
  reader: AptReader,
  script: ScriptReader,
): FrameText[] =>
  frames.map((frame, index) => ({
    index,
    items: frame.items.map((item) => itemOf(item, reader, script)),
  }));

const buttonRecordOf = (record: ButtonRecord): ButtonRecordText => ({
  offset: record.offset,
  flags: record.flags,
  depth: record.depth,
  character: record.character,
  placement: placementOf(record.matrix, record.translate),
  color: [...record.color],
  unknown: [...record.unknown],
});

const characterOf = (
  character: Character,
  reader: AptReader,
  script: ScriptReader,
): CharacterText => {
  const head = { id: character.id, offset: character.offset };

  switch (character.type) {
    case 'movie':
      return {
        ...head,
        type: 'movie',
        screen:
          character.id === 0
            ? {
                width: character.record.screenWidth,
                height: character.record.screenHeight,
                unknown36: character.record.unknown36,
              }
            : undefined,
        frames: framesOf(
          parseFrames(
            reader,
            character.record.frameCount,
            character.record.framesOffset,
          ),
          reader,
          script,
        ),
      };
    case 'shape':
      return {
        ...head,
        type: 'shape',
        bounds: character.bounds,
        geometry: character.geometry,
      };
    case 'editText':
      return {
        ...head,
        type: 'editText',
        bounds: character.bounds,
        font: character.font,
        alignment: character.alignment,
        color: character.color,
        fontHeight: character.fontHeight,
        readonly: character.readonly,
        multiline: character.multiline,
        wordwrap: character.wordwrap,
        text: character.text,
        variable: character.variable,
      };
    case 'font':
      return {
        ...head,
        type: 'font',
        name: character.name,
        glyphs: character.glyphs,
      };
    case 'button': {
      const actions = reader.u32(character.offset + 56);

      return {
        ...head,
        type: 'button',
        bounds: character.bounds,
        hitTriangles: character.hitTriangles,
        records: character.records.map(buttonRecordOf),
        actions: character.actions.map((action, index) => ({
          offset: actions + index * 8,
          condition: action.condition,
          script: script(action.block),
        })),
      };
    }
    case 'sprite':
      return {
        ...head,
        type: 'sprite',
        frames: framesOf(
          parseFrames(reader, character.frameCount, character.framesOffset),
          reader,
          script,
        ),
      };
    case 'image':
      return { ...head, type: 'image', texture: character.texture };
    case 'morph':
      return {
        ...head,
        type: 'morph',
        startShape: character.startShape,
        endShape: character.endShape,
      };
    case 'text':
      return {
        ...head,
        type: 'text',
        bounds: character.bounds,
        placement: placementOf(character.matrix, character.translate),
        runs: character.records.map((run) => ({
          offset: run.offset,
          font: run.font,
          color: [...run.color],
          unknown: [...run.unknown],
          penOffset: [...run.penOffset],
          textHeight: run.textHeight,
          glyphs: run.glyphs.map((glyph) => ({ ...glyph })),
        })),
      };
    case 'placeholder':
      return { ...head, type: 'placeholder' };
    default:
      return {
        ...head,
        type: 'unknown',
        characterType: character.characterType,
      };
  }
};

/**
 * The model of a movie as it stands in its files. `script` reads each
 * action block; the save path passes a cheap one when it only needs the
 * record fields again.
 */
export const movieToText = (
  apt: Uint8Array,
  constBytes: Uint8Array,
  script: ScriptReader,
  parsed?: { movie: AptMovie; constFile: ConstFile },
): MovieText => {
  const read: ScriptReader = (block) => {
    const each = script(block);

    return { ...each, text: normalizeScript(each.text), block };
  };
  const constFile = parsed?.constFile ?? parseConst(constBytes);
  const movie = parsed?.movie ?? parseAptMovie(apt, constFile.movieOffset);
  const reader = new AptReader(apt);
  const record = movie.record;

  return {
    constants: constFile.items.map((item, index) => ({
      offset: constFile.itemsOffset + index * 8,
      index,
      value: item.value,
    })),
    imports: movie.imports.map((entry, index) => ({
      offset: record.importsOffset + index * 16,
      ...entry,
    })),
    exports: movie.exports.map((entry, index) => ({
      offset: record.exportsOffset + index * 8,
      ...entry,
    })),
    characters: movie.characters.map((character) =>
      characterOf(character, reader, read),
    ),
  };
};
