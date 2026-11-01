import type { Character, Frame, Matrix2 } from '../../formats/apt/aptMovie';
import type { PageMovie } from './protocol';
import type { ColorTransform } from './timeline';

/** A placed character in the player's display tree, with its own playhead when it has a timeline */
export interface Instance {
  /** Depths down from the root, `/` separated; a button record is `b<depth>` */
  path: string;
  movie: PageMovie;
  id: number;
  /** Absent for an import nothing fills */
  character?: Character;
  /** The import's `movie:name`, for one nothing fills */
  missing?: string;
  parent?: Instance;
  /** The instance name it was placed with */
  name?: string;
  /** Where it sits in its parent */
  matrix: Matrix2;
  translate: [number, number];
  alpha: number;
  /** For a mask: the deepest depth above it that it clips */
  clipDepth?: number;
  /** `onClipEvent` handlers its placement carries */
  clipActions?: { events: number; block: number }[];
  /** The colour a script set with `Color`, over what the timeline places */
  tint?: ColorTransform;
  /** False once a script hides it */
  visible?: boolean;
  /** A text field's text, once a script sets it */
  text?: string;
  /** Moved by a script, so its timeline no longer moves it */
  scripted?: boolean;
  /** Made by a script (`attachMovie`, ...) rather than placed by the timeline */
  dynamic?: boolean;
  /** Taken off the stage; its running code stops */
  removed?: boolean;
  /** The frame its parent placed it in, which tells a move from a new instance */
  born: number;
  /** The character id it was placed with, before any import resolved it */
  placed: number;
  /** The PlaceObject records it came from in its parent's timeline, if any */
  placedItem?: number;
  matrixItem?: number;
  frames: Frame[];
  frame: number;
  playing: boolean;
  /** Placed children by depth; a button's shown records by `b<depth>` */
  children: Map<string, Instance>;
  /** A button's hit-test records */
  hits: Instance[];
  /** Part of a hit record: an area, so nothing in it runs */
  isHitRecord?: boolean;
  buttonState: number;
  /** A state the inspector holds the button in */
  forced?: number;
}

/** Whether an instance has a timeline of its own */
export const isTimeline = (instance: Instance): boolean =>
  instance.character?.type === 'sprite' || instance.character?.type === 'movie';
