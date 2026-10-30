/** Editing mode of the map page, which decides what a click does: place a template, or add a point to a trigger area */
export type MapMode =
  | { kind: 'place'; template: string; waypoint: boolean }
  | { kind: 'area' };

/** Formats the hint line shown while a mode is on; empty with no mode */
export const describeMode = (mode: MapMode | undefined): string =>
  !mode
    ? ''
    : mode.kind === 'place'
      ? `Click the map to place ${mode.template} · Esc cancels`
      : 'Click the map to add points · Enter finishes · Backspace removes the last · Esc cancels';

/** Picks the name a new trigger area gets: the first `Area <n>` no area has */
export const pickAreaName = (taken: ReadonlySet<string>): string => {
  let number = taken.size + 1;

  while (taken.has(`Area ${number}`)) {
    number++;
  }
  return `Area ${number}`;
};
