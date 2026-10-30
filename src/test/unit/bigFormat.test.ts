import * as assert from 'assert';
import {
  HEADER_LENGTH,
  computeArchiveLayout,
  parseHeader,
  parseIndexTable,
  serializeIndexTable,
} from '../../formats/big/bigFormat';
import type { BigFileEntry } from '../../formats/big/bigFormat';

/** Entries holding their content as pending data, the shape a write starts from */
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

/** Lays entries out and serializes the index table, the two steps a save pairs */
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
    assert.strictEqual(header.dataOffset, layout.dataOffset);

    const table = indexTable.subarray(HEADER_LENGTH, header.dataOffset);
    const parsedEntries = parseIndexTable(table, header.entryCount).entries;

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

  test('aligns every data offset after the first to four bytes', () => {
    const entries = createEntries([
      { name: 'a.txt', content: 'abc' },
      { name: 'b.txt', content: 'defg1' },
      { name: 'c.txt', content: 'hi' },
    ]);

    const { layout } = serializeArchive(entries);

    assert.strictEqual(layout.placedEntries[0].offset, layout.dataOffset);

    for (const { offset } of layout.placedEntries.slice(1)) {
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

    // XBIG carries BIG without being one of the magics, which anything looser
    // than the four byte comparison would let through
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

  test('parseIndexTable refuses a name that escapes the archive', () => {
    const record = Buffer.alloc(8);
    const table = Buffer.concat([
      record,
      Buffer.from('..\\evil.bat\0', 'latin1'),
    ]);

    assert.throws(() => parseIndexTable(table, 1), /Unsafe name/);
  });

  test('records the first data offset at 0x0C and keeps the trailer', () => {
    const entries = createEntries([{ name: 'data/a.ini', content: 'x' }]);
    const trailer = Buffer.from('L219\0\0\0\0', 'latin1');
    const layout = computeArchiveLayout(entries, trailer);
    const indexTable = serializeIndexTable('BIG4', layout);

    assert.strictEqual(
      indexTable.readUInt32BE(12),
      layout.placedEntries[0].offset,
    );
    assert.deepStrictEqual(
      indexTable.subarray(
        layout.indexTableEndOffset,
        layout.indexTableEndOffset + 8,
      ),
      trailer,
    );
  });

  test('writes a parsed name back byte for byte', () => {
    const stored = Buffer.from('Palantir_geometry/caf\xe9.ru', 'latin1');
    const table = Buffer.concat([Buffer.alloc(8), stored, Buffer.from([0])]);
    const [entry] = parseIndexTable(table, 1).entries;

    assert.strictEqual(entry.name, 'Palantir_geometry/caf\u00e9.ru');

    const indexTable = serializeIndexTable(
      'BIGF',
      computeArchiveLayout(new Map([[entry.name, entry]])),
    );

    assert.ok(indexTable.includes(stored));
  });

  test('refuses a new name Latin-1 cannot store', () => {
    const entries = createEntries([{ name: 'data/\u4e2d.ini', content: 'x' }]);

    assert.throws(() => computeArchiveLayout(entries), /cannot be stored/);
  });
});
