import { getVsCodeApi } from '../shared/vscodeApi';
import { mergeGameText } from './gameText';
import type { FromPage, PageMovie, ToPage, TexturePixels } from './protocol';
import { toMovieKey, findMovieNamed } from './resolve';
import { state } from './state';

const vscode = getVsCodeApi<FromPage>();

/**
 * The movies scripts load (`loadMovie`): the page asks the editor for a
 * movie it does not hold, which finds it through the game's load order like
 * an import, and answers with it and what it imports.
 */

type Done = (movie: PageMovie | string) => void;

/** Callers waiting for a movie the editor was asked for, by movie key */
const waiting = new Map<string, Done[]>();

/** Keeps the pixels a message sends as canvases, by texture path */
export const storeTextures = (
  textures: Record<string, TexturePixels>,
): void => {
  for (const [path, texture] of Object.entries(textures)) {
    const canvas = document.createElement('canvas');

    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas
      .getContext('2d')!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(texture.pixels),
          texture.width,
          texture.height,
        ),
        0,
        0,
      );
    state.textures.set(path, canvas);
  }
};

/** Hands the movie of a name to `done`, now if the page holds it, else once the editor sends it */
export const fetchMovie = (name: string, done: Done): void => {
  const key = toMovieKey(name);
  const known = findMovieNamed(key);

  if (known) {
    done(known);
    return;
  }

  const others = waiting.get(key);

  if (others) {
    others.push(done);
    return;
  }
  waiting.set(key, [done]);
  vscode.postMessage({ kind: 'loadMovie', name: key });
};

/** Takes the editor's answer to a request and tells everyone waiting for it */
export const movieArrived = (
  data: Extract<ToPage, { kind: 'movieLoaded' }>,
): void => {
  const callers = waiting.get(data.name) ?? [];

  waiting.delete(data.name);
  if (!data.error) {
    for (const [key, imported] of Object.entries(data.library ?? {})) {
      state.library.set(key, imported);
    }
    storeTextures(data.textures ?? {});
    mergeGameText(data.texts);
  }

  const movie = data.error ? undefined : findMovieNamed(data.name);
  const result = movie ?? data.error ?? 'the editor sent nothing';

  callers.forEach((done) => done(result));
};
