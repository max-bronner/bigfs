import * as assert from 'assert';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../formats/big/bigFormat';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import { compareWithBase, indexBaseGame } from '../../model/modDiff';

const buildArchive = (files: [string, string][]): Buffer => {
  const entries = new Map<string, BigFileEntry>();

  files.forEach(([name, content], index) => {
    const pendingData = Buffer.from(content, 'latin1');

    // Duplicates get their own key, as an archive keeps both
    entries.set(`${name}#${index}`, {
      name,
      offset: 0,
      size: pendingData.length,
      pendingData,
    });
  });

  const layout = computeArchiveLayout(entries);
  const archive = Buffer.alloc(layout.totalSize);

  serializeIndexTable('BIGF', layout).copy(archive, 0);

  for (const { entry, offset } of layout.placedEntries) {
    Buffer.from(entry.pendingData!).copy(archive, offset);
  }

  return archive;
};

suite('Mod against the base game', () => {
  let folder: string;

  suiteSetup(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'bigfs-base-'));
    await mkdir(path.join(folder, 'lang'));
    await writeFile(
      path.join(folder, 'ini.big'),
      buildArchive([
        ['data\\ini\\a.ini', 'old'],
        ['data\\ini\\b.ini', 'same'],
      ]),
    );
    // Sorted after ini.big, so its copy of a.ini loses
    await writeFile(
      path.join(folder, 'lang', 'patch.big'),
      buildArchive([
        ['data\\ini\\a.ini', 'lost'],
        ['data\\lotr.str', 'one'],
        ['data\\lotr.str', 'two'],
      ]),
    );
    await writeFile(path.join(folder, 'broken.big'), Buffer.from('nope'));
  });

  suiteTeardown(() => rm(folder, { recursive: true, force: true }));

  test('the base game follows the engine order and reports what it cannot read', async () => {
    const { index, archives, unreadable } = await indexBaseGame(folder);

    assert.strictEqual(archives, 3);
    assert.deepStrictEqual(unreadable, ['broken.big']);
    assert.ok(index.get('data/ini/a.ini')?.archive.endsWith('ini.big'));
    assert.strictEqual(index.get('data/lotr.str')?.size, 3);
  });

  test("the mod's files sort into added, changed and the same", async () => {
    const { index } = await indexBaseGame(folder);
    const file = (entryPath: string, content: string) => ({
      entryPath,
      size: content.length,
      read: () => Promise.resolve(Buffer.from(content, 'latin1')),
    });
    const results = await compareWithBase(
      [
        file('data/ini/a.ini', 'new'),
        file('data/ini/b.ini', 'same'),
        file('data/ini/c.ini', 'mine'),
        file('data/lotr.str', 'longer'),
      ],
      index,
    );

    assert.deepStrictEqual(
      results.map((result) => [result.entryPath, result.change]),
      [
        ['data/ini/a.ini', 'changed'],
        ['data/ini/b.ini', 'same'],
        ['data/ini/c.ini', 'added'],
        ['data/lotr.str', 'changed'],
      ],
    );
  });
});
