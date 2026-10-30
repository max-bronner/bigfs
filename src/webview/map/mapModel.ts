import type { DictValue } from '../../formats/map/mapFile';
import type { HeightsView, ObjectView } from './protocol';

/** Pure reads of the map the page was sent: what an object is, called and where it stands. */

/** Rounds to two places, which is as fine as a position needs */
export const roundTo = (value: number): number => Math.round(value * 100) / 100;

/** Whether the object is a waypoint */
export const isWaypoint = (object: ObjectView): boolean =>
  object.template.toLowerCase() === '*waypoints/waypoint';

/** Gets the name an object or waypoint carries, or an empty string */
export const nameOf = (object: ObjectView): string => {
  const entry = object.properties.find(
    (candidate) =>
      candidate.key === 'waypointName' || candidate.key === 'objectName',
  );

  return entry && entry.value.value ? String(entry.value.value) : '';
};

/** Whether the object is a player's start position, a waypoint named `Player_<n>_Start` */
export const isStart = (object: ObjectView): boolean =>
  isWaypoint(object) && /^Player_\d+_Start$/i.test(nameOf(object));

/** Gets the id a waypoint's links name it by */
export const idOf = (object: ObjectView): number | undefined => {
  const entry = object.properties.find(
    (candidate) => candidate.key === 'waypointID',
  );

  return entry && typeof entry.value.value === 'number'
    ? entry.value.value
    : undefined;
};

/** Indexes the waypoints by id; the first of a repeated id wins */
export const waypointsById = (
  objects: readonly ObjectView[],
): Map<number, ObjectView> => {
  const found = new Map<number, ObjectView>();

  for (const object of objects) {
    const id = isWaypoint(object) ? idOf(object) : undefined;

    if (id !== undefined && !found.has(id)) {
      found.set(id, object);
    }
  }
  return found;
};

/** Formats how the page names a waypoint: its name, or its id */
export const waypointLabel = (object: ObjectView): string =>
  nameOf(object) || `#${idOf(object)}`;

/** Gets the owner or team of an object, or an empty string */
export const ownerOf = (object: ObjectView): string => {
  const entry = object.properties.find(
    (candidate) => candidate.key === 'originalOwner',
  );

  return entry ? String(entry.value.value) : '';
};

/** Parses typed text as a value of a dictionary type; `undefined` when it is not one */
export const parseValue = (
  type: DictValue['type'],
  text: string,
): DictValue | undefined => {
  if (type === 'bool') {
    if (['true', '1', 'yes'].includes(text.toLowerCase())) {
      return { type, value: true };
    }
    if (['false', '0', 'no'].includes(text.toLowerCase())) {
      return { type, value: false };
    }
    return undefined;
  }
  if (type === 'int' || type === 'real') {
    const number = Number(text);

    if (
      text.trim() === '' ||
      !Number.isFinite(number) ||
      (type === 'int' && !Number.isInteger(number))
    ) {
      return undefined;
    }
    return { type, value: number };
  }
  return { type, value: text };
};

/** Whether a point lies inside a polygon, by the even-odd rule */
export const insidePolygon = (
  [x, y]: [number, number],
  points: readonly [number, number][],
): boolean => {
  let inside = false;

  for (let at = 0, back = points.length - 1; at < points.length; back = at++) {
    const [ax, ay] = points[at];
    const [bx, by] = points[back];

    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
      inside = !inside;
    }
  }
  return inside;
};

/** Size of the drawing in pixels; the canvas itself satisfies it */
export interface CanvasSize {
  width: number;
  height: number;
}

/** Converts world units to canvas pixels; a cell is ten units and the heights start `border` cells out */
export const projectToCanvas = (
  heights: HeightsView,
  size: CanvasSize,
  x: number,
  y: number,
): [number, number] => {
  const scale = size.width / heights.width;
  const cellX = x / 10 + heights.border;
  const cellY = y / 10 + heights.border;

  return [cellX * scale, size.height - cellY * scale];
};

/** Converts canvas pixels to world units, the inverse of `projectToCanvas` */
export const unprojectFromCanvas = (
  heights: HeightsView,
  size: CanvasSize,
  px: number,
  py: number,
): [number, number] => {
  const scale = size.width / heights.width;

  return [
    (px / scale - heights.border) * 10,
    ((size.height - py) / scale - heights.border) * 10,
  ];
};

/** The shaded relief of the height map: RGBA pixels, top row first, and the height range. */
export interface Relief {
  pixels: Uint8ClampedArray;
  low: number;
  high: number;
}

/** Shades the height map: height as brightness, lit from the north west */
export const shadeRelief = (heights: HeightsView): Relief => {
  const { width, height, samples } = heights;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let low = Infinity;
  let high = -Infinity;

  for (let at = 0; at < samples.length; at++) {
    const sample = samples[at];

    if (sample < low) {
      low = sample;
    }
    if (sample > high) {
      high = sample;
    }
  }
  const range = Math.max(1, high - low);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = samples[y * width + x];
      const west = samples[y * width + Math.max(0, x - 1)];
      const north = samples[Math.min(height - 1, y + 1) * width + x];
      const slope = (((here - west) + (here - north)) / range) * 6;
      const level = 70 + ((here - low) / range) * 150 + slope * 60;
      const value = Math.max(0, Math.min(255, level));
      // Rows run south to north; the image runs top down
      const pixel = ((height - 1 - y) * width + x) * 4;

      pixels[pixel] = value * 0.85;
      pixels[pixel + 1] = value * 0.95;
      pixels[pixel + 2] = value * 0.75;
      pixels[pixel + 3] = 255;
    }
  }
  return { pixels, low, high };
};

/** Turns an angle by a step, keeping it between minus pi and pi */
export const turnedAngle = (angle: number, step: number): number => {
  let turned = angle + step;

  while (turned > Math.PI) {
    turned -= Math.PI * 2;
  }
  while (turned < -Math.PI) {
    turned += Math.PI * 2;
  }
  return turned;
};

/** Filters the objects to those whose template or name holds the filter text, ignoring case */
export const filterObjects = (
  objects: readonly ObjectView[],
  filter: string,
): ObjectView[] => {
  const text = filter.toLowerCase();

  return objects.filter(
    (object) =>
      !text ||
      object.template.toLowerCase().includes(text) ||
      nameOf(object).toLowerCase().includes(text),
  );
};
