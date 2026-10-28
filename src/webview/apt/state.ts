import type { PageMovie } from './protocol';

/** What the page shows: the movie, the selection and what was decoded for it */
export interface PageState {
  movie?: PageMovie;
  /** Movies the shown one imports from, by lowercased name */
  library: Map<string, PageMovie>;
  selected: number;
  /** The frame of the selected character's own timeline shown */
  frame: number;
  /** Frames since the selected character started playing; nested timelines run on it */
  tick: number;
  /** Texture path to the canvas holding its pixels */
  textures: Map<string, HTMLCanvasElement>;
  /** The path of the instance the inspector shows */
  inspected?: string;
  /** Unapplied script text by block */
  drafts: Map<number, string>;
  /** Block cards the user opened or closed, by card key, kept across redraws */
  cards: Map<string, boolean>;
}

export const state: PageState = {
  library: new Map(),
  selected: 0,
  frame: 0,
  tick: 0,
  textures: new Map(),
  drafts: new Map(),
  cards: new Map(),
};

/** The movie; the page only runs code that needs it once one arrived */
export const movie = (): PageMovie => state.movie!;
