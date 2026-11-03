import * as assert from 'assert';
import Module from 'module';
import type { Uri } from 'vscode';
import type { PageMovie, TexturePixels } from '../../webview/apt/protocol';
import type { AptDocument, BuiltMovie } from '../../features/apt/aptDocument';
import type { AptLibrary, MovieLocation } from '../../features/apt/aptLibrary';
import type {
  AptGameServices,
  MovieProgress,
} from '../../features/apt/aptMovieImports';

// The import walk reaches vscode through the library module it takes a name
// from; a plain mocha run has none, so a stub is in place for the require.
type Loader = (request: string, ...rest: unknown[]) => unknown;

const internals = Module as unknown as { _load: Loader };
const original = internals._load;

internals._load = (request, ...rest) =>
  request === 'vscode'
    ? { FileType: { File: 1, Directory: 2 }, EventEmitter: class {} }
    : original.call(Module, request, ...rest);

let imports: typeof import('../../features/apt/aptMovieImports');

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  imports = require('../../features/apt/aptMovieImports');
} finally {
  internals._load = original;
}

const pixels = (): TexturePixels => ({
  width: 1,
  height: 1,
  pixels: new Uint8Array(4),
});

/** A built movie importing the given movies, each for one export */
const built = (
  name: string,
  importing: string[],
  exports: string[] = ['Thing'],
): BuiltMovie => ({
  summary: name,
  movie: {
    name,
    imports: importing.map((movie) => ({ movie, name: 'Thing' })),
    exports: exports.map((each) => ({ name: each, id: 1 })),
    characters: [],
    consts: [],
  } as unknown as PageMovie,
  textures: { [`${name.toLowerCase()}/tex`]: pixels() },
});

const documentOf = (movie: BuiltMovie): AptDocument =>
  ({
    name: movie.movie.name,
    version: 0,
    uri: { toString: () => `apt:/${movie.movie.name}` },
    build: async () => movie,
  }) as unknown as AptDocument;

interface Fixture {
  create: ReturnType<typeof imports.createAptMovieImports>;
  /** Most reads that were under way together */
  concurrent: () => number;
}

/** Imports over movies held in memory; `delay` makes each locate take that long */
const fixture = (movies: BuiltMovie[], delay = 5): Fixture => {
  const documents = new Map(
    movies.map((movie) => [movie.movie.name.toLowerCase(), documentOf(movie)]),
  );
  let active = 0;
  let most = 0;
  const library = {
    async locate(name: string): Promise<MovieLocation | undefined> {
      const key = name.toLowerCase().replace(/\.apt$/, '');

      active++;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active--;
      return documents.has(key)
        ? ({ uri: { toString: () => `apt:/${key}` } as Uri, origin: 'test.big' })
        : undefined;
    },
  } as unknown as AptLibrary;
  const game = {
    gameLanguage: { ensure: async () => undefined },
    index: { stringCount: 0 },
    state: { get: (_key: string, fallback: unknown) => fallback },
  } as unknown as AptGameServices;

  return {
    create: imports.createAptMovieImports({
      library,
      game,
      findDocument: () => undefined,
      load: async (uri) =>
        documents.get(uri.toString().replace('apt:/', ''))!,
    }),
    concurrent: () => most,
  };
};

suite('APT movie imports', () => {
  const root = built('Root', ['LibA', 'LibB', 'Missing']);
  const libA = built('LibA', ['LibC']);
  const libB = built('LibB', []);
  const libC = built('LibC', []);

  test('the movies one level of imports names are read together', async () => {
    const { create, concurrent } = fixture([root, libA, libB, libC]);
    const message = await create.buildMovieMessage(
      documentOf(root),
      new Set(),
      new Map(),
    );

    assert.ok(concurrent() >= 3, `read ${concurrent()} at a time`);
    assert.deepStrictEqual(Object.keys(message.library).sort(), [
      'liba',
      'libb',
      'libc',
    ]);
    assert.deepStrictEqual(message.unresolved, ['Missing:Thing']);
    assert.strictEqual(message.origins.libc, 'test.big');
  });

  test('imports the movies do not export are reported in order', async () => {
    const partial = built('Root', ['LibA', 'LibB']);
    const { create } = fixture([
      partial,
      built('LibA', [], ['Other']),
      built('LibB', []),
    ]);
    const message = await create.buildMovieMessage(
      documentOf(partial),
      new Set(),
      new Map(),
    );

    assert.deepStrictEqual(message.unresolved, ['LibA:Thing']);
  });

  test('the movie is handed over alone before its imports, and not sent twice', async () => {
    const { create } = fixture([root, libA, libB, libC]);
    const order: string[] = [];
    const earlyMessages: Parameters<MovieProgress['early']>[0][] = [];
    const progress: MovieProgress = {
      status: (text) => order.push(`status ${text.slice(0, 7)}`),
      early: async (message) => {
        earlyMessages.push(message);
        order.push('early');
      },
    };
    const message = await create.buildMovieMessage(
      documentOf(root),
      new Set(),
      new Map(),
      progress,
    );

    assert.strictEqual(earlyMessages.length, 1);
    assert.deepStrictEqual(earlyMessages[0].library, {});
    assert.deepStrictEqual(Object.keys(earlyMessages[0].textures), [
      'root/tex',
    ]);
    // Textures go once: the root's with the early message, the rest with the last
    assert.ok(!('root/tex' in message.textures));
    assert.deepStrictEqual(Object.keys(message.textures).sort(), [
      'liba/tex',
      'libb/tex',
      'libc/tex',
    ]);
    assert.deepStrictEqual(order.slice(0, 2), ['status Reading', 'early']);
  });

  test('a movie with no imports is not handed over twice', async () => {
    const alone = built('Alone', []);
    const { create } = fixture([alone]);
    let early = 0;
    const message = await create.buildMovieMessage(
      documentOf(alone),
      new Set(),
      new Map(),
      { status: () => undefined, early: async () => void early++ },
    );

    assert.strictEqual(early, 0);
    assert.deepStrictEqual(Object.keys(message.textures), ['alone/tex']);
  });
});
