import * as assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  readArchiveIndexTable,
  readEntryData,
  writeArchiveFile,
} from '../../binary/archiveFile';

/** A path with no file behind it, so a read that touches disk fails loudly */
const MISSING_ARCHIVE = path.join(tmpdir(), 'bigfs-does-not-exist.big');

suite('Archive entry reads', () => {
  let directory: string;

  setup(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'bigfs-'));
  });

  teardown(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /**
   * Writes the given text as the whole archive and returns its path. No header,
   * because these reads are positional and never parse one.
   */
  const writeArchive = async (content: string): Promise<string> => {
    const archivePath = path.join(directory, 'archive.big');

    await writeFile(archivePath, Buffer.from(content, 'utf-8'));

    return archivePath;
  };

  test('reads entry data at its offset', async () => {
    const archivePath = await writeArchive('headerENTRYDATAtail');

    const content = await readEntryData(archivePath, {
      name: 'entry.txt',
      offset: 6,
      size: 9,
    });

    assert.strictEqual(Buffer.from(content).toString('utf-8'), 'ENTRYDATA');
  });

  test('rejects an entry reaching past the end of the archive', async () => {
    const archivePath = await writeArchive('0123456789');

    await assert.rejects(
      readEntryData(archivePath, { name: 'cut.txt', offset: 4, size: 20 }),
      /Archive ends inside entry 'cut.txt', 6 of 20 bytes/,
    );
  });

  test('returns pending data without reading the archive', async () => {
    const pendingData = Buffer.from('not on disk yet', 'utf-8');

    const content = await readEntryData(MISSING_ARCHIVE, {
      name: 'new.txt',
      offset: 0,
      size: pendingData.length,
      pendingData,
    });

    assert.strictEqual(content, pendingData);
  });

  test('returns an empty buffer for an empty entry', async () => {
    const content = await readEntryData(MISSING_ARCHIVE, {
      name: 'empty.txt',
      offset: 0,
      size: 0,
    });

    assert.strictEqual(content.length, 0);
  });
});

/**
 * Builds a BIG4 archive laid out the way the shipped ones are: names as raw
 * bytes, data packed right after the table and its `L219` trailer, and 0x0C
 * pointing at the first entry's data
 */
const buildShippedArchive = (files: [Buffer, string][]): Buffer => {
  const trailer = Buffer.from('L219\0\0\0\0', 'latin1');
  const tableLength = files.reduce(
    (total, [name]) => total + 9 + name.length,
    0,
  );
  const dataOffset = 16 + tableLength + trailer.length;
  const records: Buffer[] = [];
  let offset = dataOffset;

  for (const [name, content] of files) {
    const record = Buffer.alloc(8);

    record.writeUInt32BE(offset, 0);
    record.writeUInt32BE(content.length, 4);
    records.push(record, name, Buffer.from([0]));
    offset += content.length;
  }

  const header = Buffer.alloc(16);

  header.write('BIG4', 0, 'ascii');
  header.writeUInt32LE(offset, 4);
  header.writeUInt32BE(files.length, 8);
  header.writeUInt32BE(dataOffset, 12);

  return Buffer.concat([
    header,
    ...records,
    trailer,
    ...files.map(([, content]) => Buffer.from(content, 'latin1')),
  ]);
};

suite('Archive rewrites', () => {
  let directory: string;

  setup(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'bigfs-'));
  });

  teardown(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('keeps names, trailer and content of an archive it rewrites', async () => {
    const archivePath = path.join(directory, 'shipped.big');
    const names = [
      Buffer.from('data\\ini\\object.ini', 'latin1'),
      Buffer.from('Palantir_geometry/115.ru', 'latin1'),
      Buffer.from('art\\caf\xe9.tga', 'latin1'),
    ];

    await writeFile(
      archivePath,
      buildShippedArchive([
        [names[0], 'Object A'],
        [names[1], 'shape'],
        [names[2], 'pixels'],
      ]),
    );

    const parsed = await readArchiveIndexTable(archivePath);

    await writeArchiveFile(archivePath, parsed, parsed.entries);

    const written = await readFile(archivePath);
    const reread = await readArchiveIndexTable(archivePath);

    names.forEach((name) => assert.ok(written.includes(name)));
    assert.deepStrictEqual(reread.trailer, parsed.trailer);
    assert.strictEqual(written.readUInt32LE(4), written.length);
    assert.strictEqual(written.readUInt32BE(12), reread.entries[0].offset);

    const contents = await Promise.all(
      reread.entries.map(async (entry) =>
        Buffer.from(await readEntryData(archivePath, entry)).toString('latin1'),
      ),
    );

    assert.deepStrictEqual(contents, ['Object A', 'shape', 'pixels']);
  });

  test('refuses at open an entry whose data runs past the file', async () => {
    const archivePath = path.join(directory, 'damaged.big');
    const archive = buildShippedArchive([[Buffer.from('a.txt'), 'abc']]);

    archive.writeUInt32BE(1024, 16 + 4);
    await writeFile(archivePath, archive);

    await assert.rejects(
      readArchiveIndexTable(archivePath),
      /past the archive end/,
    );
  });
});
