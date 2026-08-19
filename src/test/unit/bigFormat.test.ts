import * as assert from 'assert';
import {
  HEADER_LENGTH,
  computeArchiveLayout,
  parseHeader,
  parseIndexTable,
  serializeIndexTable,
} from '../../format/bigFormat';
import type { BigFileEntry } from '../../format/bigFormat';

const createEntries = (
  files: { name: string; content: string }[],
): Map<string, BigFileEntry> => {
  const entries = new Map<string, BigFileEntry>();

  for (const { name, content } of files) {
    const pendingData = Buffer.from(content, 'utf-8');

    entries.set(name, {
      name,
      offset: 0,
      size: pendingData.length,
      pendingData,
    });
  }

  return entries;
};

const serializeArchive = (entries: Map<string, BigFileEntry>) => {
  const layout = computeArchiveLayout(entries);
  const indexTable = serializeIndexTable('BIGF', layout);

  return { layout, indexTable };
};

suite('BIG format', () => {
  test('round-trips entries through serialize and parse', () => {
    const entries = createEntries([
      { name: 'data/ini/object.ini', content: 'ObjectData' },
      { name: 'art/textures/unit.dds', content: 'TextureBytes' },
      { name: 'readme.txt', content: 'Top level' },
    ]);

    const { layout, indexTable } = serializeArchive(entries);
    const header = parseHeader(indexTable.subarray(0, HEADER_LENGTH));

    assert.strictEqual(header.magic, 'BIGF');
    assert.strictEqual(header.entryCount, 3);
    assert.strictEqual(header.archiveSize, layout.totalSize);
    assert.strictEqual(header.indexTableEndOffset, layout.indexTableEndOffset);

    const table = indexTable.subarray(
      HEADER_LENGTH,
      header.indexTableEndOffset,
    );
    const parsedEntries = parseIndexTable(table, header.entryCount);

    assert.deepStrictEqual(
      parsedEntries.map((entry) => entry.name),
      ['data/ini/object.ini', 'art/textures/unit.dds', 'readme.txt'],
    );

    layout.placedEntries.forEach(({ entry, offset, size }, index) => {
      assert.strictEqual(parsedEntries[index].offset, offset);
      assert.strictEqual(parsedEntries[index].size, size);
      assert.strictEqual(size, entry.pendingData?.length);
    });
  });

  test('stores names with backslash separators', () => {
    const entries = createEntries([
      { name: 'data/ini/weapon.ini', content: 'x' },
    ]);
    const { indexTable } = serializeArchive(entries);

    assert.ok(
      indexTable.includes(Buffer.from('data\\ini\\weapon.ini', 'utf-8')),
    );
    assert.ok(
      !indexTable.includes(Buffer.from('data/ini/weapon.ini', 'utf-8')),
    );
  });

  test('aligns data offsets to four bytes', () => {
    const entries = createEntries([
      { name: 'a.txt', content: 'abc' },
      { name: 'b.txt', content: 'defg1' },
      { name: 'c.txt', content: 'hi' },
    ]);

    const { layout } = serializeArchive(entries);

    for (const { offset } of layout.placedEntries) {
      assert.strictEqual(offset % 4, 0);
    }
  });

  test('uses pending data length over stale entry size', () => {
    const entries = new Map<string, BigFileEntry>([
      [
        'a.txt',
        {
          name: 'a.txt',
          offset: 64,
          size: 999,
          pendingData: Buffer.from('new'),
        },
      ],
    ]);

    const layout = computeArchiveLayout(entries);

    assert.strictEqual(layout.placedEntries[0].size, 3);
  });

  test('computes layout for an empty archive', () => {
    const layout = computeArchiveLayout(new Map());

    assert.deepStrictEqual(layout.placedEntries, []);
    assert.strictEqual(layout.indexTableEndOffset, HEADER_LENGTH);
    assert.strictEqual(layout.totalSize, HEADER_LENGTH);
  });

  test('accepts only the supported magics', () => {
    const headerWith = (magic: string): Buffer => {
      const header = Buffer.alloc(HEADER_LENGTH);

      header.write(magic, 0, 'ascii');

      return header;
    };

    assert.strictEqual(parseHeader(headerWith('BIGF')).magic, 'BIGF');
    assert.strictEqual(parseHeader(headerWith('BIG4')).magic, 'BIG4');

    assert.throws(
      () => parseHeader(headerWith('ZZZZ')),
      /Invalid BIG file magic/,
    );

    assert.throws(
      () => parseHeader(headerWith('XBIG')),
      /Invalid BIG file magic/,
    );
  });

  test('rejects an index table with missing entries', () => {
    const entries = createEntries([{ name: 'a.txt', content: 'abc' }]);
    const { layout, indexTable } = serializeArchive(entries);
    const table = indexTable.subarray(
      HEADER_LENGTH,
      layout.indexTableEndOffset,
    );

    assert.throws(() => parseIndexTable(table, 2), /1 of 2 entries/);
  });

  test('rejects an unterminated entry name', () => {
    const entries = createEntries([{ name: 'a.txt', content: 'abc' }]);
    const { layout, indexTable } = serializeArchive(entries);
    const table = indexTable.subarray(
      HEADER_LENGTH,
      layout.indexTableEndOffset - 1, // cut the null terminator
    );

    assert.throws(() => parseIndexTable(table, 1), /Unterminated name/);
  });
});
