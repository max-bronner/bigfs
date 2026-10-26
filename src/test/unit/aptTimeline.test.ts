import * as assert from 'assert';
import { compileExpression, ExpressionError } from '../../common/expression';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import {
  animate,
  applyOperation,
  decodeTimeline,
  deleteFrames,
  detectTweens,
  encodeTimeline,
  hide,
  retimeFrames,
  reverseFrames,
  tween,
} from '../../formats/apt/aptTimeline';
import type { FrameState } from '../../formats/apt/aptTimeline';
import { AptImage, applyAptEdit } from '../../formats/apt/aptWriter';
import {
  parseMotionScript,
  tweensAsScript,
} from '../../formats/apt/motionScript';
import { buildMovie } from './apt.test';

/** The synthetic movie with its root timeline stretched to five frames */
const fiveFrames = () => {
  const { apt, constFile } = buildMovie();
  const movieOffset = parseConst(constFile).movieOffset;
  const image = new AptImage(apt);

  for (let frame = 0; frame < 4; frame++) {
    applyAptEdit(image, movieOffset, { kind: 'addFrame', timeline: 0 });
  }

  const read = () => parseAptMovie(image.bytes, movieOffset);
  const states = () => decodeTimeline(image.bytes, read().frames);
  const write = (next: FrameState[]) => {
    applyAptEdit(image, movieOffset, {
      kind: 'setTimeline',
      timeline: 0,
      frames: encodeTimeline(states(), next),
    });
    return states();
  };

  return { image, read, states, write };
};

const xs = (states: FrameState[], depth: number) =>
  states.map((state) => state.display.get(depth)?.translate[0]);

suite('APT timeline editing', () => {
  test('an unchanged timeline is written back as its own frames', () => {
    const { read, states, write } = fiveFrames();
    const before = read().frames;

    write(states());
    assert.deepStrictEqual(read().frames, before);
  });

  test('a tween bakes one move per frame, read back as the eased values', () => {
    const { read, states, write } = fiveFrames();
    const after = write(tween(states(), 2, 0, 4, { x: 100 }));

    assert.deepStrictEqual(xs(after, 2), [0, 25, 50, 75, 100]);
    // Frame 0 places it anew; the rest only move it
    assert.deepStrictEqual(
      read().frames.map(
        (frame) =>
          frame.items.filter((item) => item.type === 'placeObject').length,
      ),
      [1, 1, 1, 1, 1],
    );
    assert.strictEqual(
      new Set(after.map((s) => s.display.get(2)?.token)).size,
      1,
    );
    // The label and the script stay where they were
    assert.deepStrictEqual(
      read()
        .frames[0].items.map((item) => item.type)
        .sort(),
      ['action', 'frameLabel', 'placeObject'],
    );
  });

  test('a formula drives a property by frame, with the start pose as variables', () => {
    const { states, write } = fiveFrames();
    const after = write(
      animate(states(), 2, 1, 3, { x: 'x0 + 10 * i', alpha: '1 - t' }),
    );

    assert.deepStrictEqual(xs(after, 2), [0, 0, 10, 20, 20]);
    assert.deepStrictEqual(
      after.map((state) => state.display.get(2)?.colorTransform),
      [undefined, undefined, 0x80ffffff, 0x00ffffff, 0x00ffffff],
    );
  });

  test('removing for a range places a new instance afterwards', () => {
    const { states, write } = fiveFrames();
    const after = write(hide(states(), 2, 1, 2, 'remove'));

    assert.deepStrictEqual(
      after.map((state) => state.display.has(2)),
      [true, false, false, true, true],
    );
    assert.notStrictEqual(
      after[0].display.get(2)!.token,
      after[3].display.get(2)!.token,
    );
  });

  test('deleting, reversing and retiming frames keep labels and motion', () => {
    const { states, write, read } = fiveFrames();

    write(tween(states(), 2, 0, 4, { x: 100 }));
    assert.deepStrictEqual(
      xs(write(reverseFrames(states(), 0, 4)), 2),
      [100, 75, 50, 25, 0],
    );
    assert.deepStrictEqual(
      xs(write(retimeFrames(states(), 0, 4, 3)), 2),
      [100, 50, 0],
    );

    const afterDelete = write(deleteFrames(states(), 0, 0));

    assert.deepStrictEqual(xs(afterDelete, 2), [50, 0]);
    // The label went with the deleted frame; nothing still names frame 0's
    assert.ok(
      read().frames.every((frame) =>
        frame.items.every((item) => item.type !== 'frameLabel'),
      ),
    );
  });
});

suite('APT expressions', () => {
  test('precedence, powers, functions and variables', () => {
    const run = (source: string, variables = {}) =>
      compileExpression(source)(variables);

    assert.strictEqual(run('1 + 2 * 3 ^ 2'), 19);
    assert.strictEqual(run('-2 ^ 2'), -4);
    assert.strictEqual(run('2 ^ 3 ^ 2'), 512);
    assert.strictEqual(run('max(1, x, 3) + clamp(t, 0, 1)', { x: 5, t: 2 }), 6);
    assert.strictEqual(run('round(sin(pi / 2) * 100)'), 100);
  });

  test('anything but arithmetic is refused', () => {
    for (const source of [
      '',
      'constructor',
      'alert(1)',
      'x.y',
      '1 +',
      '(1',
      '1 / 0',
    ]) {
      assert.throws(() => compileExpression(source)({ x: 1 }), ExpressionError);
    }
  });
});

suite('APT tween detection', () => {
  test('baked tweens are found with their easing, and still frames are not', () => {
    const { states, write } = fiveFrames();

    write(tween(states(), 2, 0, 2, { x: 100 }, 'linear'));

    const eased = write(tween(states(), 2, 2, 4, { alpha: 0 }, 'easeIn'));
    const found = detectTweens(eased).map(
      ({ depth, from, to, easing, changes }) => ({
        depth,
        from,
        to,
        easing,
        changes,
      }),
    );

    assert.deepStrictEqual(found, [
      { depth: 2, from: 0, to: 2, easing: 'linear', changes: ['x'] },
      { depth: 2, from: 2, to: 4, easing: 'easeIn', changes: ['alpha'] },
    ]);
  });
});

suite('APT motion scripts', () => {
  test('a script bakes its lines in order, each on the last', () => {
    const { states, write } = fiveFrames();
    const after = write(
      parseMotionScript(
        [
          '// a comment',
          'depth 2, frames 0-4: x 0 -> 100; alpha 1 -> 0 easeIn',
          'depth 2, frames 4: y = 7',
        ].join('\n'),
      ).reduce(applyOperation, states()),
    );

    assert.deepStrictEqual(xs(after, 2), [0, 25, 50, 75, 100]);
    assert.strictEqual(after[4].display.get(2)!.translate[1], 7);
    // Alpha eased in: still mostly opaque half way
    assert.strictEqual(after[2].display.get(2)!.colorTransform! >>> 24, 191);
  });

  test("a timeline's tweens read back as a script that remakes them", () => {
    const { states, write } = fiveFrames();
    const baked = write(tween(states(), 2, 0, 4, { x: 100 }, 'easeOut'));
    const script = tweensAsScript(detectTweens(baked));

    assert.strictEqual(script, 'depth 2, frames 0-4: x 0 -> 100 easeOut');

    const remade = write(
      parseMotionScript(script).reduce(applyOperation, states()),
    );

    assert.deepStrictEqual(xs(remade, 2), xs(baked, 2));
  });

  test('a wrong line is named', () => {
    assert.throws(
      () =>
        parseMotionScript('depth 2, frames 0-4: x 0 -> 1\nframes 2: wobble'),
      /Line 2: "wobble" is not something a script does/,
    );
    assert.throws(
      () => parseMotionScript('frames 0-4: x 0 -> 1'),
      /Line 1: a tween needs a depth/,
    );
  });
});
