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

/** A colour as R, G, B, A, each 0 to 255 */
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

/** Gets the path of the image file a `.dat` location names, relative to the movie's archive */
export const getTexturePath = (
  movie: string,
  id: number,
  location: DatLocation,
): string =>
  `art/textures/apt_${movie.toLowerCase()}_${location.kind === 'atlas' ? location.page : id}.tga`;

/** A number as `.ru` and `.dat` write them: no exponent, trailing zeros dropped */
const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));

/** Writes styled runs back as a `.ru` file, one entry per run */
export const writeRu = (runs: RuRun[]): string => {
  const lines: string[] = [];
  const join = (values: number[]) => values.map(formatNumber).join(':');

  for (const run of runs) {
    const { style } = run;

    lines.push('c');
    lines.push(
      style.kind === 'solid'
        ? `s s:${join(style.color)}`
        : style.kind === 'line'
          ? `s l:${join([style.width, ...style.color])}`
          : `s tc:${join([...style.color, style.character, ...style.transform])}`,
    );
    for (let i = 0; i < run.triangles.length; i += 6) {
      lines.push(`t ${join(run.triangles.slice(i, i + 6))}`);
    }
    for (let i = 0; i < run.lines.length; i += 4) {
      lines.push(`l ${join(run.lines.slice(i, i + 4))}`);
    }
  }
  return lines.join('\n') + '\n';
};

/** Writes a `.dat` in its two sections: standalone images, then atlas pages */
export const writeDat = (entries: Map<number, DatLocation>): string => {
  const sorted = [...entries].sort((a, b) => a[0] - b[0]);
  const header = '; Created by AptToBigc.';

  return (
    [
      header,
      ...sorted.flatMap(([id, location]) =>
        location.kind === 'standalone'
          ? [`${id}=${location.rect.join(' ')}`]
          : [],
      ),
      header,
      ...sorted.flatMap(([id, location]) =>
        location.kind === 'atlas' ? [`${id}->${location.page}`] : [],
      ),
    ].join('\r\n') + '\r\n'
  );
};

/** Computes the box around every point of some runs, or undefined when they have none */
export const getRunBounds = (
  runs: RuRun[],
): [number, number, number, number] | undefined => {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const run of runs) {
    for (const points of [run.triangles, run.lines]) {
      for (let i = 0; i < points.length; i += 2) {
        xs.push(points[i]);
        ys.push(points[i + 1]);
      }
    }
  }
  return xs.length
    ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    : undefined;
};

/**
 * Computes the texture transform that lays a box of a shape exactly over a box of an
 * image: shape space to the image's pixels, as a `tc` style stores it
 */
export const fitTexture = (
  [left, top, right, bottom]: [number, number, number, number],
  [u0, v0, u1, v1]: [number, number, number, number],
): [number, number, number, number, number, number] => {
  const scaleU = (u1 - u0) / (right - left || 1);
  const scaleV = (v1 - v0) / (bottom - top || 1);

  return [scaleU, 0, 0, scaleV, u0 - left * scaleU, v0 - top * scaleV];
};

/** Whether runs a page sent are well formed: finite numbers, whole primitives, known styles */
export const areRunsWellFormed = (runs: unknown): runs is RuRun[] =>
  Array.isArray(runs) &&
  runs.every((run: RuRun) => {
    const style = run?.style;
    const numbers = (values: unknown, size: number) =>
      Array.isArray(values) &&
      values.length % size === 0 &&
      values.every((value) => Number.isFinite(value));

    return (
      numbers(run?.triangles, 6) &&
      numbers(run?.lines, 4) &&
      numbers(style?.color, 4) &&
      style.color.length === 4 &&
      (style.kind === 'solid' ||
        (style.kind === 'line' && Number.isFinite(style.width)) ||
        (style.kind === 'texture' &&
          Number.isInteger(style.character) &&
          numbers(style.transform, 6) &&
          style.transform.length === 6))
    );
  });

/** Retextures a run of a shape so an image's used box lies exactly over it */
export const fitRunTo = (
  run: RuRun,
  image: number,
  box: [number, number, number, number],
): RuRun => ({
  ...run,
  style: {
    kind: 'texture',
    color:
      run.style.kind === 'texture' ? run.style.color : [255, 255, 255, 255],
    character: image,
    transform: fitTexture(getRunBounds([run]) ?? [0, 0, 1, 1], box),
  },
});
