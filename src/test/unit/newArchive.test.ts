import * as assert from 'assert';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  MAX_ARCHIVE_SIZE,
  computeArchiveLayout,
  parseHeader,
} from '../../formats/big/bigFormat';
import { createEmptyArchive } from '../../formats/big/emptyArchive';
import { createArchiveFile } from '../../node/createArchiveFile';
import { readArchiveIndexTable, writeArchiveFile } from '../../node/archiveFile';

suite('New archives', () => {
  let directory: string;

  setup(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'bigfs-new-'));
  });

  teardown(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  test('an empty archive is a BIG4 header whose size and data offset are its own length', () => {
    const bytes = createEmptyArchive();
    const header = parseHeader(bytes);

    assert.strictEqual(header.magic, 'BIG4');
    assert.strictEqual(header.entryCount, 0);
    assert.strictEqual(header.archiveSize, bytes.length);
    assert.strictEqual(header.dataOffset, bytes.length);
  });

  test('the reader opens an empty archive with no entries and keeps its trailer', async () => {
    const archivePath = path.join(directory, 'empty.big');

    await createArchiveFile(archivePath);

    const index = await readArchiveIndexTable(archivePath);

    assert.strictEqual(index.magic, 'BIG4');
    assert.deepStrictEqual(index.entries, []);
    assert.strictEqual(index.trailer.length, 8);
  });

  test('refuses to replace an archive that exists and leaves it untouched', async () => {
    const archivePath = path.join(directory, 'taken.big');

    await writeFile(archivePath, 'precious');
    await assert.rejects(createArchiveFile(archivePath), { code: 'EEXIST' });
    assert.strictEqual(await readFile(archivePath, 'utf-8'), 'precious');
  });

  test('the first entry saved into an empty archive reads back, including an empty one', async () => {
    const archivePath = path.join(directory, 'grow.big');

    await createArchiveFile(archivePath);

    const { magic, trailer } = await readArchiveIndexTable(archivePath);
    const layout = await writeArchiveFile(archivePath, { magic, trailer }, [
      { name: 'data/a.ini', offset: 0, size: 0, pendingData: Buffer.from('x=1') },
      { name: 'data/empty.ini', offset: 0, size: 0, pendingData: new Uint8Array() },
    ]);

    const reread = await readArchiveIndexTable(archivePath);

    assert.deepStrictEqual(
      reread.entries.map((entry) => [entry.name, entry.size]),
      [['data/a.ini', 3], ['data/empty.ini', 0]],
    );
    assert.strictEqual((await readFile(archivePath)).length, layout.totalSize);
  });

  test('a layout past what four byte offsets address is refused before any file is written', async () => {
    const archivePath = path.join(directory, 'huge.big');
    const huge = { name: 'a.bin', offset: 0, size: MAX_ARCHIVE_SIZE };

    assert.throws(() => computeArchiveLayout([huge]), /past the/);
    await assert.rejects(
      writeArchiveFile(archivePath, { magic: 'BIG4', trailer: new Uint8Array() }, [huge]),
      /past the/,
    );
    assert.deepStrictEqual(await readdir(directory), []);
  });

  test('a failed save leaves the archive as it was and no temporary file behind', async () => {
    const archivePath = path.join(directory, 'safe.big');

    await createArchiveFile(archivePath);

    const before = await readFile(archivePath);

    await assert.rejects(
      writeArchiveFile(archivePath, { magic: 'BIG4', trailer: new Uint8Array(8) }, [
        { name: 'a.ini', offset: 0, size: 4, pendingFile: path.join(directory, 'missing') },
      ]),
    );
    assert.deepStrictEqual(await readFile(archivePath), before);
    assert.deepStrictEqual(await readdir(directory), ['safe.big']);
  });
});
