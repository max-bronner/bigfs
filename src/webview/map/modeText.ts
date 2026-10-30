/** What a click on the map does now: place a template, or add a point to a trigger area */
export type MapMode =
  | { kind: 'place'; template: string; waypoint: boolean }
  | { kind: 'area' };

/** What the hint line says while a mode is on. */
export const describeMode = (mode: MapMode | undefined): string =>
  !mode
    ? ''
    : mode.kind === 'place'
      ? `Click the map to place ${mode.template} · Esc cancels`
      : 'Click the map to add points · Enter finishes · Backspace removes the last · Esc cancels';

/** The name a new trigger area gets: the first `Area <n>` no area has. */
export const nextAreaName = (taken: ReadonlySet<string>): string => {
  let number = taken.size + 1;

  while (taken.has(`Area ${number}`)) {
    number++;
  }
  return `Area ${number}`;
};
