import * as assert from 'assert';
import type { Frame, FrameItem } from '../../formats/apt/aptMovie';
import { timelineAt } from '../../webview/apt/timeline';

const place = (depth: number, character: number, move = false): FrameItem => ({
  offset: 0,
  type: 'placeObject',
  flags: move ? 1 : 0,
  depth,
  character,
});

/** Frame 0 places #1 at depth 1 for good, and #2 at depth 2; frame 2 replaces #2 with #3 */
const frames: Frame[] = [
  { items: [place(1, 1), place(2, 2)] },
  { items: [] },
  { items: [place(2, 3, true)] },
];

const childTicks = (tick: number, stops: number[] = [], honour = true) =>
  Object.fromEntries(
    timelineAt(frames, stops, tick, honour).placements.map((each) => [
      each.character,
      each.tick,
    ]),
  );

suite('APT playback', () => {
  test('a timeline plays, then loops; a child plays from when it was placed', () => {
    assert.strictEqual(timelineAt(frames, [], 2, true).frame, 2);
    assert.deepStrictEqual(childTicks(2), { 1: 2, 3: 0 });
    assert.strictEqual(timelineAt(frames, [], 4, true).frame, 1);
  });

  test('across a loop, a child kept from frame 0 keeps its clock; a replaced one starts over', () => {
    // Tick 4 is frame 1 of the second pass: #1 lasted, #2 is placed again
    assert.deepStrictEqual(childTicks(4), { 1: 4, 2: 1 });
  });

  test('a stop holds the timeline while its children keep playing', () => {
    const held = timelineAt(frames, [1], 10, true);

    assert.strictEqual(held.frame, 1);
    assert.deepStrictEqual(childTicks(10, [1]), { 1: 10, 2: 10 });
    assert.strictEqual(timelineAt(frames, [1], 10, false).frame, 1);
    assert.strictEqual(timelineAt(frames, [1], 11, false).frame, 2);
  });
});
