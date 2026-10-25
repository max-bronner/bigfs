import type { PageMovie } from './protocol';

/** What the page shows: the movie, the selection and what was decoded for it */
export interface PageState {
  movie?: PageMovie;
  /** Movies the shown one imports from, by lowercased name */
  library: Map<string, PageMovie>;
  selected: number;
  frame: number;
  /** Texture path to the canvas holding its pixels */
  textures: Map<string, HTMLCanvasElement>;
  /** Script blocks whose panel is open, kept across redraws */
  openBlocks: Set<number>;
  /** Unapplied script text by block */
  drafts: Map<number, string>;
}

export const state: PageState = {
  library: new Map(),
  selected: 0,
  frame: 0,
  textures: new Map(),
  openBlocks: new Set(),
  drafts: new Map(),
};

/** The movie; the page only runs code that needs it once one arrived */
export const movie = (): PageMovie => state.movie!;
