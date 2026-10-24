import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../binary/bigFormat';
import type { BigFileEntry } from '../../binary/bigFormat';
import { ArchiveModel } from '../../model/archiveModel';
import { GameViewModel } from '../../model/gameViewModel';

/** The bytes of an archive holding the given files */
const buildArchive = (files: Record<string, string>): Buffer => {
  const entries = new Map<string, BigFileEntry>(
    Object.entries(files).map(([name, content]) => {
      const pendingData = Buffer.from(content);

      return [name, { name, offset: 0, size: pendingData.length, pendingData }];
    }),
  );
  const layout = computeArchiveLayout(entries);
  const archive = Buffer.alloc(layout.totalSize);

  serializeIndexTable('BIG4', layout).copy(archive, 0);
  layout.placedEntries.forEach(({ entry, offset }) =>
    Buffer.from(entry.pendingData!).copy(archive, offset),
  );

  return archive;
};

suite('Game view', () => {
  let root: string;
  let log: vscode.LogOutputChannel;
  let model: ArchiveModel;
  let gameView: GameViewModel;

  suiteSetup(async function () {
    this.timeout(30_000);

    root = vscode.workspace.workspaceFolders![0].uri.fsPath;

    await writeFile(
      path.join(root, 'gv_base.big'),
      buildArchive({
        'gameview/shared.ini': 'base',
        'gameview/only_base.ini': 'base',
        'gameview/loose.ini': 'archived',
      }),
    );
    await writeFile(
      path.join(root, '___gv_patch.big'),
      buildArchive({ 'GameView/Shared.ini': 'patched' }),
    );
    await mkdir(path.join(root, 'gameview'), { recursive: true });
    await writeFile(path.join(root, 'gameview', 'loose.ini'), 'loose');

    log = vscode.window.createOutputChannel('bigFS game view tests', {
      log: true,
    });
    model = new ArchiveModel(log);
    gameView = new GameViewModel(model);
    await model.whenReady();
  });

  suiteTeardown(async () => {
    gameView.dispose();
    model.dispose();
    log.dispose();

    await rm(path.join(root, 'gv_base.big'), { force: true });
    await rm(path.join(root, '___gv_patch.big'), { force: true });
    await rm(path.join(root, 'gameview'), { recursive: true, force: true });
  });

  test('shows one file per path, from the archive the engine reads first', async function () {
    this.timeout(30_000);

    const folder = (await gameView.getRoot()).children?.get('gameview');
    const shared = folder?.children?.get('shared.ini');
    const onlyBase = folder?.children?.get('only_base.ini');

    assert.strictEqual(shared?.winner?.origin, '___gv_patch.big');
    assert.deepStrictEqual(
      shared?.shadowed?.map((copy) => copy.origin),
      ['gv_base.big'],
    );
    assert.strictEqual(onlyBase?.winner?.origin, 'gv_base.big');
  });

  test('a loose file beats every archive of its folder', async () => {
    const loose = (await gameView.getRoot()).children
      ?.get('gameview')
      ?.children?.get('loose.ini');

    assert.strictEqual(loose?.winner?.ref.kind, 'loose');
    assert.deepStrictEqual(
      loose?.shadowed?.map((copy) => copy.origin),
      ['gv_base.big'],
    );
  });
});
