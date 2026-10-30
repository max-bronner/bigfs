import { CHARACTER_SIGNATURE } from '../../formats/apt/aptMovie';
import { Image, buildConst } from './aptSynth';

/**
 * Builds a movie of many sprites, each with several frames of placements, a removal
 * and a script, in the shape of a large interface movie. Its text runs to
 * about `sprites * frames * 4` lines.
 */
export const buildLargeMovie = (sprites: number, frames: number) => {
  const apt = new Image();

  apt.writeU8(...Array.from('Apt Data:7\x1a\0', (c) => c.charCodeAt(0)));
  apt.align();

  const block = apt.writeU8(0x00);
  apt.align();

  const shape = apt.writeU32(1, CHARACTER_SIGNATURE);
  apt.writeF32(0, 0, 10, 10);
  apt.writeU32(1);

  const ids: number[] = [0, shape];

  for (let s = 0; s < sprites; s++) {
    const placement = (flags: number, depth: number, name: number) => {
      const place = apt.writeU32(3, flags, depth, 1);

      apt.writeF32(1, 0, 0, 1, depth, s % 89);
      apt.writeU32(0x80ff8040, 0x00102030);
      apt.writeF32(0.5);
      apt.writeU32(name, depth, 0);
      return place;
    };
    const frameItems: number[][] = [];

    for (let f = 0; f < frames; f++) {
      const name = apt.writeString(`clip_${s}_${f}`);
      apt.align();
      const place = placement(0x02 | 0x04 | 0x08 | 0x10 | 0x20, f + 1, name);
      const second = placement(0x02 | 0x04 | 0x40, f + 2, 0);
      const remove = apt.writeU32(4, f + 1);
      const action = apt.writeU32(1, block);

      frameItems.push([place, second, remove, action]);
    }

    const itemArrays = frameItems.map((items) => apt.writeU32(...items));
    const frameList = apt.end;

    itemArrays.forEach((items) => apt.writeU32(4, items));

    const sprite = apt.writeU32(5, CHARACTER_SIGNATURE, frames, frameList, 0);

    ids.push(sprite);
  }

  const rootItems = apt.writeU32(0);
  const rootFrames = apt.writeU32(0, rootItems);
  const characters = apt.writeU32(...ids);
  const movie = apt.writeU32(
    9,
    CHARACTER_SIGNATURE,
    1,
    rootFrames,
    0,
    ids.length,
    characters,
  );

  apt.writeU32(1024, 768, 33, 0, 0, 0, 0, 0);
  apt.patch(characters, movie);

  return {
    apt: apt.build(),
    constFile: buildConst(movie, ['this', 'stop', 7]),
  };
};
