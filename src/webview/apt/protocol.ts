import type { AptMovie, Frame } from '../../formats/apt/aptMovie';
import type { DatLocation, RuRun } from '../../formats/apt/aptGeometry';
import type { AptEdit } from '../../formats/apt/aptWriter';
import type { Behaviour } from '../../formats/apt/aptBehaviour';
import type { AptInstruction } from '../../formats/apt/aptBytecode';
import type { Problem } from '../../formats/apt/aptIntegrity';
import type { EngineValues } from './avm/engine';

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
  /** Every action block decoded, by block offset, for the preview to run */
  code?: Record<number, AptInstruction[]>;
  /** The `.const` file's items, which `PushData` and pools read */
  consts?: (string | number)[];
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
      /**
       * Each `$KEY` string the movies hold as the game's language reads it,
       * by lowercased key as written; none when no string table is loaded
       */
      texts?: Record<string, string>;
      /** The Engine panel's answers kept for this movie in the workspace */
      answers?: EngineValues;
    }
  | {
      kind: 'movieLoaded';
      /** The movie asked for, as imports name it */
      name: string;
      /** Why it could not be found or read; the rest is then absent */
      error?: string;
      /** The movie and what its imports reach, as `movie` sends them */
      library?: Record<string, PageMovie>;
      textures?: Record<string, TexturePixels>;
      unresolved?: string[];
      origins?: Record<string, string>;
      texts?: Record<string, string>;
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
  /** The Engine panel's answers for the shown movie, to keep in the workspace */
  | { kind: 'engineAnswers'; values: EngineValues }
  /** A script loaded a movie into a clip or level: find it like an import */
  | { kind: 'loadMovie'; name: string }
  /** The Engine panel's play button, or a movie sound with the box ticked */
  | { kind: 'playSound'; name: string }
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
