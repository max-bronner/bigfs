import * as assert from 'assert';
import { createToolRegistry } from '../../tools/toolRegistry';
import type { Tool } from '../../tools/toolRegistry';

const upperCase: Tool<string, string> = {
  id: 'test.upper',
  run: (text) => text.toUpperCase(),
};

const exclaim: Tool<string, string> = {
  id: 'test.exclaim',
  // Reaching another tool is what lets a format compose them
  run: async (text, tools) => `${await tools.use(upperCase)(text)}!`,
};

suite('Tool registry', () => {
  test('runs a registered tool', async () => {
    const registry = createToolRegistry();

    registry.register(upperCase as Tool<never, unknown>);

    assert.strictEqual(await registry.use(upperCase)('abc'), 'ABC');
  });

  test('lets a tool use another tool', async () => {
    const registry = createToolRegistry();

    registry.register(
      upperCase as Tool<never, unknown>,
      exclaim as Tool<never, unknown>,
    );

    assert.strictEqual(await registry.use(exclaim)('abc'), 'ABC!');
  });

  test('resolves the registered tool, so one can be replaced', async () => {
    const registry = createToolRegistry();
    const replacement: Tool<string, string> = {
      id: upperCase.id,
      run: () => 'replaced',
    };

    registry.register(replacement as Tool<never, unknown>);

    // Callers keep referring to the original and get the replacement
    assert.strictEqual(await registry.use(upperCase)('abc'), 'replaced');
  });

  test('refuses two tools with the same id', () => {
    const registry = createToolRegistry();

    registry.register(upperCase as Tool<never, unknown>);

    assert.throws(
      () => registry.register(upperCase as Tool<never, unknown>),
      /already registered/,
    );
  });

  test('runs an unregistered tool a caller passes in', async () => {
    const registry = createToolRegistry();

    assert.strictEqual(await registry.use(upperCase)('abc'), 'ABC');
    assert.deepStrictEqual(registry.all(), []);
  });
});
