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
  const known: Record<string, unknown> = {
    getExtension: () => (wideIndices ? {} : null),
    getShaderParameter: () => true,
    getAttribLocation: () => 0,
    createBuffer: () => ({}),
    createTexture: () => ({}),
    bufferSubData: (_target: number, _at: number, data: Float32Array) =>
      updates.push(data.length),
    drawElements: (_mode: number, count: number) => draws.push(count),
  };
  const gl = new Proxy(known, {
    get: (target, name: string) => target[name] ?? (() => undefined),
  });

  return { gl, updates, draws };
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
    bones: new Uint16Array(vertices),
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
};

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
});
