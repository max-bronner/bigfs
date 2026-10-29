import * as assert from 'assert';
import Module from 'module';

// singletonPanel opens its panel through `vscode.window`, which a plain mocha
// run does not have; a fake stands in for the one require and is then removed.
type Loader = (request: string, ...rest: unknown[]) => unknown;

interface FakePanel {
  viewType: string;
  title: string;
  column: unknown;
  options: unknown;
  webview: {
    html: string;
    posted: unknown[];
    postMessage: (message: unknown) => Promise<boolean>;
    receive: (message: unknown) => void;
    onDidReceiveMessage: (listener: (message: unknown) => void) => {
      dispose: () => void;
    };
  };
  reveals: unknown[][];
  reveal: (...args: unknown[]) => void;
  onDidDispose: (listener: () => void) => void;
  dispose: () => void;
}

const created: FakePanel[] = [];

const createFakePanel = (
  viewType: string,
  title: string,
  column: unknown,
  options: unknown,
): FakePanel => {
  let onMessage: ((message: unknown) => void) | undefined;
  let onClose: (() => void) | undefined;
  const panel: FakePanel = {
    viewType,
    title,
    column,
    options,
    webview: {
      html: '',
      posted: [],
      postMessage: async (message) => {
        panel.webview.posted.push(message);
        return true;
      },
      receive: (message) => onMessage?.(message),
      onDidReceiveMessage: (listener) => {
        onMessage = listener;
        return {
          dispose: () => {
            onMessage = undefined;
          },
        };
      },
    },
    reveals: [],
    reveal: (...args) => {
      panel.reveals.push(args);
    },
    onDidDispose: (listener) => {
      onClose = listener;
    },
    dispose: () => onClose?.(),
  };

  created.push(panel);
  return panel;
};

const internals = Module as unknown as { _load: Loader };
const original = internals._load;

internals._load = (request, ...rest) =>
  request === 'vscode'
    ? { window: { createWebviewPanel: createFakePanel } }
    : original.call(Module, request, ...rest);

let singleton: typeof import('../../platform/webview/singletonPanel');

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  singleton = require('../../platform/webview/singletonPanel');
} finally {
  internals._load = original;
}

const options = { enableScripts: true, retainContextWhenHidden: true };

suite('Singleton panel', () => {
  setup(() => {
    created.length = 0;
  });

  test('opens nothing until shown, then once however often it is shown', () => {
    const panel = singleton.createSingletonPanel({
      viewType: 'bigfs.test',
      title: 'Test',
      column: 2,
      options,
      render: ({ webview }) => {
        webview.html = '<p>page</p>';
      },
    });

    assert.strictEqual(panel.isOpen(), false);
    assert.strictEqual(created.length, 0);

    const first = panel.show();
    const second = panel.show();

    assert.strictEqual(created.length, 1);
    assert.strictEqual(first, second);
    assert.strictEqual(panel.isOpen(), true);
    assert.strictEqual(created[0].viewType, 'bigfs.test');
    assert.strictEqual(created[0].title, 'Test');
    assert.strictEqual(created[0].column, 2);
    assert.strictEqual(created[0].options, options);
    assert.strictEqual(created[0].webview.html, '<p>page</p>');
  });

  test('reveals an open panel where the caller says, and not a new one', () => {
    const panel = singleton.createSingletonPanel({
      viewType: 'bigfs.test',
      title: 'Test',
      column: 1,
      options,
      render: () => {},
    });

    panel.show();
    panel.show();
    panel.show({ column: 2, preserveFocus: true });

    assert.deepStrictEqual(created[0].reveals, [
      [undefined, undefined],
      [2, true],
    ]);
  });

  test('hands the page messages to the handler', () => {
    const received: unknown[] = [];
    const panel = singleton.createSingletonPanel<{ kind: string }>({
      viewType: 'bigfs.test',
      title: 'Test',
      column: 1,
      options,
      render: () => {},
      onMessage: (message) => received.push(message),
    });

    panel.show();
    created[0].webview.receive({ kind: 'ready' });

    assert.deepStrictEqual(received, [{ kind: 'ready' }]);
  });

  test('posts to the open panel and reports false when closed', async () => {
    const panel = singleton.createSingletonPanel({
      viewType: 'bigfs.test',
      title: 'Test',
      column: 1,
      options,
      render: () => {},
    });

    assert.strictEqual(await panel.post({ kind: 'early' }), false);
    panel.show();
    assert.strictEqual(await panel.post({ kind: 'late' }), true);
    assert.deepStrictEqual(created[0].webview.posted, [{ kind: 'late' }]);
  });

  test('closing releases what render registered and allows a fresh panel', () => {
    let released = 0;
    let closed = 0;
    const received: unknown[] = [];
    const panel = singleton.createSingletonPanel({
      viewType: 'bigfs.test',
      title: 'Test',
      column: 1,
      options,
      render: () => [{ dispose: () => released++ }],
      onMessage: (message) => received.push(message),
      onDispose: () => closed++,
    });

    panel.show();
    created[0].dispose();

    assert.strictEqual(panel.isOpen(), false);
    assert.strictEqual(released, 1);
    assert.strictEqual(closed, 1);
    created[0].webview.receive('after close');
    assert.deepStrictEqual(received, []);

    panel.show();
    assert.strictEqual(created.length, 2);
    assert.strictEqual(panel.isOpen(), true);
  });

  test('dispose closes the open panel and is harmless when closed', () => {
    let closed = 0;
    const panel = singleton.createSingletonPanel({
      viewType: 'bigfs.test',
      title: 'Test',
      column: 1,
      options,
      render: () => {},
      onDispose: () => closed++,
    });

    panel.dispose();
    panel.show();
    panel.dispose();
    panel.dispose();

    assert.strictEqual(panel.isOpen(), false);
    assert.strictEqual(closed, 1);
  });
});
