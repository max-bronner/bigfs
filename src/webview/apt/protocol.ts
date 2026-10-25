import type { AptMovie, Frame } from '../../formats/apt/aptMovie';
import type { RuRun } from '../../formats/apt/aptGeometry';
import type { AptEdit } from '../../formats/apt/aptWriter';

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
  /** Frames whose script always stops the timeline, by timeline character id */
  stops: Record<number, number[]>;
  shapes: Record<number, RuRun[]>;
  /** Image character id to the texture path its pixels are in */
  imageTextures: Record<number, string>;
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
  | { kind: 'openMovie'; name: string };
