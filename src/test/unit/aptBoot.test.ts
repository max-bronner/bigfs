import * as assert from "assert";
import { decodeBlock } from "../../formats/apt/aptBytecode";
import { compileScript } from "../../formats/apt/aptCompiler";
import type { FrameItem } from "../../formats/apt/aptMovie";
import { parseScript } from "../../formats/apt/aptScriptParser";
import { AptImage } from "../../formats/apt/aptWriter";
import { Engine } from "../../webview/apt/avm/engine";
import { Player } from "../../webview/apt/player";
import type { PageMovie } from "../../webview/apt/protocol";

/**
 * A movie booting: the root's own scripts run once the root exists, a stop()
 * in its first frame survives, and init actions run before the first tick.
 */

interface Source {
  /** Root frame scripts, one per frame */
  frames: string[];
  /** Init action scripts, by the root frame holding them */
  init?: Record<number, string>;
}

const build = (source: Source) => {
  const image = new AptImage(new Uint8Array(64));
  const code: PageMovie["code"] = {};
  const compile = (text: string) => {
    const block = compileScript(parseScript(text), image, []);

    code[block] = decodeBlock(image.bytes, block);
    return block;
  };
  const frames = source.frames.map((text, index) => {
    const items: FrameItem[] = [
      { offset: 0, type: "action", block: compile(text) } as FrameItem,
    ];

    if (index === 0) {
      items.push({
        offset: 0,
        type: "placeObject",
        flags: 0,
        depth: 1,
        character: 1,
        name: "kid",
      } as FrameItem);
    }
    const init = source.init?.[index];

    if (init !== undefined) {
      items.push({
        offset: 0,
        type: "initAction",
        sprite: 1,
        block: compile(init),
      } as FrameItem);
    }
    return { items };
  });

  return {
    name: "Boot",
    record: { screenWidth: 100, screenHeight: 100 },
    characters: [
      { id: 0, offset: 0, type: "movie" },
      { id: 1, offset: 0, type: "sprite" },
    ],
    imports: [],
    exports: [],
    frames,
    spriteFrames: { 1: [{ items: [] }] },
    shapes: {},
    imageTextures: {},
    behaviours: {},
    code,
    consts: [],
  } as unknown as PageMovie;
};

const boot = (source: Source) => {
  const movie = build(source);
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  const engine = new Engine(() => {}, log);

  engine.load({ overrides: {}, returns: {} });
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
    log,
    engine,
  });
  const read = (name: string) => player.vm!.peekObject(player.root)?.get(name);

  return { player, lines, read };
};

suite("APT boot", () => {
  test("a root script that reads _root runs to its end, without a failure", () => {
    const { lines, read } = boot({ frames: ["a = _root._name; b = 1;"] });

    assert.strictEqual(read("b"), 1);
    assert.deepStrictEqual(
      lines.filter((line) => /fail|error|undefined/i.test(line)),
      [],
    );
  });

  test("_level0 resolves in the first frame too", () => {
    const { read } = boot({ frames: ["a = _level0._name; b = 2;"] });

    assert.strictEqual(read("b"), 2);
  });

  test("a stop() in the root's first frame holds, also after the same frame is asked for", () => {
    const { player } = boot({ frames: ["stop();", ""] });

    assert.strictEqual(player.root.playing, false);
    player.tick();
    assert.strictEqual(player.root.frame, 0);
  });

  test("an init action on a later frame runs before the first tick", () => {
    const { player, read } = boot({
      frames: ["", "", "", ""],
      init: { 3: "ready = 7;" },
    });

    assert.strictEqual(player.ticks, 0);
    assert.strictEqual(read("ready"), 7);
    assert.strictEqual(player.root.frame, 0);
  });
});
