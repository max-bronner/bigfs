import * as assert from 'assert';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import { compileScript } from '../../formats/apt/aptCompiler';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/writer/aptImage';
import { Engine } from '../../webview/apt/avm/engine';
import {
  isWindowTarget,
  parseLevel,
  getMovieName,
  getSoundEvent,
} from '../../webview/apt/avm/movieLoad';
import { Player } from '../../webview/apt/player';
import type { PageMovie } from '../../webview/apt/protocol';

/**
 * Movies a script loads into a clip or level, and the sounds a movie asks
 * the engine for (ported from mint's apt-player `load.rs` and `expose.rs`).
 */

const place = (depth: number, character: number, name?: string): FrameItem =>
  ({
    offset: 0,
    type: 'placeObject',
    flags: 0,
    depth,
    character,
    name,
  }) as FrameItem;

/** A movie whose root places the named sprites and runs a script, if given */
const movieWith = (
  name: string,
  children: string[],
  script?: string,
): PageMovie => {
  const image = new AptImage(new Uint8Array(64));
  const items: FrameItem[] = children.map((child, at) =>
    place(at + 1, 1, child),
  );
  const code: PageMovie['code'] = {};

  if (script) {
    const block = compileScript(parseScript(script), image, []);

    items.push({ offset: 0, type: 'action', block } as FrameItem);
    code[block] = decodeBlock(image.bytes, block);
  }
  return {
    name,
    record: { screenWidth: 100, screenHeight: 100 },
    characters: [
      { id: 0, offset: 0, type: 'movie' },
      { id: 1, offset: 0, type: 'sprite' },
    ],
    imports: [],
    exports: [],
    frames: [{ items }, { items: [] }],
    spriteFrames: { 1: [{ items: [] }] },
    shapes: {},
    imageTextures: {},
    behaviours: {},
    code,
    consts: [],
  } as unknown as PageMovie;
};

type Fetch = (name: string, done: (movie: PageMovie | string) => void) => void;

const start = (
  host: PageMovie,
  fetchMovie: Fetch,
  onSound: (event: string) => void = () => {},
) => {
  const lines: string[] = [];
  const engine = new Engine(
    () => {},
    (line) => lines.push(line),
    onSound,
  );

  engine.reset(host);

  const player = new Player(host, 0, {
    resolve: (from, id) =>
      from.characters[id] && {
        movie: from,
        id,
        character: from.characters[id],
      },
    scripts: true,
    rootScripts: true,
    log: (line) => lines.push(line),
    engine,
    fetchMovie,
  });

  return { player, engine, lines };
};

const child = movieWith('Child', ['inner']);
const library =
  (movies: PageMovie[]): Fetch =>
  (name, done) => {
    const found = movies.find((each) => each.name.toLowerCase() === name);

    done(found ?? `no install holds ${name}.apt`);
  };

suite('APT loading movies and playing movie sounds', () => {
  test('a URL names a movie by its file stem', () => {
    assert.strictEqual(getMovieName('InGameHeroSelect.swf'), 'ingameheroselect');
    assert.strictEqual(getMovieName('art\\Skirmish.apt'), 'skirmish');
    assert.strictEqual(getMovieName('Palantir'), 'palantir');
    assert.strictEqual(getMovieName('.swf'), undefined);
    assert.strictEqual(parseLevel('_level2'), 2);
    assert.strictEqual(parseLevel('_level0.a'), undefined);
    assert.ok(isWindowTarget('_blank') && isWindowTarget(''));
    assert.ok(!isWindowTarget('_level0.slot'));
  });

  test('loadMovie puts the movie in the clip and plays it', () => {
    const host = movieWith(
      'Host',
      ['slot'],
      'slot.loadMovie("art/Child.apt");',
    );
    const { player, lines } = start(host, library([child]));
    const slot = player.find('/1')!;

    assert.strictEqual(slot.movie.name, 'Child');
    assert.deepStrictEqual(
      [...slot.children.values()].map((each) => each.name),
      ['inner'],
    );
    assert.ok(lines.some((line) => line.includes('Child is in')));
  });

  test('getURL to a clip target loads, to a window it does not', () => {
    const into = start(
      movieWith('Host', ['slot'], '#GetUrl2("Child.apt", "_level0.slot");'),
      library([child]),
    );

    assert.strictEqual(into.player.find('/1')!.movie.name, 'Child');

    const window = start(
      movieWith('Host', ['slot'], '#GetUrl2("Child.apt", "_blank");'),
      library([child]),
    );

    assert.strictEqual(window.player.find('/1')!.movie.name, 'Host');
  });

  test('loadMovieNum mounts a level above the movie, which scripts can name', () => {
    const { player } = start(
      movieWith('Host', ['slot'], 'loadMovieNum("Child", 1); done = 1;'),
      library([child]),
    );
    const level = [...player.root.children.values()].find(
      (each) => each.name === '_level1',
    );

    assert.strictEqual(level?.movie.name, 'Child');
    assert.strictEqual(level?.children.size, 1);
  });

  test('unloadMovie empties the clip and stops it', () => {
    const { player } = start(
      movieWith(
        'Host',
        ['slot'],
        'slot.loadMovie("Child"); slot.unloadMovie();',
      ),
      library([child]),
    );
    const slot = player.find('/1')!;

    assert.strictEqual(slot.children.size, 0);
    assert.strictEqual(slot.playing, false);
  });

  test('the root cannot be replaced or emptied by a load', () => {
    const { player, lines } = start(
      movieWith('Host', ['slot'], 'loadMovie("", "slot");'),
      library([child]),
    );

    assert.strictEqual(player.root.children.size, 1);
    assert.ok(lines.some((line) => line.includes('cannot be replaced')));
  });

  test('a movie that cannot be found is a log line, not a throw', () => {
    const { player, lines } = start(
      movieWith('Host', ['slot'], 'slot.loadMovie("Missing");'),
      library([]),
    );

    assert.strictEqual(player.find('/1')!.movie.name, 'Host');
    assert.ok(
      lines.some((line) => line.includes('missing not loaded: no install')),
    );
  });

  test('a movie that arrives later is mounted when it does', () => {
    const waiting: ((movie: PageMovie | string) => void)[] = [];
    const { player } = start(
      movieWith('Host', ['slot'], 'slot.loadMovie("Child");'),
      (_, done) => waiting.push(done),
    );

    assert.strictEqual(player.find('/1')!.movie.name, 'Host');
    waiting[0](child);
    assert.strictEqual(player.find('/1')!.movie.name, 'Child');
  });

  test('a PlaySound command is recognised however it is scoped', () => {
    assert.strictEqual(
      getSoundEvent('FSCommand:PlaySound', ['Gui_Click']),
      'Gui_Click',
    );
    assert.strictEqual(
      getSoundEvent('FSCommand:AptMenu::PlaySound', ['Gui_Click']),
      'Gui_Click',
    );
    assert.strictEqual(
      getSoundEvent('GameCode', ['AptMenu::PlaySound', 'A', 'B']),
      'A,B',
    );
    assert.strictEqual(getSoundEvent('FSCommand:Other', ['x']), undefined);
    assert.strictEqual(getSoundEvent('FSCommand:PlaySound', []), undefined);
  });

  test('movie sounds are listed and logged, and play only when allowed', () => {
    const played: string[] = [];
    const { engine, lines } = start(
      movieWith(
        'Host',
        [],
        '#GetUrl2("FSCommand:PlaySound", "Gui_Click"); #GetUrl2("FSCommand:PlaySound", "Gui_Click");',
      ),
      library([]),
      (event) => played.push(event),
    );

    assert.deepStrictEqual(
      [...engine.sounds.values()],
      [{ event: 'Gui_Click', count: 2 }],
    );
    assert.ok(lines.some((line) => line.startsWith('movie sound: Gui_Click')));
    assert.deepStrictEqual(played, [], 'off by default');
    assert.strictEqual(engine.save().overrides !== undefined, true);
    assert.ok(!('playMovieSounds' in engine.save()), 'never persisted');

    engine.playSound('Gui_Click');
    assert.deepStrictEqual(played, ['Gui_Click'], 'the button plays once');

    engine.playMovieSounds = true;
    engine.call('FSCommand:PlaySound', ['Gui_Other']);
    assert.deepStrictEqual(played, ['Gui_Click', 'Gui_Other']);
  });
});
