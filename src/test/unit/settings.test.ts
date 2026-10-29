import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSettings } from '../../platform/createSettings';

interface Contributed {
  default: unknown;
}

const contributed = (): Record<string, Contributed> => {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
  );
  const sections = [manifest.contributes.configuration].flat();

  return Object.assign({}, ...sections.map(({ properties }) => properties));
};

/** A configuration that holds what a test sets and records what is written */
const fakeConfiguration = (values: Record<string, unknown> = {}) => {
  const written: [string, unknown, unknown][] = [];

  return {
    written,
    source: () => ({
      get: <T>(key: string, fallback?: T) =>
        (key in values ? values[key] : fallback) as T,
      update: async (key: string, value: unknown, target?: unknown) => {
        written.push([key, value, target]);
      },
    }),
  };
};

suite('Settings', () => {
  test('has an accessor for every contributed key, with the contributed default', () => {
    const settings = createSettings(fakeConfiguration().source as never);
    const accessors = Object.values(settings);
    const properties = contributed();

    assert.deepStrictEqual(
      accessors.map(({ key }) => key).sort(),
      Object.keys(properties).sort(),
    );
    for (const { key, get } of accessors) {
      assert.deepStrictEqual(get(), properties[key].default, key);
    }
  });

  test('reads a value the user set and falls back to the default otherwise', () => {
    const { source } = fakeConfiguration({ 'bigfs.ini.game': 'bfme2' });
    const settings = createSettings(source as never);

    assert.strictEqual(settings.iniGame.get(), 'bfme2');
    assert.strictEqual(settings.iniCheckAssets.get(), 'auto');
  });

  test('writes under the contributed key and the given target', async () => {
    const { source, written } = fakeConfiguration();
    const settings = createSettings(source as never);

    await settings.baseGameFolder.update('C:\\Games\\ROTWK', 1);

    assert.deepStrictEqual(written, [
      ['bigfs.baseGameFolder', 'C:\\Games\\ROTWK', 1],
    ]);
  });
});
