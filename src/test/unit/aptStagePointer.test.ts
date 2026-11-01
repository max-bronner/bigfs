/// <reference lib="dom" />
// The stage pointer is webview code; a fake canvas stands in for the DOM.
import * as assert from 'assert';
import type { Instance } from '../../webview/apt/instance';
import type { Player } from '../../webview/apt/player';
import type { HitArea } from '../../webview/apt/scene';
import { attachStagePointer } from '../../webview/apt/stagePointer';

type Listener = (event: MouseEvent) => void;

const hitAreaOf = (target: Instance): HitArea =>
  ({
    target,
    leaf: {
      matrix: [1, 0, 0, 1, 0, 0],
      character: { type: 'shape', bounds: [0, 0, 10, 10], geometry: 0 },
    },
  }) as unknown as HitArea;

const start = () => {
  const listeners = new Map<string, Listener>();
  const calls: string[] = [];
  const canvas = {
    style: {},
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, listener),
  } as unknown as HTMLCanvasElement;

  (globalThis as { window?: unknown }).window = {
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, listener),
  };

  const hits: HitArea[] = [];
  const name = (instance: Instance | undefined) => instance?.path ?? '-';
  const stagePointer = attachStagePointer(canvas, {
    tools: [],
    isInteractive: () => true,
    hasMovie: () => true,
    getPlayer: () =>
      ({
        hover: (from: Instance, to: Instance, isHeld: boolean) =>
          calls.push(`hover ${name(from)} ${name(to)} ${isHeld}`),
        press: (target: Instance) => calls.push(`press ${name(target)}`),
        release: (target: Instance, over: Instance) =>
          calls.push(`release ${name(target)} ${name(over)}`),
      }) as unknown as Player,
    getHits: () => hits,
    pointAt: (event) => [event.offsetX, event.offsetY],
    findInstanceAt: () => undefined,
    inspect: () => {},
    render: () => {},
  });
  const fire = (event: string, x = 0, y = 0) =>
    listeners.get(event)!({ offsetX: x, offsetY: y } as MouseEvent);

  return { stagePointer, fire, hits, calls };
};

const instance = (path: string) => ({ path }) as Instance;

suite('APT stage pointer', () => {
  teardown(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test('a button appearing under a still pointer is hovered once nothing is', () => {
    const { stagePointer, fire, hits, calls } = start();

    fire('mousemove', 5, 5);
    assert.strictEqual(stagePointer.updateAfterFrame(), false);
    hits.push(hitAreaOf(instance('a')));
    assert.strictEqual(stagePointer.updateAfterFrame(), true);
    assert.deepStrictEqual(calls, ['hover - a false']);
  });

  test('a button appearing over the hovered one waits for the pointer to move', () => {
    const { stagePointer, fire, hits, calls } = start();

    hits.push(hitAreaOf(instance('a')));
    fire('mousemove', 5, 5);
    hits.push(hitAreaOf(instance('b')));
    assert.strictEqual(stagePointer.updateAfterFrame(), false);
    fire('mousemove', 6, 5);
    assert.deepStrictEqual(calls, ['hover - a false', 'hover a b false']);
  });

  test('a hovered button that goes is replaced on the next frame', () => {
    const { stagePointer, fire, hits } = start();
    const gone = instance('a');

    hits.push(hitAreaOf(gone));
    fire('mousemove', 5, 5);
    gone.removed = true;
    hits.length = 0;
    assert.strictEqual(stagePointer.updateAfterFrame(), true);
    assert.strictEqual(stagePointer.getHovered(), undefined);
  });

  test('pressing on nothing and dragging onto a button is a drag', () => {
    const { fire, hits, calls } = start();

    hits.push(hitAreaOf(instance('a')));
    fire('mousemove', 50, 50);
    fire('mousedown', 50, 50);
    fire('mousemove', 5, 5);
    assert.deepStrictEqual(calls, ['hover - a true']);
  });

  test('leaving the stage with a button held is a drag out', () => {
    const { fire, hits, calls } = start();

    hits.push(hitAreaOf(instance('a')));
    fire('mousemove', 5, 5);
    fire('mousedown', 5, 5);
    fire('mouseleave');
    assert.deepStrictEqual(calls, [
      'hover - a false',
      'press a',
      'hover a - true',
    ]);
  });

  test('a release away from the button pressed goes to what is under the pointer', () => {
    const { fire, hits, calls } = start();

    hits.push(hitAreaOf(instance('a')));
    fire('mousemove', 5, 5);
    fire('mousedown', 5, 5);
    fire('mousemove', 50, 50);
    fire('mouseup');
    assert.deepStrictEqual(calls.slice(-2), ['hover a - true', 'release a -']);
  });

  test('a release that began off the stage does nothing', () => {
    const { fire, calls } = start();

    fire('mouseup');
    assert.deepStrictEqual(calls, []);
  });

  test('a restart forgets a held button', () => {
    const { stagePointer, fire, hits, calls } = start();

    hits.push(hitAreaOf(instance('a')));
    fire('mousedown', 5, 5);
    stagePointer.reset();
    fire('mouseup');
    assert.deepStrictEqual(calls, ['hover - a false', 'press a']);
  });

  test('a press picks again where the pointer is', () => {
    const { fire, hits, calls } = start();

    hits.push(hitAreaOf(instance('a')));
    fire('mousedown', 5, 5);
    fire('mouseup');
    assert.deepStrictEqual(calls, [
      'hover - a false',
      'press a',
      'release a a',
    ]);
  });
});
