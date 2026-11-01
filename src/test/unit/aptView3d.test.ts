/// <reference lib="dom" />
// The camera module is webview code and name DOM types; the test only runs their pure parts.
import * as assert from 'assert';
import { createToolRegistry } from '../../core/toolRegistry';
import { BINDINGS, classifySurface } from '../../formats/apt/aptGadgets';
import {
  advancePlayback,
  getRestingFrame,
  parsePlayback,
  toRenderObjectFile,
} from '../../formats/apt/aptView3d';
import type { Vec3 } from '../../formats/w3d/w3dPose';
import type { ModelScene } from '../../formats/w3d/w3dScene';
import { resolveRenderObject } from '../../features/apt/aptRenderObjects';
import {
  MAX_RENDER_OBJECTS,
  createRenderObjectCache,
} from '../../webview/apt/renderObjectCache';
import { frameModel, lookThroughBone } from '../../webview/apt/view3dCamera';

const project = (matrix: Float32Array, [x, y, z]: Vec3): Vec3 => {
  const at = (row: number) =>
    matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row];
  const w = at(3);

  return [at(0) / w, at(1) / w, at(2) / w];
};

const SCENE = {
  meshes: [],
  boxes: [],
  textures: [],
  missing: [],
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
} as unknown as ModelScene;

suite('APT View3D', () => {
  test('a surface plays its animation as its mode says', () => {
    const hold = parsePlayback('MANUAL', 1);

    assert.strictEqual(advancePlayback(hold, 30, 0.5, 30, 51), 1);

    const show = parsePlayback('PLAY_TO_FRAME', 50);

    assert.strictEqual(advancePlayback(show, 0, 1, 30, 51), 30);
    assert.strictEqual(advancePlayback(show, 30, 1, 30, 51), 50);
    assert.strictEqual(
      advancePlayback(parsePlayback('play_to_frame', 1), 50, 1, 30, 51),
      20,
    );
    assert.strictEqual(
      advancePlayback(parsePlayback('LOOP', 0), 50, 1 / 30, 30, 51),
      0,
    );
    assert.strictEqual(advancePlayback(parsePlayback('?', 99), 0, 1, 30, 51), 50);
  });

  test('a still stage shows a surface where it comes to rest, not at frame 0', () => {
    assert.strictEqual(getRestingFrame(parsePlayback('PLAY_TO_FRAME', 50), 0, 51), 50);
    assert.strictEqual(getRestingFrame(parsePlayback('PLAY_TO_FRAME', 1), 40, 51), 1);
    assert.strictEqual(getRestingFrame(parsePlayback('LOOP', 0), 7, 51), 7);
  });

  test('a surface is told apart by its _type, and its model and mode can be overridden', () => {
    assert.strictEqual(classifySurface({ type: 'View3D' })?.kind, 'view3d');
    assert.deepStrictEqual(
      BINDINGS.view3d.map((binding) => binding.name),
      ['_RenderObj', '_AnimMode', '_Frame'],
    );
  });

  test('a movie names a model, never a place on disk', () => {
    assert.strictEqual(toRenderObjectFile(' SFE_Frame '), 'SFE_Frame.w3d');
    assert.strictEqual(toRenderObjectFile('SFE_Frame.W3D'), 'SFE_Frame.w3d');
    for (const name of ['', '../x', 'a/b', 'a\\b', 'c:x']) {
      assert.strictEqual(toRenderObjectFile(name), undefined, name);
    }
  });

  test('a camera pivot looks down its -Z with a fifty degree width at any aspect', () => {
    // A quarter turn about X, so local -Z is world +Y, and moved
    const half = Math.SQRT1_2;
    const bone = { t: [5, -100, 2] as Vec3, q: [half, 0, 0, half] as [number, number, number, number] };

    for (const aspect of [4 / 3, 16 / 9]) {
      const view = lookThroughBone(bone, aspect);
      const ahead = project(view, [5, 400, 2]);

      assert.ok(Math.abs(ahead[0]) < 1e-3 && Math.abs(ahead[1]) < 1e-3);

      const edge = project(view, [5 + 0.46630766 * 500, 400, 2]);

      assert.ok(Math.abs(edge[0] - 1) < 1e-3, `right edge at ${aspect}`);
      assert.ok(project(view, [5, 400, 102])[1] > 0, 'local +Y is up');
    }
  });

  test('a model with no camera is framed whole, down its flattest axis', () => {
    const bounds: ModelScene['bounds'] = { min: [-50, -2, -30], max: [50, 2, 30] };
    const view = frameModel(bounds, 1);

    for (const corner of [[-50, 0, -30], [50, 0, 30]] as Vec3[]) {
      const [x, y] = project(view, corner);

      assert.ok(Math.abs(x) <= 1.01 && Math.abs(y) <= 1.01, `${x} ${y}`);
    }
    assert.ok(Math.abs(project(view, [50, 0, 0])[0]) > 0.9);
  });

  test('models are asked for lazily, one at a time, and only what is shown', () => {
    const asked: string[] = [];
    const cache = createRenderObjectCache({
      ask: (name) => asked.push(name),
      release: () => {},
    });

    assert.deepStrictEqual(cache.get('One', 1), { pending: true });
    assert.deepStrictEqual(cache.get('ONE', 1), { pending: true });
    assert.deepStrictEqual(cache.get('Two', 1), { pending: true });
    assert.deepStrictEqual(asked, ['one']);
    cache.arrive('one', SCENE);
    assert.deepStrictEqual(asked, ['one', 'two']);
    assert.ok('object' in cache.get('One', 2));
    cache.fail('two', 'gone');
    assert.deepStrictEqual(cache.get('Two', 2), { unavailable: 'gone' });
    assert.strictEqual(asked.length, 2);
  });

  test('a movie naming thousands of models holds a bounded few', () => {
    const released: string[] = [];
    const asked: string[] = [];
    const cache = createRenderObjectCache({
      ask: (name) => asked.push(name),
      release: (object) => released.push(object.name),
    });

    for (let at = 0; at < 2000; at++) {
      const name = `m${at}`;

      if ('pending' in cache.get(name, 1)) {
        cache.arrive(name, SCENE);
        const state = cache.get(name, 1);

        if ('object' in state) {
          state.object.pass = 1;
        }
      }
    }
    assert.strictEqual(asked.length, MAX_RENDER_OBJECTS);
    assert.deepStrictEqual(cache.get('late', 1), {
      unavailable: `${MAX_RENDER_OBJECTS} models are already shown`,
    });
    assert.deepStrictEqual(cache.get('late', 5), { pending: true });
    assert.strictEqual(released.length, 1);
  });

  test('a model that is not there or does not parse answers with why', async () => {
    const tools = createToolRegistry();

    assert.ok(
      (await resolveRenderObject('Gone', async () => undefined, tools)).error,
    );
    assert.ok(
      (
        await resolveRenderObject(
          'Junk',
          async () => new Uint8Array([1, 2, 3]),
          tools,
        )
      ).error,
    );

    const reads: string[] = [];

    await resolveRenderObject(
      '../secret',
      async (file) => {
        reads.push(file);
        return undefined;
      },
      tools,
    );
    assert.deepStrictEqual(reads, []);
  });
});
