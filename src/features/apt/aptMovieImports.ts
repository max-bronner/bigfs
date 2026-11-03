import type * as vscode from 'vscode';
import type {
  PageMovie,
  TexturePixels,
  ToPage,
} from '../../webview/apt/protocol';
import { collectTextKeys, resolveAptText } from '../../formats/apt/aptText';
import type { GameLanguage } from '../../services/ini/gameLanguage';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import type { AptDocument, BuiltMovie } from './aptDocument';
import type { AptLibrary, MovieLocation } from './aptLibrary';
import { toMovieKey } from './aptLibrary';
import { describeError } from '../../core/errors';
import { readEngineAnswers } from './aptEngineAnswers';

/** Game services a movie reads beside its own files */
export interface AptGameServices {
  /** Settles the language `$KEY` text is read in */
  gameLanguage: GameLanguage;
  index: SageIniIndex;
  /** The INI schema and parses the lookups of the Engine panel's suggestions read through */
  documents: SageIniDocuments;
  /** Where the Engine panel's answers are kept, per movie */
  state: vscode.Memento;
}

type MovieMessage = Extract<ToPage, { kind: 'movie' }>;
type MovieLoadedMessage = Extract<ToPage, { kind: 'movieLoaded' }>;

/** State of one import walk: what it has found so far, and what the page was already sent */
interface ImportWalk {
  movies: Map<string, PageMovie>;
  library: Record<string, PageMovie>;
  textures: Record<string, TexturePixels>;
  unresolved: string[];
  origins: Record<string, string>;
  sentTextures: Set<string>;
  sentMovies: Map<string, string>;
  /** Tells the page which movies the walk is reading */
  status?: (text: string) => void;
}

/** An imported movie read and built, not yet taken into a walk */
interface FetchedMovie {
  location: MovieLocation;
  /** What the page is told this version of the movie is */
  stamp: string;
  page: PageMovie;
  textures: Record<string, TexturePixels>;
}

/** What a build reports to the page while it works */
export interface MovieProgress {
  /** Says what the build is doing; the page shows the last thing said */
  status(text: string): void;
  /**
   * Hands over the movie on its own, with its own textures, before its
   * imports are followed, so the page can draw it at once
   */
  early(message: MovieMessage): Promise<void>;
}

/** How far imports are followed, and how many movies at most, against loops */
const MAX_IMPORT_DEPTH = 8;
const MAX_IMPORTED_MOVIES = 64;

/** Callbacks the import walk reaches the editor and the game through */
export interface AptMovieImportsHost {
  /** Finds the movies imports name, the way the game does */
  library: AptLibrary;
  game: AptGameServices;
  /** Finds an open movie by `.apt` uri, as edited */
  findDocument(key: string): AptDocument | undefined;
  /** Reads a movie that is not open */
  load(uri: vscode.Uri): Promise<AptDocument>;
}

/**
 * Import walk building the movies a page draws beside its own: what its
 * imports and `loadMovie` calls reach through the install, built once per
 * version, with what the page already holds left out
 */
export interface AptMovieImports {
  /**
   * Builds what a page shows for a movie: the movie, and every movie its
   * imports reach, followed through their own imports. Movies and textures
   * the page already has are left out; it keeps them.
   */
  buildMovieMessage(
    document: AptDocument,
    sentTextures: Set<string>,
    sentMovies: Map<string, string>,
    progress?: MovieProgress,
  ): Promise<MovieMessage>;
  /**
   * Builds what a page needs to mount a movie a script loaded
   * (`loadMovie`): the movie found through the load order like an import,
   * the movies its own imports reach and their textures. A name no install
   * holds, or a file that does not read, answers with the reason instead of
   * throwing.
   */
  buildLoadedMovieMessage(
    name: string,
    sentTextures: Set<string>,
    sentMovies: Map<string, string>,
  ): Promise<MovieLoadedMessage>;
  /** Forgets every movie read or built, so each is read afresh */
  forget(): void;
}

/** Creates the import walk an APT editor draws imported movies with */
export const createAptMovieImports = ({
  library,
  game,
  findDocument,
  load,
}: AptMovieImportsHost): AptMovieImports => {
  // Imported movies that are not open, read once, by `.apt` uri
  const loaded = new Map<string, Promise<AptDocument | undefined>>();

  // Imported movies as last built, by `.apt` uri, with the stamp built from
  const built = new Map<string, { stamp: string; movie: Promise<BuiltMovie> }>();

  // Goes up whenever the library forgets, so every movie is read afresh
  let generation = 0;

  /** Gets the movie at an imported location: an open one as edited, else as read */
  const getImportedMovie = (
    location: MovieLocation,
  ): Promise<AptDocument | undefined> => {
    const key = location.uri.toString();
    const open = findDocument(key);

    if (open) {
      return Promise.resolve(open);
    }

    let movie = loaded.get(key);

    if (!movie) {
      movie = load(location.uri).catch(() => undefined);
      loaded.set(key, movie);
    }
    return movie;
  };

  const createWalk = (
    sentTextures: Set<string>,
    sentMovies: Map<string, string>,
  ): ImportWalk => ({
    movies: new Map(),
    library: {},
    textures: {},
    unresolved: [],
    origins: {},
    sentTextures,
    sentMovies,
  });

  /** Adds the textures the page was not sent yet */
  const takeUnsentTextures = (
    walk: ImportWalk,
    all: Record<string, TexturePixels>,
  ): void => {
    for (const [key, texture] of Object.entries(all)) {
      if (!walk.sentTextures.has(key)) {
        walk.textures[key] = texture;
        walk.sentTextures.add(key);
      }
    }
  };

  /** Builds the movie at a location for the page, once per version */
  const buildImported = async (
    location: MovieLocation,
    source: AptDocument,
  ): Promise<FetchedMovie> => {
    const stamp = `${location.uri.toString()}#${source.version}#${generation}`;
    let entry = built.get(location.uri.toString());

    if (entry?.stamp !== stamp) {
      entry = { stamp, movie: source.build() };
      built.set(location.uri.toString(), entry);
    }

    const { movie, textures } = await entry.movie;

    return {
      location,
      stamp,
      page: { ...movie, origin: location.origin },
      textures,
    };
  };

  /** Finds a movie by the name an import gives it, read and built; none when no install holds it */
  const readImported = async (
    name: string,
  ): Promise<FetchedMovie | undefined> => {
    const location = await library.locate(name);
    const source = location && (await getImportedMovie(location));

    return location && source ? buildImported(location, source) : undefined;
  };

  /**
   * Takes a built movie into the walk, with its textures. It joins the
   * walk's library unless the page already holds this version.
   */
  const takeMovie = (
    walk: ImportWalk,
    key: string,
    { location, stamp, page, textures }: FetchedMovie,
  ): PageMovie => {
    walk.movies.set(key, page);
    walk.origins[key] = location.origin;
    takeUnsentTextures(walk, textures);
    if (walk.sentMovies.get(key) !== stamp) {
      walk.library[key] = page;
      walk.sentMovies.set(key, stamp);
    }
    return page;
  };

  /**
   * Follows the imports of the queued movies through the install, filling
   * the walk. The movies one level of imports names are read together.
   * Returns how many imports it looked at.
   */
  const followImports = async (
    walk: ImportWalk,
    queue: { movie: PageMovie; depth: number }[],
  ): Promise<number> => {
    let attempted = 0;

    while (queue.length) {
      const level = queue.splice(0);
      const wanted = new Map<string, string>();

      for (const { movie, depth } of level) {
        for (const entry of depth < MAX_IMPORT_DEPTH ? movie.imports : []) {
          const key = toMovieKey(entry.movie);

          if (!walk.movies.has(key) && !wanted.has(key)) {
            wanted.set(key, entry.movie);
          }
        }
      }

      const room = Math.max(0, MAX_IMPORTED_MOVIES + 1 - walk.movies.size);
      const reads = [...wanted].slice(0, room);

      if (reads.length) {
        walk.status?.(
          `Reading imported movies: ${reads
            .slice(0, 4)
            .map(([key]) => key)
            .join(', ')}${reads.length > 4 ? ` and ${reads.length - 4} more` : ''}…`,
        );
      }

      const fetched = new Map(
        await Promise.all(
          reads.map(
            async ([key, name]) => [key, await readImported(name)] as const,
          ),
        ),
      );

      for (const { movie, depth } of level) {
        for (const entry of movie.imports) {
          const key = toMovieKey(entry.movie);
          const read = fetched.get(key);

          attempted++;

          if (read && !walk.movies.has(key)) {
            queue.push({ movie: takeMovie(walk, key, read), depth: depth + 1 });
          }

          const target = walk.movies.get(key);

          if (
            !target?.exports.some(
              (each) => each.name.toLowerCase() === entry.name.toLowerCase(),
            )
          ) {
            walk.unresolved.push(`${entry.movie}:${entry.name}`);
          }
        }
      }
    }
    return attempted;
  };

  /**
   * Resolves every `$KEY` string the movies hold, as the chosen language reads
   * it, by the key as written. None when no string table is loaded, in which case
   * the page shows the keys.
   */
  const resolveTexts = async (
    movies: readonly PageMovie[],
  ): Promise<Record<string, string> | undefined> => {
    await game.gameLanguage.ensure();

    if (!game.index.stringCount) {
      return undefined;
    }

    const keys = collectTextKeys(
      movies.flatMap((movie) => [
        ...(movie.consts ?? []),
        ...movie.characters.flatMap((character) =>
          character.type === 'editText' ? [character.text] : [],
        ),
      ]),
    );

    return Object.fromEntries(
      keys.map((key) => [
        key.toLowerCase(),
        resolveAptText(key, (label) => game.index.findString(label)?.text),
      ]),
    );
  };

  const loadedMovie = async (
    name: string,
    sentTextures: Set<string>,
    sentMovies: Map<string, string>,
  ): Promise<MovieLoadedMessage> => {
    const key = toMovieKey(name);
    const failed = (error: string) =>
      ({ kind: 'movieLoaded', name: key, error }) as const;

    try {
      const location = await library.locate(key);

      if (!location) {
        return failed(`no install holds ${key}.apt`);
      }

      const source = await getImportedMovie(location);

      if (!source) {
        return failed(`${key}.apt at ${location.origin} does not read`);
      }

      const walk = createWalk(sentTextures, sentMovies);
      const movie = takeMovie(
        walk,
        key,
        await buildImported(location, source),
      );

      // The page may hold this version already; it is sent again so a
      // mount never depends on what it kept
      walk.library[key] = movie;
      await followImports(walk, [{ movie, depth: 0 }]);
      return {
        kind: 'movieLoaded',
        name: key,
        library: walk.library,
        textures: walk.textures,
        unresolved: walk.unresolved,
        origins: walk.origins,
        texts: await resolveTexts([...walk.movies.values()]),
      };
    } catch (error) {
      return failed(describeError(error));
    }
  };

  const movieMessage = async (
    document: AptDocument,
    sentTextures: Set<string>,
    sentMovies: Map<string, string>,
    progress?: MovieProgress,
  ): Promise<MovieMessage> => {
    progress?.status(`Reading ${document.name}…`);

    const root = await document.build();
    const walk = createWalk(sentTextures, sentMovies);
    const answers = readEngineAnswers(game.state)[toMovieKey(document.name)];
    let early: Promise<void> | undefined;

    walk.status = progress?.status;
    walk.movies.set(toMovieKey(document.name), root.movie);
    takeUnsentTextures(walk, root.textures);

    if (progress && root.movie.imports.length) {
      early = progress.early({
        kind: 'movie',
        summary: root.summary,
        movie: root.movie,
        textures: walk.textures,
        library: {},
        unresolved: [],
        origins: {},
        texts: await resolveTexts([root.movie]),
        answers,
      });
      early.catch(() => undefined);
      walk.textures = {};
    }

    const attempted = await followImports(walk, [{ movie: root.movie, depth: 0 }]);

    await early;
    const { movies, library: sent, textures, unresolved, origins } = walk;

    const imports = attempted
      ? `imports ${attempted - unresolved.length} of ${attempted} resolved across ${movies.size - 1} movies` +
        (unresolved.length
          ? ` (unresolved: ${unresolved.slice(0, 6).join(', ')}${unresolved.length > 6 ? '…' : ''})`
          : '')
      : '';

    return {
      kind: 'movie',
      summary: [root.summary, imports].filter(Boolean).join(' · '),
      movie: root.movie,
      textures,
      library: sent,
      unresolved,
      origins,
      texts: await resolveTexts([...movies.values()]),
      answers,
    };
  };

  return {
    buildMovieMessage: movieMessage,
    buildLoadedMovieMessage: loadedMovie,
    forget() {
      loaded.clear();
      built.clear();
      generation++;
    },
  };
};
