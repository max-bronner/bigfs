import { CHARACTER_SIGNATURE } from '../../formats/apt/aptMovie';
import { Image, buildConst } from './aptSynth';

/**
 * A movie of many sprites, each with several frames of placements, a removal
 * and a script, in the shape of a large interface movie. Its text runs to
 * about `sprites * frames * 4` lines.
 */
export const buildLargeMovie = (sprites: number, frames: number) => {
  const apt = new Image();

  apt.u8(...Array.from('Apt Data:7\x1a\0', (c) => c.charCodeAt(0)));
  apt.align();

  const block = apt.u8(0x00);
  apt.align();

  const shape = apt.u32(1, CHARACTER_SIGNATURE);
  apt.f32(0, 0, 10, 10);
  apt.u32(1);

  const ids: number[] = [0, shape];

  for (let s = 0; s < sprites; s++) {
    const placement = (flags: number, depth: number, name: number) => {
      const place = apt.u32(3, flags, depth, 1);

      apt.f32(1, 0, 0, 1, depth, s % 89);
      apt.u32(0x80ff8040, 0x00102030);
      apt.f32(0.5);
      apt.u32(name, depth, 0);
      return place;
    };
    const frameItems: number[][] = [];

    for (let f = 0; f < frames; f++) {
      const name = apt.string(`clip_${s}_${f}`);
      apt.align();
      const place = placement(0x02 | 0x04 | 0x08 | 0x10 | 0x20, f + 1, name);
      const second = placement(0x02 | 0x04 | 0x40, f + 2, 0);
      const remove = apt.u32(4, f + 1);
      const action = apt.u32(1, block);

      frameItems.push([place, second, remove, action]);
    }

    const itemArrays = frameItems.map((items) => apt.u32(...items));
    const frameList = apt.end;

    itemArrays.forEach((items) => apt.u32(4, items));

    const sprite = apt.u32(5, CHARACTER_SIGNATURE, frames, frameList, 0);

    ids.push(sprite);
  }

  const rootItems = apt.u32(0);
  const rootFrames = apt.u32(0, rootItems);
  const characters = apt.u32(...ids);
  const movie = apt.u32(
    9,
    CHARACTER_SIGNATURE,
    1,
    rootFrames,
    0,
    ids.length,
    characters,
  );

  apt.u32(1024, 768, 33, 0, 0, 0, 0, 0);
  apt.patch(characters, movie);

  return {
    apt: apt.build(),
    constFile: buildConst(movie, ['this', 'stop', 7]),
  };
};
