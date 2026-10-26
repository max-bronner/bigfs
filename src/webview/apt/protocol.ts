import type { AptMovie, Frame } from '../../formats/apt/aptMovie';
import type { DatLocation, RuRun } from '../../formats/apt/aptGeometry';
import type { AptEdit } from '../../formats/apt/aptWriter';
import type { Behaviour } from '../../formats/apt/aptBehaviour';
import type { Problem } from '../../formats/apt/aptIntegrity';

/**
 * The messages between the APT editor and its page. Shared by both sides,
 * so it must stay free of DOM and Node types.
 */

/** A movie as the page draws it: parsed, with its geometry and texture names */
export type PageMovie = AptMovie & {
  /** The movie's name, as imports name it */
  name: string;
  /** Where it was loaded from, for a movie another one imports */
  origin?: string;
  spriteFrames: Record<number, Frame[]>;
  /** What each action block does to timelines, by block offset */
  behaviours: Record<number, Behaviour>;
  shapes: Record<number, RuRun[]>;
  /** Image character id to the texture path its pixels are in */
  imageTextures: Record<number, string>;
  /** Image character id to where the `.dat` puts it */
  imageLocations: Record<number, DatLocation>;
};

export interface TexturePixels {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export type ToPage =
  | {
      kind: 'movie';
      summary: string;
      movie: PageMovie;
      /** Textures not sent before; the page keeps every one it was sent */
      textures: Record<string, TexturePixels>;
      /**
       * Movies the shown one imports from, directly or through another, by
       * lowercased name; only those that changed since they were last sent
       */
      library: Record<string, PageMovie>;
      /** Imports no movie could fill, as `movie:name` */
      unresolved: string[];
      /** Where each movie reached through imports was loaded from */
      origins: Record<string, string>;
    }
  | { kind: 'select'; character: number }
  /** What the integrity check found in the movie and the files beside it */
  | { kind: 'integrity'; problems: Problem[] }
  | {
      kind: 'script';
      block: number;
      text: string;
      mode: 'script' | 'assembly' | 'listing';
      note?: string;
    }
  | { kind: 'scriptSaved'; block: number; previous: number }
  | { kind: 'notice'; message: string }
  | { kind: 'error'; message: string };

export type FromPage =
  | { kind: 'ready' }
  | { kind: 'script'; block: number }
  | { kind: 'edit'; edit: AptEdit }
  | { kind: 'scriptEdit'; block: number; text: string }
  | { kind: 'openGeometry'; geometry: number }
  | { kind: 'openMovie'; name: string }
  /** Removes a character nothing refers to, with its own files */
  | { kind: 'removeCharacter'; id: number }
  | { kind: 'manageMovie'; action: 'rename' | 'delete' }
  /** Opens a block in its own editor tab */
  | { kind: 'openScript'; block: number; label: string }
  /** Attaches a new, empty script and opens it */
  | {
      kind: 'addScript';
      label: string;
      to:
        | { kind: 'frame'; timeline: number; frame: number }
        | { kind: 'button'; id: number; condition: number }
        | { kind: 'clip'; offset: number; events: number };
    }
  /** A shape's runs, all of them, to write as its geometry */
  | { kind: 'geometry'; shape: number; runs: RuRun[] }
  /** An image to add as a new texture, laid over a shape's run when given */
  | {
      kind: 'importTexture';
      width: number;
      height: number;
      pixels: Uint8Array;
      assign?: { shape: number; run: number; runs: RuRun[] };
    };

/** Playback speeds offered, as multiples of the game's 30 frames a second */
export const SPEEDS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8];
