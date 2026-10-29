import type { MapMode } from './modeText';

/** What the panels ask of the page: they cannot import it, which would make a cycle */
export interface MapActions {
  /** Selects an object, or none, and redraws everything that shows the selection */
  select(index: number | undefined): void;
  /** Selects a trigger area, or none, and redraws */
  selectArea(index: number | undefined): void;
  /** Starts or leaves placing an object or drawing an area */
  setMode(mode: MapMode | undefined): void;
}
