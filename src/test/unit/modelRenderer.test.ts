import * as assert from 'assert';
import * as path from 'path';
import * as vm from 'vm';
import { buildSync } from 'esbuild';
import type { ModelScene, SceneMesh } from '../../formats/w3d/w3dScene';
import type { Pose } from '../../formats/w3d/w3dPose';

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

const bound = (vertices: number): SceneMesh => ({
  name: `M${vertices}`,
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
});
