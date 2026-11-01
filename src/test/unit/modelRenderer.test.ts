import * as assert from 'assert';
import * as path from 'path';
import * as vm from 'vm';
import { buildSync } from 'esbuild';
import type { ModelScene, SceneMesh } from '../../formats/w3d/w3dScene';
import type { Pose } from '../../formats/w3d/w3dPose';
import { DEFAULT_SURFACE } from '../../formats/w3d/w3dMaterialTypes';

/** The surface of `modelRenderer.ts` these tests drive */
interface RendererModule {
  createModelRenderer(gl: unknown): {
    setModel(scene: ModelScene | undefined): void;
    setPose(pose: Pose | undefined): void;
    draw(viewProjection: number[], options: unknown): void;
  };
}

/**
 * Loads the renderer from source: it is page code, typed against the DOM, which
 * the extension's own compile leaves out, so the tests bundle it themselves.
 */
const loadRenderer = (): RendererModule => {
  const [bundle] = buildSync({
    entryPoints: [
      path.join(__dirname, '../../../src/webview/shared/modelRenderer.ts'),
    ],
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    write: false,
  }).outputFiles;
  const module = { exports: {} };

  vm.runInNewContext(bundle.text, {
    module,
    exports: module.exports,
    Float32Array,
    Uint16Array,
    Uint8Array,
    WeakMap,
  });
  return module.exports as RendererModule;
};

/** A WebGL context that does nothing but record what is uploaded and drawn */
const createRecordingContext = (wideIndices: boolean) => {
  const updates: number[] = [];
  const draws: number[] = [];
  const opacities: number[] = [];
  const known: Record<string, unknown> = {
    getExtension: () => (wideIndices ? {} : null),
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: (_program: unknown, name: string) => name,
    uniform1f: (name: string, value: number) =>
      name === 'opacity' && opacities.push(value),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    bufferSubData: (_target: number, _at: number, data: Float32Array) =>
      updates.push(data.length),
    drawElements: (_mode: number, count: number) => draws.push(count),
  };
  const gl = new Proxy(known, {
    get: (target, name: string) => target[name] ?? (() => undefined),
  });

  return { gl, updates, draws, opacities };
};

/** The values WebGL gives the constants the state tests read */
const GL_CONSTANTS: Record<string, number> = {
  ZERO: 0,
  ONE: 1,
  NEVER: 512,
  LESS: 513,
  SRC_COLOR: 768,
  SRC_ALPHA: 770,
  ONE_MINUS_SRC_ALPHA: 771,
  BACK: 1029,
  CCW: 2305,
  CULL_FACE: 2884,
  BLEND: 3042,
  TEXTURE0: 33984,
};

/** A WebGL context that logs every call, and answers the constants the renderer reads */
const createLoggingContext = () => {
  const calls: [name: string, ...args: unknown[]][] = [];
  const known: Record<string, unknown> = {
    getExtension: () => ({}),
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: (_program: unknown, name: string) => name,
    createBuffer: () => ({}),
    createTexture: () => ({}),
  };
  const gl = new Proxy(known, {
    get: (target, name: string) =>
      target[name] ??
      GL_CONSTANTS[name] ??
      ((...args: unknown[]) => {
        calls.push([name, ...args]);
      }),
  });

  return { gl, calls };
};

const callsTo = (calls: [string, ...unknown[]][], name: string) =>
  calls.filter(([called]) => called === name).map(([, ...args]) => args);

const bound = (vertices: number): SceneMesh => ({
  name: `M${vertices}`,
  container: 'UNIT',
  positions: new Float32Array(vertices * 3),
  indices: new Uint32Array(3),
  alphaTest: false,
  blend: 'opaque',
  hidden: false,
  local: {
    positions: new Float32Array(vertices * 3),
    bones: new Uint16Array(vertices * 2),
    weights: new Float32Array(vertices * 2),
  },
});

const unbound = (vertices: number): SceneMesh => ({
  ...bound(vertices),
  local: undefined,
});

const buildScene = (meshes: SceneMesh[]): ModelScene => ({
  meshes,
  boxes: [],
  textures: [],
  missing: [],
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
});

const pose: Pose = {
  world: [{ t: [0, 0, 0], q: [0, 0, 0, 1] }],
  visible: [true],
  opacity: [1],
};

const DRAW_OPTIONS = { light: [0, 0, 1], showBones: false };

suite('Model renderer', () => {
  const { createModelRenderer } = loadRenderer();

  test('a mesh too large to draw does not shift the pose onto its neighbours', () => {
    const { gl, updates } = createRecordingContext(false);
    const renderer = createModelRenderer(gl);

    // Only 32 bit indices draw the first; without them it is skipped
    renderer.setModel(
      buildScene([unbound(0x10001), bound(4), unbound(5), bound(6)]),
    );
    renderer.setPose(pose);

    assert.deepStrictEqual(updates, [4 * 3, 6 * 3]);
  });

  test('a pose hides a rigid mesh on a hidden bone, and leaves a skin drawn', () => {
    const { gl, draws } = createRecordingContext(true);
    const renderer = createModelRenderer(gl);
    const rigid = { ...bound(1), bone: 1, indices: new Uint32Array(6) };
    const skinned = bound(2);

    renderer.setModel(buildScene([rigid, skinned]));
    renderer.setPose({
      world: [pose.world[0], pose.world[0]],
      visible: [true, false],
      opacity: [1, 1],
    });
    renderer.draw([], DRAW_OPTIONS);

    assert.deepStrictEqual(draws, [skinned.indices.length]);
  });

  test('each draw of a mesh draws once, blended ones last and by sort level', () => {
    const { gl, draws } = createRecordingContext(true);
    const renderer = createModelRenderer(gl);
    const drawOf = (count: number, surface: Partial<typeof DEFAULT_SURFACE>) => ({
      pass: 0,
      indices: new Uint32Array(count),
      surface: { ...DEFAULT_SURFACE, ...surface },
      textured: false,
    });

    renderer.setModel(
      buildScene([
        {
          ...unbound(3),
          draws: [
            drawOf(3, { blend: 'additive', sortLevel: 2 }),
            drawOf(6, { blend: 'alpha', sortLevel: 1 }),
            drawOf(9, {}),
          ],
        },
      ]),
    );
    renderer.draw([], DRAW_OPTIONS);

    assert.deepStrictEqual(draws, [9, 6, 3]);
  });

  test('a faded rigid mesh draws at its opacity after the opaque ones', () => {
    const { gl, draws, opacities } = createRecordingContext(true);
    const renderer = createModelRenderer(gl);
    const rigid = { ...bound(1), bone: 1, indices: new Uint32Array(6) };

    renderer.setModel(buildScene([rigid, bound(2)]));
    renderer.setPose({
      world: [pose.world[0], pose.world[0]],
      visible: [true, true],
      opacity: [0.25, 0.5],
    });
    renderer.draw([], DRAW_OPTIONS);

    // The skin answers to no bone, so it stays whole and draws first
    assert.deepStrictEqual(draws, [3, 6]);
    assert.deepStrictEqual(opacities.slice(-2), [1, 0.5]);
  });

  const stateScene = (surface: Partial<typeof DEFAULT_SURFACE>) =>
    buildScene([
      {
        ...unbound(3),
        draws: [
          {
            pass: 0,
            surface: { ...DEFAULT_SURFACE, ...surface },
            textured: false,
          },
        ],
      },
    ]);

  const drawLogged = (surface: Partial<typeof DEFAULT_SURFACE>) => {
    const { gl, calls } = createLoggingContext();
    const renderer = createModelRenderer(gl);

    renderer.setModel(stateScene(surface));
    renderer.draw([], DRAW_OPTIONS);
    return calls;
  };

  test('a one-sided draw culls back faces of counter-clockwise triangles, with its depth function and blend', () => {
    const calls = drawLogged({ blend: 'alpha', depthCompare: 7, twoSided: false });

    assert.ok(callsTo(calls, 'enable').some(([cap]) => cap === GL_CONSTANTS.CULL_FACE));
    assert.deepStrictEqual(callsTo(calls, 'frontFace'), [[GL_CONSTANTS.CCW]]);
    assert.deepStrictEqual(callsTo(calls, 'cullFace'), [[GL_CONSTANTS.BACK]]);
    assert.deepStrictEqual(callsTo(calls, 'depthFunc')[0], [GL_CONSTANTS.NEVER + 7]);
    assert.deepStrictEqual(callsTo(calls, 'blendFuncSeparate'), [
      [
        GL_CONSTANTS.SRC_ALPHA,
        GL_CONSTANTS.ONE_MINUS_SRC_ALPHA,
        GL_CONSTANTS.ONE,
        GL_CONSTANTS.ONE_MINUS_SRC_ALPHA,
      ],
    ]);
  });

  test('a two-sided draw sets no culling', () => {
    const calls = drawLogged({ twoSided: true });

    assert.deepStrictEqual(callsTo(calls, 'frontFace'), []);
    assert.ok(!callsTo(calls, 'enable').some(([cap]) => cap === GL_CONSTANTS.CULL_FACE));
  });

  test('a blended draw writes depth only when its shader says so; an opaque one always does', () => {
    const depthMasks = (surface: Partial<typeof DEFAULT_SURFACE>) =>
      callsTo(drawLogged(surface), 'depthMask').map(([on]) => on);

    // The first call is the frame's own, the last the restore
    assert.deepStrictEqual(depthMasks({ blend: 'alpha', depthWrite: true }), [true, true, true]);
    assert.deepStrictEqual(depthMasks({ blend: 'alpha', depthWrite: false }), [true, false, true]);
    assert.deepStrictEqual(depthMasks({ blend: 'opaque', depthWrite: false }), [true, true, true]);
  });

  test('a draw leaves the context as it found it', () => {
    const calls = drawLogged({ blend: 'additive', depthCompare: 7 });
    const lastToggle = (capability: number) =>
      calls
        .filter(([name, argument]) => (name === 'enable' || name === 'disable') && argument === capability)
        .pop()?.[0];

    assert.deepStrictEqual(callsTo(calls, 'activeTexture').pop(), [GL_CONSTANTS.TEXTURE0]);
    assert.deepStrictEqual(callsTo(calls, 'depthFunc').pop(), [GL_CONSTANTS.LESS]);
    assert.deepStrictEqual(callsTo(calls, 'depthMask').pop(), [true]);
    assert.strictEqual(lastToggle(GL_CONSTANTS.CULL_FACE), 'disable');
    assert.strictEqual(lastToggle(GL_CONSTANTS.BLEND), 'disable');
  });

  test('an alpha-tested draw cuts texels below 96 of 255, and others none', () => {
    const cutoffs = (alphaTest: boolean) =>
      callsTo(drawLogged({ alphaTest }), 'uniform1f')
        .filter(([name]) => name === 'alphaCutoff')
        .map(([, value]) => value);

    assert.deepStrictEqual(cutoffs(true), [96 / 255]);
    assert.deepStrictEqual(cutoffs(false), [-1]);
  });

  test('draws that hold views of the same bytes upload them once', () => {
    const { gl, calls } = createLoggingContext();
    const renderer = createModelRenderer(gl);
    const shared = new Float32Array(6).buffer;
    const drawOf = () => ({
      pass: 0,
      surface: DEFAULT_SURFACE,
      textured: false,
      // A message hands each reference over as a view of its own
      uvs: new Float32Array(shared),
    });

    renderer.setModel(buildScene([{ ...unbound(3), draws: [drawOf(), drawOf()] }]));

    const uploadsOfUvs = callsTo(calls, 'bufferData').filter(
      ([, data]) => data instanceof Float32Array && data.length === 6,
    );

    assert.strictEqual(uploadsOfUvs.length, 1);
  });
});
