import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../formats/big/bigFormat';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { parseConst } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';

/**
 * An import resolves to the movie the game would load: a loose movie at an
 * install's root beats its archives, and archives are taken in the engine's
 * order, the first holding the movie winning. Everything is synthetic.
 */

const root = () => vscode.workspace.workspaceFolders![0].uri.fsPath;

const waitFor = async <T>(
  check: () => T | PromiseLike<T>,
  limit = 20_000,
): Promise<T> => {
  const timeoutAt = Date.now() + limit;

  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > timeoutAt) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

/** A movie's three files, named `<name>.*`, exporting one empty sprite per name */
const movieFiles = (name: string, exports: string[]) => {
  const files = createAptMovie({ width: 100, height: 100, exports });

  return [
    { name: `${name}.apt`, bytes: files.apt },
    { name: `${name}.const`, bytes: files.constFile },
    { name: `${name}.dat`, bytes: files.dat },
  ];
};

const archive = (files: { name: string; bytes: Uint8Array }[]): Buffer => {
  const entries = new Map<string, BigFileEntry>();

  for (const { name, bytes } of files) {
    entries.set(name, {
      name,
      offset: 0,
      size: bytes.length,
      pendingData: Buffer.from(bytes),
    });
  }

  const layout = computeArchiveLayout(entries);
  const out = Buffer.alloc(layout.totalSize);

  serializeIndexTable('BIGF', layout).copy(out, 0);
  for (const { entry, offset } of layout.placedEntries) {
    Buffer.from(entry.pendingData!).copy(out, offset);
  }
  return out;
};

interface ImportStatus {
  pageReady: boolean;
  unresolved?: string[];
  origins?: Record<string, string>;
}

suite('APT imports', () => {
  let folder: string;
  let rootUri: vscode.Uri;
  const created: string[] = [];

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(root(), 'aptimports');
    await mkdir(folder, { recursive: true });

    // The root movie imports LibA's Panel and Other
    const files = createAptMovie({ width: 100, height: 100, exports: [] });
    const image = new AptImage(files.apt);
    const movieOffset = parseConst(files.constFile).movieOffset;

    applyAptEdit(image, movieOffset, {
      kind: 'addImport',
      movie: 'LibA',
      name: 'Panel',
    });
    applyAptEdit(image, movieOffset, {
      kind: 'addImport',
      movie: 'liba.apt',
      name: 'Other',
    });
    await writeFile(path.join(folder, 'ImpRoot.apt'), image.bytes);
    await writeFile(path.join(folder, 'ImpRoot.const'), files.constFile);
    await writeFile(path.join(folder, 'ImpRoot.dat'), files.dat);
    rootUri = vscode.Uri.file(path.join(folder, 'ImpRoot.apt'));
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
    for (const file of created) {
      await rm(path.join(root(), file), { force: true });
    }
  });

  const status = () =>
    vscode.commands.executeCommand<ImportStatus>('bigfs.aptApplyEdit', rootUri);

  const add = async (name: string, bytes: Uint8Array | Buffer) => {
    created.push(name);
    await writeFile(path.join(root(), name), bytes);
  };

  test('the first archive in engine order, then a loose movie, wins', async function () {
    this.timeout(60_000);

    // zz_ holds LibA exporting Panel; aa_ sorts first and exports Other only
    await add('zz_aptlib.big', archive(movieFiles('LibA', ['Panel'])));
    await vscode.commands.executeCommand('bigfs.refreshArchives');
    await vscode.commands.executeCommand(
      'vscode.openWith',
      rootUri,
      'bigfs.aptEditor',
    );
    await waitFor(async () => {
      const shown = await status();

      assert.ok(shown.pageReady, 'the page did not load');
      assert.strictEqual(shown.origins?.liba, 'zz_aptlib.big');
      assert.deepStrictEqual(shown.unresolved, ['liba.apt:Other']);
    });

    await add('aa_aptlib.big', archive(movieFiles('LibA', ['Other'])));
    await vscode.commands.executeCommand('bigfs.refreshArchives');
    await waitFor(async () => {
      const shown = await status();

      assert.strictEqual(shown.origins?.liba, 'aa_aptlib.big');
      assert.deepStrictEqual(shown.unresolved, ['LibA:Panel']);
    });

    // Loose at the install's root beats every archive of it
    for (const file of movieFiles('LibA', ['Panel', 'Other'])) {
      await add(file.name, file.bytes);
    }
    await waitFor(async () => {
      const shown = await status();

      assert.match(shown.origins?.liba ?? '', /\(loose\)$/);
      assert.deepStrictEqual(shown.unresolved, []);
    });
  });
});
