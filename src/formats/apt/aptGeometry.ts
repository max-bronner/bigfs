/**
 * The two text files beside an APT movie: `.ru` shape geometry and the
 * `.dat` texture map. Rules from mint's `docs/research/apt-format.md`.
 *
 * A `.ru` file is already triangulated: `c` starts an entry, `s` sets the
 * style for the primitives after it, `t` is a triangle and `l` a line, every
 * value separated by `:`. There are no curves anywhere in the shipped data.
 *
 * A texture style's matrix is stored transposed to its field names: the
 * pixel a point samples is `u = m00*x + m10*y + tx`, `v = m01*x + m11*y + ty`,
 * in the image's pixels. Reading it as named rotates every rotated texture.
 */

/** RGBA, each 0 to 255 */
export type Rgba = [number, number, number, number];

/** How the primitives after a style line are drawn */
export type RuStyle =
  | { kind: 'solid'; color: Rgba }
  | { kind: 'line'; width: number; color: Rgba }
  | {
      kind: 'texture';
      color: Rgba;
      /** The Image character whose pixels are sampled */
      character: number;
      /** Shape space to image pixels: [a, b, c, d, e, f] for u = a x + c y + e, v = b x + d y + f */
      transform: [number, number, number, number, number, number];
    };

/** One style and the primitives drawn with it */
export interface RuRun {
  style: RuStyle;
  /** Six numbers per triangle */
  triangles: number[];
  /** Four numbers per line */
  lines: number[];
}

/** Parses a `.ru` file into its styled runs, in file order */
export const parseRu = (text: string): RuRun[] => {
  const runs: RuRun[] = [];
  let current: RuRun | undefined;

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();

    if (!line || line === 'c') {
      return;
    }

    const [kind, body = ''] = line.split(/\s+/, 2);
    const fields = body.split(':');
    const numbers = fields.map(Number);
    const fail = (reason: string) => {
      throw new Error(`.ru line ${index + 1}: ${reason}`);
    };

    if (kind === 's') {
      const [styleKind, ...values] = fields;
      const n = values.map(Number);
      let style: RuStyle;

      if (styleKind === 's' && n.length === 4) {
        style = { kind: 'solid', color: [n[0], n[1], n[2], n[3]] };
      } else if (styleKind === 'l' && n.length === 5) {
        style = { kind: 'line', width: n[0], color: [n[1], n[2], n[3], n[4]] };
      } else if (styleKind === 'tc' && n.length === 11) {
        style = {
          kind: 'texture',
          color: [n[0], n[1], n[2], n[3]],
          character: n[4],
          // Transposed, as the data says: m00, m10 drive u; m01, m11 drive v
          transform: [n[5], n[6], n[7], n[8], n[9], n[10]],
        };
      } else {
        return fail(`unknown style '${body}'`);
      }

      if (n.some((value) => !Number.isFinite(value))) {
        return fail('a style value is not a number');
      }

      current = { style, triangles: [], lines: [] };
      runs.push(current);
      return;
    }

    if (!current) {
      return fail('a primitive before any style');
    }

    if (
      kind === 't' &&
      numbers.length === 6 &&
      numbers.every(Number.isFinite)
    ) {
      current.triangles.push(...numbers);
    } else if (
      kind === 'l' &&
      numbers.length === 4 &&
      numbers.every(Number.isFinite)
    ) {
      current.lines.push(...numbers);
    } else {
      fail(`cannot read '${line}'`);
    }
  });

  return runs;
};

/** Where an Image character's pixels are */
export type DatLocation =
  /** `id->page`: the shared atlas `art/textures/apt_<movie>_<page>.tga` */
  | { kind: 'atlas'; page: number }
  /** `id=l t r b`: `art/textures/apt_<movie>_<id>.tga`, of which this box is used */
  | { kind: 'standalone'; rect: [number, number, number, number] };

/** Parses a `.dat` file: texture id to where its pixels are */
export const parseDat = (text: string): Map<number, DatLocation> => {
  const entries = new Map<number, DatLocation>();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();

    if (!line || line.startsWith(';')) {
      return;
    }

    const atlas = /^(\d+)\s*->\s*(\d+)$/.exec(line);
    const standalone = /^(\d+)\s*=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(line);

    if (atlas) {
      entries.set(Number(atlas[1]), { kind: 'atlas', page: Number(atlas[2]) });
    } else if (standalone) {
      const [, id, ...rect] = standalone.map(Number);

      entries.set(id, {
        kind: 'standalone',
        rect: rect as [number, number, number, number],
      });
    } else {
      throw new Error(`.dat line ${index + 1}: cannot read '${line}'`);
    }
  });

  return entries;
};

/** The image file a `.dat` location names, relative to the movie's archive */
export const getTexturePath = (
  movie: string,
  id: number,
  location: DatLocation,
): string =>
  `art/textures/apt_${movie.toLowerCase()}_${location.kind === 'atlas' ? location.page : id}.tga`;
