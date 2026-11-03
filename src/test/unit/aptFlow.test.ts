import * as assert from 'assert';
import { readTimelineFlow } from '../../formats/apt/aptFlow';
import type { Behaviour } from '../../formats/apt/aptBehaviour';
import type { Character, Frame } from '../../formats/apt/aptMovie';

const label = (text: string) =>
  ({ type: 'frameLabel', label: text, flags: 0, frame: 0, offset: 0 }) as const;
const action = (block: number) =>
  ({ type: 'action', block, offset: 0 }) as const;

suite('APT timeline flow', () => {
  test('labels, stops and jumps from scripts and buttons land on their frames', () => {
    const frames: Frame[] = [
      { items: [label('_in'), action(1)] },
      { items: [] },
      {
        items: [
          label('_idle'),
          action(2),
          {
            type: 'placeObject',
            flags: 2,
            depth: 3,
            character: 5,
            offset: 0,
          },
        ],
      },
      { items: [label('_OUT')] },
    ];
    const behaviours: Record<number, Behaviour> = {
      1: {
        commands: [{ op: 'goto', target: [], label: '_IDLE', play: true }],
        skipped: 0,
        conditional: false,
      },
      2: {
        commands: [
          { op: 'stop', target: [] },
          // Another timeline's: not this one's flow
          { op: 'goto', target: ['menu'], frame: 0, play: false },
        ],
        skipped: 1,
        conditional: true,
      },
      9: {
        commands: [{ op: 'goto', target: [], label: '_out', play: false }],
        skipped: 0,
        conditional: false,
      },
    };
    const characters = [];

    characters[5] = { type: 'button', actions: [{ condition: 8, block: 9 }] };

    const flow = readTimelineFlow(
      frames,
      behaviours,
      characters as unknown as Character[],
    );

    assert.deepStrictEqual(
      flow.labels.map((each) => [each.label, each.frame]),
      [
        ['_in', 0],
        ['_idle', 2],
        ['_OUT', 3],
      ],
    );
    assert.deepStrictEqual(flow.stops, [2]);
    assert.deepStrictEqual(flow.conditional, [2]);
    assert.deepStrictEqual(
      flow.jumps.map((jump) => [
        jump.from.kind,
        jump.from.frame,
        jump.to,
        jump.play,
      ]),
      [
        ['frame', 0, 2, true],
        ['button', 2, 3, false],
      ],
    );
  });
});
