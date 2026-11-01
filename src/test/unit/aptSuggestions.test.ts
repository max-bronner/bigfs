import * as assert from 'assert';
import {
  findImageSuggestion,
  findParameterSuggestion,
} from '../../game/apt/engineSuggestions';
import { MAX_OPTIONS, resolveSuggestions } from '../../features/apt/aptSuggestions';
import type { SuggestionIndex } from '../../features/apt/aptSuggestions';

/** A synthetic INI: files by name, each with blocks written as the games do */
const files: Record<string, string> = {
  'players.ini': [
    'PlayerTemplate FactionMen',
    '  Side = Men',
    '  PlayableSide = Yes',
    '  Evil = No',
    'End',
    'PlayerTemplate FactionMordor',
    '  Side = Mordor ; the dark',
    '  PlayableSide = Yes',
    '  Evil = Yes',
    'End',
    'PlayerTemplate FactionArnor',
    '  Side = Arnor',
    '  PlayableSide = No',
    '  Evil = No',
    'End',
    'PlayerTemplate FactionMenAgain',
    '  Side = men',
    'End',
  ].join('\r\n'),
  'buttons.ini': [
    'CommandButton Command_A',
    '  ButtonImage = BTA',
    'End',
    'CommandButton Command_B',
    '  ButtonImage = BTB',
    'End',
    'CommandButton Command_C',
    '  ButtonImage = bta',
    'End',
    'CommandButton Command_NoImage',
    'End',
  ].join('\n'),
};

interface Definition {
  uri: { toString(): string };
  line: number;
  endLine: number;
  name: string;
}

const define = (
  namespace: string,
  file: string,
): [string, Map<string, Definition>] => {
  const lines = files[file].split(/\r?\n/);
  const found = new Map<string, Definition>();

  lines.forEach((text, line) => {
    const match = new RegExp(`^${namespace}\\s+(\\S+)`).exec(text);

    if (match) {
      found.set(match[1], {
        uri: { toString: () => file },
        line,
        endLine: lines.indexOf('End', line),
        name: match[1],
      });
    }
  });
  return [namespace, found];
};

const names = (list: string[]) => list.map((value) => ({ value }));

const createIndex = (
  mapped: string[] = [],
  tables = [define('PlayerTemplate', 'players.ini'), define('CommandButton', 'buttons.ini')],
): SuggestionIndex => {
  const byNamespace = new Map(tables);

  byNamespace.set('MappedImage', new Map(mapped.map((name) => [name, { name } as Definition])));
  return {
    getNames: (namespace) => [...(byNamespace.get(namespace)?.keys() ?? [])].sort(),
    findDefinitions: (namespace, name) =>
      [byNamespace.get(namespace)?.get(name)].filter(Boolean) as never,
  };
};

const read = async (uri: { toString(): string }) => files[uri.toString()];

suite('APT engine suggestions', () => {
  test('a parameter and a surface key are matched to the INI set they take', () => {
    assert.strictEqual(findParameterSuggestion('SetPalantirFrameState', 'state')?.kind, 'sideState');
    assert.strictEqual(findParameterSuggestion('SetFaction', 'bttnState')?.kind, 'side');
    assert.strictEqual(findParameterSuggestion('SetPlayerFaction', 'faction')?.kind, 'side');
    assert.strictEqual(findParameterSuggestion('SetButtonState', 'state'), undefined);
    assert.strictEqual(findImageSuggestion('RenderFactionIcon')?.kind, 'factionIcon');
    assert.strictEqual(findImageSuggestion('TimeLine:PlayerFactionIcon:3')?.kind, 'factionIcon');
    assert.strictEqual(findImageSuggestion('LoadScreen.UIClip.Level.4')?.kind, 'rankIcon');
    assert.strictEqual(findImageSuggestion('LoadScreen.UIClip.Fellowship.4'), undefined);
    assert.strictEqual(findImageSuggestion('MainMenu.Image'), undefined);
  });

  test('sides come from the player templates, each once, with good or evil', async () => {
    assert.deepStrictEqual(await resolveSuggestions('side', createIndex(), read), [
      { value: 'Arnor', label: 'not playable' },
      { value: 'Men', label: 'good' },
      { value: 'Mordor', label: 'evil' },
    ]);
  });

  test('the palantir states name the playable sides they show', async () => {
    const options = await resolveSuggestions('sideState', createIndex(), read);

    assert.deepStrictEqual(
      options.map((each) => each.value),
      ['_good', '_evil', '_goodSingle', '_evilSingle'],
    );
    assert.strictEqual(options[0].label, 'good sides: Men');
    assert.strictEqual(options[1].label, 'evil sides: Mordor');
  });

  test('picture kinds list the MappedImages that follow the engine naming', async () => {
    const index = createIndex(['AptIconMen', 'AptIconMordor', 'AptIconLarge2', 'AptRankIconElves3', 'AptRankIcon10', 'Other']);

    assert.deepStrictEqual(await resolveSuggestions('factionIcon', index, read), names(['AptIconMen', 'AptIconMordor']));
    assert.deepStrictEqual(await resolveSuggestions('rankIcon', index, read), names(['AptRankIcon10', 'AptRankIconElves3']));
  });

  test('button pictures are the ButtonImage values, each once whatever its casing', async () => {
    assert.deepStrictEqual(await resolveSuggestions('buttonImage', createIndex(), read), names(['BTA', 'BTB']));
  });

  test('with no game loaded every kind answers nothing', async () => {
    const empty = createIndex([], []);

    for (const kind of ['side', 'sideState', 'factionIcon', 'rankIcon', 'buttonImage'] as const) {
      assert.deepStrictEqual(await resolveSuggestions(kind, empty, read), []);
    }
  });

  test('a file that cannot be read leaves its records out', async () => {
    const failing = async () => {
      throw new Error('gone');
    };

    assert.deepStrictEqual(await resolveSuggestions('side', createIndex(), failing), []);
  });

  test('a page cannot be sent more than the cap', async () => {
    const letters = (n: number): string =>
      n < 26
        ? String.fromCharCode(97 + n)
        : letters(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26));
    const many = Array.from(
      { length: MAX_OPTIONS + 10 },
      (_, i) => `AptIcon${letters(i)}`,
    );
    const options = await resolveSuggestions('factionIcon', createIndex(many), read);

    assert.strictEqual(options.length, MAX_OPTIONS);
  });
});
