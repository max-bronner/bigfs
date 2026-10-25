import type { AptMovie, Frame } from '../../formats/apt/aptMovie';
import type { RuRun } from '../../formats/apt/aptGeometry';
import type { AptEdit } from '../../formats/apt/aptWriter';

/**
 * The messages between the APT editor and its page. Shared by both sides,
 * so it must stay free of DOM and Node types.
 */

/** A movie as the page draws it: parsed, with its geometry and texture names */
export type PageMovie = AptMovie & {
  spriteFrames: Record<number, Frame[]>;
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
  | { kind: 'openGeometry'; geometry: number };
