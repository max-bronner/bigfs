import * as assert from 'assert';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import { compileScript } from '../../formats/apt/aptCompiler';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/aptWriter';
import { Engine, parseTyped } from '../../webview/apt/avm/engine';
import { Player } from '../../webview/apt/player';
import type { PageMovie } from '../../webview/apt/protocol';

/**
 * The preview's ActionScript machine against a movie shaped like the
 * palantir (mint's palantir research, point 7): a root script defines a
 * function its own code never calls, which the engine calls to switch a
 * named clip to the faction's label; it reads a value nothing sets, asks
 * an extern and calls the engine.
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

const label = (text: string): FrameItem =>
  ({
    offset: 0,
    type: 'frameLabel',
    label: text,
    flags: 0,
    frame: 0,
  }) as FrameItem;

const ROOT_SCRIPT = `
function SetPlayerFaction(faction) {
  ring.gotoAndStop(faction);
}
if (side == "evil") {
  banner.gotoAndStop("evil");
}
shown = GetExtern("Game::ShowRing");
ring._visible = shown;
GameCode("PalantirReady", 1);
stop();
`;

const build = (script = ROOT_SCRIPT) => {
  const image = new AptImage(new Uint8Array(64));
  const block = compileScript(parseScript(script), image, []);
  // Each faction clip stops on its first frame
  const stop = compileScript(parseScript('stop();'), image, []);
  const faction = (): FrameItem[][] => [
    [label('good'), { offset: 0, type: 'action', block: 999 } as FrameItem],
    [label('evil')],
  ];

  return {
    name: 'Palantir',
    record: { screenWidth: 100, screenHeight: 100 },
    characters: [
      { id: 0, offset: 0, type: 'movie' },
      { id: 1, offset: 0, type: 'sprite' },
      { id: 2, offset: 0, type: 'sprite' },
    ],
    imports: [],
    exports: [],
    frames: [
      {
        items: [
          place(1, 1, 'ring'),
          place(2, 2, 'banner'),
          { offset: 0, type: 'action', block },
        ],
      },
      { items: [] },
    ],
    spriteFrames: {
      1: faction().map((items) => ({ items })),
      2: faction().map((items) => ({ items })),
    },
    shapes: {},
    imageTextures: {},
    behaviours: {},
    code: {
      [block]: decodeBlock(image.bytes, block),
      999: decodeBlock(image.bytes, stop),
    },
    consts: [],
  } as unknown as PageMovie;
};

const run = (overrides: Record<string, string> = {}, script = ROOT_SCRIPT) => {
  const movie = build(script);
  const lines: string[] = [];
  const engine = new Engine(
    () => {},
    (line) => lines.push(line),
  );

  engine.load({ overrides, returns: {} });
  engine.reset(movie);

  const player = new Player(movie, 0, {
    resolve: (from, id) =>
      from.characters[id] && {
        movie: from,
        id,
        character: from.characters[id],
      },
    scripts: true,
    rootScripts: true,
    engine,
  });

  return { player, engine, lines };
};

/** What the movie passed to `trace`, which the engine hears as a call */
const traced = (lines: string[]) =>
  lines.flatMap((line) => {
    const match = /^engine: trace\("(.*)"\)$/.exec(line);

    return match ? [match[1]] : [];
  });

suite('APT ActionScript machine', () => {
  test('what the movie asks of the engine is found while it runs', () => {
    const { player, engine, lines } = run();

    assert.deepStrictEqual(
      [...engine.functions.values()].map((each) => [
        each.path,
        each.params,
        each.engineOnly,
      ]),
      [['_level0.SetPlayerFaction', ['faction'], true]],
    );
    assert.deepStrictEqual(
      [...engine.reads.values()]
        .filter((each) => !each.found)
        .map((each) => each.name),
      ['side'],
      'side is read but nothing sets it',
    );
    assert.deepStrictEqual(
      [...engine.externs.values()].map((each) => each.name),
      ['Game::ShowRing'],
    );
    assert.deepStrictEqual(
      [...engine.calls.values()].map((each) => [each.name, each.last]),
      [['GameCode', ['PalantirReady', '1']]],
    );
    assert.ok(lines.includes('engine: GameCode("PalantirReady", "1")'));
    // The extern answered nothing, so the ring is hidden; stop() held the root
    assert.strictEqual(player.find('/1')!.visible, false);
    player.tick();
    assert.strictEqual(player.root.frame, 0);
  });

  test("overrides win over the movie's values, and calling in moves the clips", () => {
    // `shown` is set by the movie from an extern that answers nothing
    const { player, engine } = run({ side: '"evil"', shown: 'true' });
    const ring = player.find('/1')!;

    assert.strictEqual(
      player.find('/2')!.frame,
      1,
      'side == "evil" sent the banner to its label',
    );
    assert.strictEqual(ring.visible, true);

    const entry = [...engine.functions.values()][0];

    engine.invoke(entry, ['evil']);
    assert.strictEqual(ring.frame, 1);
    assert.strictEqual(ring.playing, false);
    engine.invoke(entry, ['good']);
    assert.strictEqual(ring.frame, 0);
  });

  test("a movie's extern write is its own, never a user override", () => {
    const { engine, lines } = run(
      {},
      `extern.Flag = 7; flag = "mine"; trace(flag); trace(GetExtern("Flag")); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['mine', '7']);
    assert.strictEqual(engine.overrides.size, 0);
    assert.strictEqual(engine.externOverrides.size, 0);
    assert.deepStrictEqual(
      [...engine.externWrites.values()],
      [{ name: 'Flag', value: '7' }],
    );
  });

  test('a user value for an extern wins over what the movie wrote', () => {
    const { lines } = run(
      { 'extern.Flag': '9' },
      `extern.Flag = 7; trace(GetExtern("Flag")); trace(extern.Flag); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['9', '9']);
  });

  test('ToggleExtern flips every time', () => {
    const { lines } = run(
      {},
      `ToggleExtern("A"); trace(GetExtern("A")); ToggleExtern("A"); trace(GetExtern("A")); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['true', 'false']);
  });

  test('an override leaves a parameter of the same name alone', () => {
    const { lines } = run(
      { side: '"engine"' },
      `function Pick(side) { trace(side); } Pick("arg"); trace(side); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['arg', 'engine']);
  });

  test('an override matches the whole path, not the last name', () => {
    const { lines } = run(
      { side: '"engine"' },
      `ring.side = "own"; trace(ring.side); trace(_root.ring.side); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['own', 'own']);
  });

  test('member reads of an overridden name see it after the movie writes it', () => {
    const { engine, lines } = run(
      { side: '"engine"' },
      `function Read() { trace(_root.side); trace(this.side); } side = "movie"; stop();`,
    );

    engine.invoke([...engine.functions.values()][0], []);
    assert.deepStrictEqual(traced(lines), ['engine', 'engine']);
  });

  test('only the engine calls what the movie defines but never names', () => {
    const { engine } = run(
      {},
      `function Init() {} Init(); function Entry() {} stop();`,
    );

    assert.deepStrictEqual(
      [...engine.functions.values()]
        .filter((each) => each.engineOnly)
        .map((each) => each.name),
      ['Entry'],
    );
  });

  test('typed text reads hex, exponents, NaN and infinities as numbers', () => {
    assert.strictEqual(parseTyped('0x74808E'), 7635086);
    assert.strictEqual(parseTyped('1e3'), 1000);
    assert.strictEqual(parseTyped('-Infinity'), -Infinity);
    assert.ok(Number.isNaN(parseTyped('NaN') as number));
    assert.strictEqual(parseTyped('abc'), 'abc');
  });

  test('clearing overrides keeps what calls return', () => {
    const { engine } = run({ side: '1' });

    engine.returns.set('gamecode', '5');
    engine.clear();
    assert.strictEqual(engine.overrides.size, 0);
    assert.strictEqual(engine.returns.get('gamecode'), '5');
  });

  test('script depths sit above the timeline and swap', () => {
    const { player, lines } = run(
      {},
      `a = _root.createEmptyMovieClip("a", 5);
       b = _root.createEmptyMovieClip("b", 9);
       trace(a.getDepth()); trace(_root.getNextHighestDepth());
       a.swapDepths(b); trace(a.getDepth()); trace(b.getDepth());
       a.swapDepths(20); trace(a.getDepth()); trace(_root.getNextHighestDepth());
       trace(_root.getInstanceAtDepth(20) == a);
       stop();`,
    );

    assert.deepStrictEqual(traced(lines), [
      '5',
      '10',
      '9',
      '5',
      '20',
      '21',
      'true',
    ]);
    assert.strictEqual(
      [...player.root.children.values()].find((c) => c.name === 'a')!.path,
      `${player.root.path}/${20 + 16384}`,
    );
  });

  test('only a script-owned clip is removed by removeMovieClip', () => {
    const { player } = run(
      {},
      `ring.removeMovieClip(); c = _root.createEmptyMovieClip("c", 1); c.removeMovieClip(); stop();`,
    );

    assert.ok(player.find('/1'), 'the timeline-placed ring stays');
    assert.ok(![...player.root.children.values()].some((c) => c.name === 'c'));
  });

  test('attachMovie and duplicateMovieClip copy the initial object', () => {
    const { lines } = run(
      {},
      `i = new Object(); i.n = 4; d = ring.duplicateMovieClip("d", 3, i); trace(d.n); trace(d.getDepth()); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['4', '3']);
  });

  test('localToGlobal and globalToLocal go through the clip chain and back', () => {
    const { lines } = run(
      {},
      `ring._x = 10; ring._y = 20;
       p = new Object(); p.x = 1; p.y = 2; ring.localToGlobal(p); trace(p.x); trace(p.y);
       ring.globalToLocal(p); trace(p.x); trace(p.y); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['11', '22', '1', '2']);
  });

  test('Color sets and reads a clip tint through the colour transform', () => {
    const { player, lines } = run(
      {},
      `c = new Color(ring); c.setRGB(0xFF8000); trace(c.getRGB());
       o = new Object(); o.ra = 50; o.bb = 51; c.setTransform(o); t = c.getTransform();
       trace(t.ra); trace(t.bb); stop();`,
    );

    assert.deepStrictEqual(traced(lines), ['16744448', '50', '51']);
    assert.deepStrictEqual(player.find('/1')!.tint!.mult.slice(0, 1), [0.5]);
  });
});
