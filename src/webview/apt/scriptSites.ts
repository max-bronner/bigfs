/**
 * Where scripts run and when: the names of SWF button conditions and clip
 * events by bit (mint's apt-format research: button conditions in SWF's
 * BUTTONCONDACTION order, clip events as Ruffle numbers them).
 */

export const BUTTON_CONDITIONS: [string, number][] = [
  ['rollOver', 0x1],
  ['rollOut', 0x2],
  ['press', 0x4],
  ['release', 0x8],
  ['dragOut', 0x10],
  ['dragOver', 0x20],
  ['releaseOutside', 0x40],
  ['idleToOverDown', 0x80],
  ['overDownToIdle', 0x100],
];

export const CLIP_EVENTS: [string, number][] = [
  ['load', 1 << 0],
  ['enterFrame', 1 << 1],
  ['unload', 1 << 2],
  ['mouseMove', 1 << 3],
  ['mouseDown', 1 << 4],
  ['mouseUp', 1 << 5],
  ['keyDown', 1 << 6],
  ['keyUp', 1 << 7],
  ['data', 1 << 8],
  ['initialize', 1 << 9],
  ['press', 1 << 10],
  ['release', 1 << 11],
  ['releaseOutside', 1 << 12],
  ['rollOver', 1 << 13],
  ['rollOut', 1 << 14],
  ['dragOver', 1 << 15],
  ['dragOut', 1 << 16],
  ['keyPress', 1 << 17],
  ['construct', 1 << 18],
];

/** The names of the bits set, and any left over as hex */
export const bitNames = (value: number, names: [string, number][]): string => {
  const known = names.filter(([, bit]) => value & bit).map(([name]) => name);
  const rest = names.reduce((left, [, bit]) => left & ~bit, value >>> 0);

  return (
    [...known, ...(rest ? ['0x' + rest.toString(16)] : [])].join('|') || '0'
  );
};

/** A select of the named bits, one chosen */
export const bitSelect = (
  names: [string, number][],
  chosen: number,
): HTMLSelectElement => {
  const element = document.createElement('select');

  for (const [name, bit] of names) {
    element.add(new Option(name, String(bit), false, bit === chosen));
  }
  return element;
};
