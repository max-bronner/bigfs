import { getMovieName } from './avm/movieLoad';
import type { Vm } from './avm/vm';
import { describeInstance } from './describeInstance';
import type { Instance } from './instance';
import type { PageMovie } from './protocol';
import type { ScriptQueue } from './scriptQueue';
import { getFrames } from './timeline';

/** The depth of `_level0`'s next sibling: a level sits above every placed depth */
const LEVEL_DEPTH = 1_000_000;

/** What `loadMovie` needs of the player it loads into */
export interface MovieLoadHost {
  queue: ScriptQueue;
  getVm(): Vm | undefined;
  getRoot(): Instance;
  log(line: string): void;
  fetchMovie(name: string, done: (movie: PageMovie | string) => void): void;
  createEmpty(parent: Instance, name: string, depth: number): Instance;
  remove(clip: Instance): void;
  retire(instance: Instance): void;
  queueInitActions(movie: PageMovie, on?: Instance): void;
  enter(timeline: Instance, frame: number): void;
  /** Puts a clip on the list that plays, for one that held nothing to play */
  scheduleClip(clip: Instance): void;
  drainScripts(): void;
}

/**
 * Creates the loader behind `loadMovie` and `unloadMovie`. The returned
 * function loads into a clip, or into a level (a number): the movie a URL
 * names replaces the clip's content, once it is found, and no URL empties it.
 * Nothing here throws; a movie that cannot be had is a line in the log.
 */
export const createMovieLoader = (host: MovieLoadHost) => {
  const findLevelClip = (level: number) =>
    [...host.getRoot().children.values()].find(
      (child) => child.name?.toLowerCase() === `_level${level}`,
    );

  /** Puts a movie's root timeline in a clip or level, playing from frame 0 */
  const mount = (into: Instance | number, movie: PageMovie) => {
    const rootId = movie.characters.findIndex(
      (character) => character?.type === 'movie',
    );
    const clip =
      typeof into === 'number'
        ? (findLevelClip(into) ??
          host.createEmpty(host.getRoot(), `_level${into}`, LEVEL_DEPTH + into))
        : into;

    if (rootId < 0 || clip.removed) {
      host.log(
        `loadMovie: ${movie.name} ${rootId < 0 ? 'has no root timeline' : 'was unloaded before it arrived'}`,
      );
      return;
    }
    clip.children.forEach(host.retire);
    clip.children = new Map();
    clip.hits = [];
    clip.movie = movie;
    clip.id = rootId;
    clip.character = movie.characters[rootId];
    clip.missing = undefined;
    clip.frames = getFrames(movie, clip.character);
    clip.frame = 0;
    clip.playing = true;
    clip.visible = true;
    host.scheduleClip(clip);

    // A movie loaded again runs its init actions again
    const vm = host.getVm();

    vm?.initialised.forEach((key) => {
      if (key.startsWith(`${movie.name}#`)) {
        vm.initialised.delete(key);
      }
    });
    // Runs inside the drain of the script queue: what these queue follows
    host.queueInitActions(movie, clip);
    host.enter(clip, 0);
    host.log(`loadMovie: ${movie.name} is in ${describeInstance(clip)}`);
    host.drainScripts();
  };

  /** `unloadMovie`: the clip stays, empty and stopped; a level goes */
  const unload = (into: Instance | number) => {
    const clip = typeof into === 'number' ? findLevelClip(into) : into;

    if (!clip || clip.removed) {
      return;
    }
    if (typeof into === 'number') {
      host.remove(clip);
      return;
    }
    clip.children.forEach(host.retire);
    clip.children = new Map();
    clip.frames = [];
    clip.frame = 0;
    clip.playing = false;
  };

  return (into: Instance | number, url: string | undefined): void => {
    const log = (line: string) => host.log(`loadMovie: ${line}`);

    if (typeof into !== 'number' && !into.parent) {
      log('the movie shown cannot be replaced or emptied');
      return;
    }
    if (url === undefined) {
      host.queue.add(() => unload(into));
      host.drainScripts();
      return;
    }

    const name = getMovieName(url);

    if (!name) {
      log(`${JSON.stringify(url)} names no movie`);
      return;
    }
    if (into === 0) {
      log(`${name} cannot replace _level0, the movie shown`);
      return;
    }
    host.fetchMovie(name, (found) => {
      if (typeof found === 'string') {
        log(`${name} not loaded: ${found}`);
        return;
      }
      // After the script that asked has finished, as Flash loads on the
      // next frame; a clip gone meanwhile loads nothing
      host.queue.add(() => mount(into, found));
      host.drainScripts();
    });
  };
};
