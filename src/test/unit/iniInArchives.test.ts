import * as assert from 'assert';
import { readFileSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
} from '../../node/archiveFile';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import { decodeIniText } from '../../core/windows1252';
import {
  bulkChangesAcross,
  compileBulkQuery,
} from '../../game/ini-tools/bulkEdit';
import { labelsInText } from '../../game/text/gameTextLabels';
import { insertLines, replaceInLines } from '../../formats/ini/iniTextEdits';
import {
  isLoadedObjectPath,
  newObjectEntryPath,
} from '../../game/objects/newObject';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';
import { undefinedLabels } from '../../game/text/translations';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      path.join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

suite('INI inside archives', () => {
  let directory: string;

  setup(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'bigfs-ini-'));
  });

  teardown(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const writeArchive = (file: string, files: Record<string, string>) => {
    const entries = new Map<string, BigFileEntry>(
      Object.entries(files).map(([name, content]) => {
        const pendingData = Buffer.from(content);

        return [
          name,
          { name, offset: 0, size: pendingData.length, pendingData },
        ];
      }),
    );

    return writeArchiveFile(
      file,
      { magic: 'BIG4', trailer: new Uint8Array(8) },
      entries,
    );
  };

  test('a bulk edit read from an archive entry is written back to it in one save', async () => {
    const file = path.join(directory, 'mod.big');
    const entryName = 'data/ini/object/archer.ini';
    const original =
      'Object TestArcher\r\n  BuildCost = 120\r\nEnd\r\nObject TestKnight\r\n  BuildCost = 300\r\nEnd\r\n';

    await writeArchive(file, {
      [entryName]: original,
      'data/ini/other.ini': 'Object Other\n  BuildCost = 5\nEnd\n',
    });

    const parsed = await readArchiveIndexTable(file);
    const entry = parsed.entries.find((each) => each.name === entryName)!;
    const text = decodeIniText(await readEntryData(file, entry));
    const result = bulkChangesAcross(
      {
        sources: [
          {
            uri: 'bigfs:/mod/mod.big/' + entryName,
            document: parseSageIni(text.split(/\r?\n/), schema),
          },
        ],
        include: () => undefined,
      },
      compileBulkQuery({
        blocks: 'Object',
        where: '',
        field: 'BuildCost',
        formula: 'x * 2',
      }),
    );

    assert.strictEqual(result.changes.length, 2);

    const edited = replaceInLines(text, result.changes);

    await writeArchive(file, {
      [entryName]: edited,
      'data/ini/other.ini': 'Object Other\n  BuildCost = 5\nEnd\n',
    });

    const after = await readArchiveIndexTable(file);

    assert.strictEqual(
      decodeIniText(
        await readEntryData(
          file,
          after.entries.find((each) => each.name === entryName)!,
        ),
      ),
      original.replace('120', '240').replace('300', '600'),
    );
  });

  test('replacements keep line ends and apply several to one line', () => {
    assert.strictEqual(
      replaceInLines('a = 1 2\r\nb = 3\n', [
        { line: 0, start: 4, end: 5, after: '10' },
        { line: 0, start: 6, end: 7, after: '20' },
        { line: 1, start: 4, end: 5, after: '30' },
      ]),
      'a = 10 20\r\nb = 30\n',
    );
  });

  test('inserted lines go before their line or after the end, in the text own line ends', () => {
    assert.strictEqual(
      insertLines('Set\r\n  1 = A\r\nEnd\r\n', [
        { line: 2, lines: ['  2 = B'] },
        { lines: ['Object X', 'End'] },
      ]),
      'Set\r\n  1 = A\r\n  2 = B\r\nEnd\r\n\r\nObject X\r\nEnd\r\n',
    );
    assert.strictEqual(insertLines('', [{ lines: ['A'] }]), 'A\n');
  });

  test('the game loads object files from Data/INI/Object and nowhere else', () => {
    assert.strictEqual(isLoadedObjectPath('data/ini/object/a.ini'), true);
    assert.strictEqual(
      isLoadedObjectPath('Data\\INI\\Object\\GoodFaction\\a.ini'),
      true,
    );
    assert.strictEqual(isLoadedObjectPath('data/ini/object/a.inc'), false);
    assert.strictEqual(isLoadedObjectPath('data/ini/weapon.ini'), false);
    assert.strictEqual(isLoadedObjectPath('NewUnit.ini'), false);
  });

  test('a new object stays in its source file when the game loads it, else gets its own loaded file', () => {
    assert.strictEqual(
      newObjectEntryPath('data/ini/object/men/archer.ini', 'Ranger'),
      'data/ini/object/men/archer.ini',
    );
    assert.strictEqual(
      newObjectEntryPath('data/ini/object/includes/body.inc', 'Ranger'),
      'data/ini/object/Ranger.ini',
    );
    assert.strictEqual(
      newObjectEntryPath(undefined, 'Ranger'),
      'data/ini/object/Ranger.ini',
    );
  });

  test('labels are found in INI text without parsing it', () => {
    assert.deepStrictEqual(
      labelsInText(
        'Object A\n  DisplayName = OBJECT:A ; OBJECT:Comment\n  Pos = X:10 Y:5\nEnd',
      ),
      ['OBJECT:A'],
    );
  });

  test('a label no table defines is reported, one a table defines is not', () => {
    const tables = [
      {
        path: 'en.str',
        language: 'english',
        labels: new Map([['object:a', { label: 'OBJECT:A', text: 'A' }]]),
      },
    ];

    assert.deepStrictEqual(
      undefinedLabels(
        new Map([
          ['object:a', { label: 'OBJECT:A', usedIn: 'x.ini' }],
          ['object:b', { label: 'OBJECT:B', usedIn: 'big.big/y.ini' }],
        ]),
        tables,
      ),
      [{ label: 'OBJECT:B', usedIn: 'big.big/y.ini' }],
    );
  });
});
