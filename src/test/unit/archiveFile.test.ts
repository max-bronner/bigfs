import * as assert from 'assert';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { readEntryData } from '../../big/archiveIO';

const MISSING_ARCHIVE = path.join(tmpdir(), 'bigfs-does-not-exist.big');

suite('Archive entry reads', () => {
  let directory: string;

  setup(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'bigfs-'));
  });

  teardown(async () => {
    await rm(directory, { recursive: true, force: true });
  });

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
