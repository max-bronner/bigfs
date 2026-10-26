import * as assert from 'assert';
import * as vscode from 'vscode';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../binary/bigFormat';
import type { BigFileEntry } from '../../binary/bigFormat';

/**
 * Packaging a mod against a synthetic base game: the report says which
 * files its name lets it override and which a base archive keeps, and the
 * archive leaves hidden files out.
 */

const buildArchive = (files: [string, string][]): Buffer => {
  const entries = new Map<string, BigFileEntry>(
    files.map(([name, content]) => {
      const pendingData = Buffer.from(content, 'latin1');

      return [name, { name, offset: 0, size: pendingData.length, pendingData }];
    }),
  );
  const layout = computeArchiveLayout(entries);
  const archive = Buffer.alloc(layout.totalSize);

  serializeIndexTable('BIGF', layout).copy(archive, 0);
  for (const { entry, offset } of layout.placedEntries) {
    Buffer.from(entry.pendingData!).copy(archive, offset);
  }
  return archive;
};

suite('Package mod', () => {
  let base: string;
  let mod: string;
  let previous: string | undefined;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    base = await mkdtemp(path.join(tmpdir(), 'bigfs-package-base-'));
    mod = await mkdtemp(path.join(tmpdir(), 'bigfs-package-mod-'));
    await writeFile(
      path.join(base, 'INI.big'),
      buildArchive([['data\\ini\\weapon.ini', 'base']]),
    );
    await writeFile(
      path.join(base, '_patch.big'),
      buildArchive([['data\\ini\\armor.ini', 'base']]),
    );
    await mkdir(path.join(mod, 'data', 'ini'), { recursive: true });
    await mkdir(path.join(mod, '.git'));
    await writeFile(path.join(mod, 'data', 'ini', 'weapon.ini'), 'mod');
    await writeFile(path.join(mod, 'data', 'ini', 'armor.ini'), 'mod');
    await writeFile(path.join(mod, 'data', 'ini', 'new.ini'), 'mod');
    await writeFile(path.join(mod, '.git', 'config'), 'not game data');

    const config = vscode.workspace.getConfiguration();

    previous = config.get<string>('bigfs.baseGameFolder');
    await config.update(
      'bigfs.baseGameFolder',
      base,
      vscode.ConfigurationTarget.Global,
    );
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration()
      .update(
        'bigfs.baseGameFolder',
        previous,
        vscode.ConfigurationTarget.Global,
      );
    await rm(base, { recursive: true, force: true });
    await rm(mod, { recursive: true, force: true });
  });

  test('reports what its name overrides and packs the game files only', async function () {
    this.timeout(30_000);

    const target = path.join(mod, '..', `${path.basename(mod)}.big`);
    const result = await vscode.commands.executeCommand<{
      report: {
        added: string[];
        overrides: { path: string }[];
        ignored: { path: string; keptBy: string }[];
      };
      packed: number;
    }>('bigfs.packageMod', {
      folder: vscode.Uri.file(mod),
      // Sorts between `_patch.big` and `INI.big`
      name: 'aMod.big',
      delivery: 'gameFolder',
      target: vscode.Uri.file(target),
      confirm: false,
    });

    try {
      assert.deepStrictEqual(result.report.added, ['data/ini/new.ini']);
      assert.deepStrictEqual(
        result.report.overrides.map((each) => each.path),
        ['data/ini/weapon.ini'],
      );
      assert.deepStrictEqual(result.report.ignored, [
        { path: 'data/ini/armor.ini', keptBy: '_patch.big' },
      ]);
      assert.strictEqual(result.packed, 3);
      assert.ok(!(await readFile(target)).includes('not game data'));
    } finally {
      await rm(target, { force: true });
    }
  });
});
