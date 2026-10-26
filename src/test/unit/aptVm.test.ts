import * as assert from 'assert';
import { decodeBlock } from '../../formats/apt/aptBytecode';
import { compileScript } from '../../formats/apt/aptCompiler';
import type { FrameItem } from '../../formats/apt/aptMovie';
import { parseScript } from '../../formats/apt/aptScriptParser';
import { AptImage } from '../../formats/apt/aptWriter';
import { Engine } from '../../webview/apt/avm/engine';
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

const build = () => {
  const image = new AptImage(new Uint8Array(64));
  const block = compileScript(parseScript(ROOT_SCRIPT), image, []);
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

const run = (overrides: Record<string, string> = {}) => {
  const movie = build();
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
});
