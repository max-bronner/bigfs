import * as assert from 'assert';
import { advancePlayhead } from '../../webview/shared/viewer/advancePlayhead';
import { getClipFrame, getClipSeconds } from '../../webview/shared/viewer/clipTiming';
import { buildGridLines } from '../../webview/shared/viewer/buildGridLines';
import { computeOrbitBasis } from '../../webview/shared/orbitBasis';
import { describeDetailLevels, describeModel } from '../../webview/shared/viewer/describeModel';
import type { ViewerModel } from '../../webview/shared/viewer/describeModel';
import { listFileClips } from '../../webview/preview/listFileClips';

const CLIP = { frameCount: 31, frameRate: 30 };

/** Floats per line vertex in the grid's buffer */
const VERTEX_FLOATS = 7;

const model = (fields: Partial<ViewerModel>): ViewerModel => ({
  meshes: [],
  boxes: [],
  textures: [],
  missing: [],
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  ...fields,
});

suite('Viewer playback', () => {
  test('the playhead runs on before the end', () => {
    assert.deepStrictEqual(advancePlayhead(1, 0.5, 2, false, true), {
      time: 1.5,
      hasWrapped: false,
      hasEnded: false,
    });
  });

  test('a loop goes back to the start at the end', () => {
    assert.deepStrictEqual(advancePlayhead(1.9, 0.5, 2, false, true), {
      time: 0,
      hasWrapped: true,
      hasEnded: false,
    });
  });

  test('without a loop it stops on the end', () => {
    assert.deepStrictEqual(advancePlayhead(1.9, 0.5, 2, false, false), {
      time: 2,
      hasWrapped: false,
      hasEnded: true,
    });
  });

  test('an effect still running holds the end back', () => {
    const move = advancePlayhead(1.9, 0.5, 2, true, true);

    assert.strictEqual(move.time, 2.4);
    assert.strictEqual(move.hasWrapped, false);
  });

  test('with no length, as for materials alone, it never ends', () => {
    const move = advancePlayhead(100, 1, 0, false, false);

    assert.strictEqual(move.time, 101);
    assert.strictEqual(move.hasEnded, false);
  });

  test('a clip takes its frame span, not its frame count', () => {
    assert.strictEqual(getClipSeconds(CLIP), 1);
  });

  test('a clip has a length even when its frame rate is zero', () => {
    assert.strictEqual(getClipSeconds({ frameCount: 11, frameRate: 0 }), 10);
  });

  test('a clip stands at seconds times its rate', () => {
    assert.strictEqual(getClipFrame(CLIP, 0.5), 15);
  });

  test('a clip loops inside a longer timeline', () => {
    assert.strictEqual(getClipFrame(CLIP, 1.5), 15);
  });

  test('a clip starts on its first frame and ends on its last', () => {
    assert.strictEqual(getClipFrame(CLIP, 0), 0);
    assert.strictEqual(getClipFrame(CLIP, 1), 30);
  });
});

suite('Viewer animation list', () => {
  const thisFile = [{ id: '#own', label: 'CLIP (this file)' }];

  test('what the file holds comes first, then its skeleton\'s files', () => {
    assert.deepStrictEqual(listFileClips(thisFile, ['a_run.W3D'], []).own, [
      thisFile[0],
      { id: 'a_run.W3D', label: 'a_run' },
    ]);
  });

  test('another skeleton\'s clip is labelled with the skeleton', () => {
    assert.deepStrictEqual(
      listFileClips([], [], [{ file: 'b_run.w3d', hierarchyName: 'B_SKL' }]).foreign,
      [{ id: 'b_run.w3d', label: 'b_run (B_SKL)' }],
    );
  });
});

suite('Viewer grid', () => {
  const reach = (lines: number[]) =>
    Math.max(...lines.filter((_, at) => at % VERTEX_FLOATS === 0));

  test('a small scene gets the 200 unit grid', () => {
    assert.strictEqual(reach(buildGridLines(10)), 200);
  });

  test('the grid grows past a large model with no more lines', () => {
    const small = buildGridLines(10);
    const large = buildGridLines(1000);

    assert.ok(reach(large) >= 1500);
    assert.strictEqual(large.length, small.length);
  });

  test('a radius from a broken file cannot hang it', () => {
    assert.ok(buildGridLines(Number.POSITIVE_INFINITY).length > 0);
  });
});

suite('Viewer camera', () => {
  const place = { yaw: 0.3, pitch: 0.4, distance: 10, target: [1, 2, 3] as [number, number, number] };

  test('the eye stands at its distance from the target', () => {
    const { eye } = computeOrbitBasis(place);

    assert.ok(
      Math.abs(Math.hypot(eye[0] - 1, eye[1] - 2, eye[2] - 3) - 10) < 1e-9,
    );
  });

  test('forward looks from the eye to the target', () => {
    const { eye, forward } = computeOrbitBasis(place);

    place.target.forEach((axis, at) =>
      assert.ok(Math.abs(eye[at] + forward[at] * 10 - axis) < 1e-9),
    );
  });

  test('up leans to Z, right stays level', () => {
    const { up, right } = computeOrbitBasis(place);

    assert.ok(up[2] > 0);
    assert.ok(Math.abs(right[2]) < 1e-9);
  });
});

suite('Viewer model facts', () => {
  test('says what could not be found and what it is shown on', () => {
    const text = describeModel(
      model({ missing: ['a.tga'], shownOn: 'carrier.w3d' }),
    );

    assert.ok(text.includes('textures not found: a.tga'));
    assert.ok(text.startsWith('shown on carrier.w3d'));
  });

  test('has no line about detail levels without an HLOD', () => {
    assert.strictEqual(describeDetailLevels(model({})), '');
  });
});
