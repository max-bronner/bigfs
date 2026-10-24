import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { readArchiveIndexTable } from '../../binary/archiveFile';
import {
  computeArchiveLayout,
  serializeIndexTable,
} from '../../binary/bigFormat';
import type { BigFileEntry } from '../../binary/bigFormat';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import { encodeTga } from '../../formats/textureEncode';

/**
 * The modding flows end to end, through the commands and editors a user
 * drives: new APT movies loose and inside an archive, a root movie importing
 * from one, and the particle preview from its lens to Apply to INI and undo.
 * Everything is synthetic; no game file is used.
 */

const workspaceRoot = () => vscode.workspace.workspaceFolders![0].uri.fsPath;

/** Retries a check until it passes, giving up after `limit` milliseconds */
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

const readMovie = async (aptPath: string) => {
  const apt = await readFile(aptPath);
  const constFile = parseConst(
    await readFile(aptPath.replace(/\.apt$/, '.const')),
  );

  return parseAptMovie(new Uint8Array(apt), constFile.movieOffset);
};

const buildArchive = (files: { name: string; content: string }[]): Buffer => {
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

  const layout = computeArchiveLayout(entries);
  const archive = Buffer.alloc(layout.totalSize);

  serializeIndexTable('BIGF', layout).copy(archive, 0);
  for (const { entry, offset } of layout.placedEntries) {
    Buffer.from(entry.pendingData!).copy(archive, offset);
  }
  return archive;
};

const archiveUri = (nodePath: string) =>
  vscode.Uri.from({
    scheme: 'bigfs',
    path: `/${vscode.workspace.workspaceFolders![0].name.toLowerCase()}${nodePath}`,
  });

suite('Modding flows: APT movies', () => {
  let folder: string;
  const archiveName = 'aptflow.big';

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(workspaceRoot(), 'aptflow');
    await mkdir(folder, { recursive: true });
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
    await rm(path.join(workspaceRoot(), archiveName), { force: true });
  });

  test('New APT Movie writes a movie with its exports and opens the editor', async function () {
    this.timeout(30_000);

    const uri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.newAptMovie',
      vscode.Uri.file(folder),
      {
        name: 'FlowLibrary',
        width: 800,
        height: 600,
        exports: ['PanelA', 'ButtonB'],
      },
    );

    assert.ok(uri, 'no movie was created');

    const movie = await readMovie(path.join(folder, 'FlowLibrary.apt'));

    assert.strictEqual(movie.record.screenWidth, 800);
    assert.deepStrictEqual(
      movie.exports.map((entry) => entry.name),
      ['PanelA', 'ButtonB'],
    );
    assert.ok(
      (
        await readFile(path.join(folder, 'FlowLibrary.dat'), 'latin1')
      ).startsWith('; Created by AptToBigc.'),
    );

    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;

    assert.ok(
      tab?.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === 'bigfs.aptEditor',
      'the new movie did not open in the APT editor',
    );
  });

  test('a root movie imports an export, and the import survives a save', async function () {
    this.timeout(40_000);

    const rootUri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.newAptMovie',
      vscode.Uri.file(folder),
      { name: 'FlowRoot' },
    );

    // The page loads the movie and asks for its data before it is usable
    await waitFor(async () => {
      const status = await vscode.commands.executeCommand<{
        pageReady: boolean;
      }>('bigfs.aptApplyEdit', rootUri);

      assert.ok(status.pageReady, 'the APT editor page did not load');
    });

    const result = await vscode.commands.executeCommand<{ character?: number }>(
      'bigfs.aptApplyEdit',
      rootUri,
      { kind: 'addImport', movie: 'FlowLibrary', name: 'PanelA' },
    );

    assert.strictEqual(result.character, 1);
    await vscode.commands.executeCommand('workbench.action.files.save');

    const movie = await waitFor(async () => {
      const read = await readMovie(path.join(folder, 'FlowRoot.apt'));

      assert.strictEqual(read.imports.length, 1, 'the import was not saved');
      return read;
    });

    assert.deepStrictEqual(movie.imports[0], {
      movie: 'FlowLibrary',
      name: 'PanelA',
      character: 1,
    });
    assert.strictEqual(movie.characters[1].type, 'placeholder');
  });

  test('New APT Movie works inside an archive', async function () {
    this.timeout(40_000);

    const archivePath = path.join(workspaceRoot(), archiveName);

    await writeFile(
      archivePath,
      buildArchive([{ name: 'data\\readme.txt', content: 'here' }]),
    );
    await vscode.commands.executeCommand('bigfs.refreshArchives');
    await waitFor(() =>
      vscode.workspace.fs.stat(archiveUri(`/${archiveName}/data`)),
    );

    const uri = await vscode.commands.executeCommand<vscode.Uri>(
      'bigfs.newAptMovie',
      archiveUri(`/${archiveName}/data`),
      { name: 'Packed', exports: ['Thing'] },
    );

    assert.ok(uri, 'no movie was created in the archive');

    const { entries } = await readArchiveIndexTable(archivePath);
    const names = entries.map((entry) => (entry.storedName ?? entry.name).toLowerCase());

    for (const extension of ['apt', 'const', 'dat']) {
      assert.ok(
        names.some((name) => name.endsWith(`packed.${extension}`)),
        `packed.${extension} is not in the archive: ${names.join(', ')}`,
      );
    }
  });
});

const PARTICLES = [
  'FXParticleSystem FlowSparks',
  '  System',
  '    ParticleName = flow_spark.tga',
  '    Shader = ALPHA',
  '    Lifetime = 30 30',
  '    BurstCount = 2 2',
  '    BurstDelay = 1 1',
  '    Size = 3 5',
  '    SlaveSystem = FlowSlave',
  '  End',
  '  Color = DefaultColor',
  '    Color1 = R:255 G:128 B:0 0',
  '  End',
  '  Alpha = DefaultAlpha',
  '    Alpha1 = 1 1 0',
  '  End',
  '  Physics = DefaultPhysics',
  '    VelocityDamping = 1 1',
  '  End',
  '  EmissionVelocity = OrthoEmissionVelocity',
  '    Z = 1 1',
  '  End',
  '  EmissionVolume = PointEmissionVolume',
  '  End',
  'End',
  '',
  'FXParticleSystem FlowSlave',
  '  System',
  '    Lifetime = 5 5',
  '    Size = 1 1',
  '  End',
  'End',
  '',
  'FXList FX_Flow',
  '  ParticleSystem',
  '    Name = FlowSparks',
  '  End',
  '  Sound',
  '    Name = NoSound',
  '  End',
  'End',
  '',
].join('\r\n');

interface PreviewHandle {
  lastScene?: {
    systems: Record<
      string,
      { size: { high: number }; lifetime: { low: number } }
    >;
    fxLists: Record<string, unknown>;
    textures: Record<string, string | null>;
    notes: string[];
    fields: { id: string; keyword: string; part: string }[];
  };
  lastStatus?: { frame: number; systems: number; particles: number };
  receive(message: Record<string, unknown>): Promise<void>;
  settled(): Promise<void>;
  dispose(): void;
}

suite('Modding flows: particle preview', () => {
  let folder: string;
  let document: vscode.TextDocument;
  let preview: PreviewHandle;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(workspaceRoot(), 'fxflow');
    await mkdir(folder, { recursive: true });

    const pixels = new Uint8Array(8 * 8 * 4).fill(255);

    await writeFile(
      path.join(folder, 'flow_spark.tga'),
      encodeTga({ width: 8, height: 8, pixels }, true),
    );
    await writeFile(path.join(folder, 'flowparticles.ini'), PARTICLES);
    document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(
        path.join(folder, 'flowparticles.ini'),
      ),
      'sage-ini',
    );
    await vscode.window.showTextDocument(document);
  });

  suiteTeardown(async () => {
    preview?.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('every particle system and FX list gets a preview lens', async function () {
    this.timeout(20_000);

    const lenses = await waitFor(async () => {
      const found = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        document.uri,
      );

      assert.ok(found.length >= 3, 'lenses missing');
      return found;
    });

    assert.deepStrictEqual(
      lenses.map((lens) => lens.command?.title),
      [
        '▶ Preview particle system',
        '▶ Preview particle system',
        '▶ Preview FX list',
      ],
    );
  });

  test('the preview runs the system in its page with its texture and slave', async function () {
    this.timeout(40_000);

    preview = (await vscode.commands.executeCommand<PreviewHandle>(
      'bigfs.previewParticles',
      document.uri,
      'FlowSparks',
    ))!;

    const scene = await waitFor(() => {
      assert.ok(preview.lastScene, 'no scene was sent');
      return preview.lastScene;
    });

    assert.ok(scene.systems.flowslave, 'the slave system was not resolved');
    assert.match(
      scene.textures['flow_spark.tga'] ?? '',
      /^data:image\/png;base64,/,
    );

    // The page reports what its simulation is running
    await waitFor(() => {
      assert.ok(
        (preview.lastStatus?.particles ?? 0) > 0,
        `the page ran no particles: ${JSON.stringify(preview.lastStatus)}`,
      );
    }, 30_000);
  });

  test('a slider changes the preview only, and Apply to INI writes it as one undoable edit', async function () {
    this.timeout(30_000);

    const original = document.getText();
    const size = preview.lastScene!.fields.find(
      (field) => field.keyword === 'Size' && field.part === 'max',
    )!;

    await preview.receive({ kind: 'set', id: size.id, value: 9 });
    await preview.settled();

    assert.strictEqual(preview.lastScene!.systems.flowsparks.size.high, 9);
    assert.strictEqual(document.getText(), original);

    await preview.receive({ kind: 'apply' });
    await waitFor(() => assert.match(document.getText(), /Size = 3 9\r?\n/));

    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('undo');
    await waitFor(() => assert.strictEqual(document.getText(), original));
  });

  test('typing in the block updates the running preview', async function () {
    this.timeout(30_000);

    const line = document
      .getText()
      .split(/\r?\n/)
      .findIndex((text) => text.includes('Lifetime = 30 30'));
    const edit = new vscode.WorkspaceEdit();

    edit.replace(
      document.uri,
      new vscode.Range(line, 0, line, document.lineAt(line).text.length),
      '    Lifetime = 45 45',
    );
    await vscode.workspace.applyEdit(edit);

    await waitFor(() =>
      assert.strictEqual(
        preview.lastScene!.systems.flowsparks.lifetime.low,
        45,
      ),
    );
  });

  test('an FX list preview resolves its nuggets and names what it skips', async function () {
    this.timeout(30_000);

    const list = (await vscode.commands.executeCommand<PreviewHandle>(
      'bigfs.previewParticles',
      document.uri,
      'FX_Flow',
    ))!;

    try {
      const scene = await waitFor(() => {
        assert.ok(list.lastScene, 'no scene was sent');
        return list.lastScene;
      });

      assert.ok(scene.fxLists.fx_flow);
      assert.ok(scene.systems.flowsparks);
      assert.ok(scene.notes.some((note) => /Sound not previewed/.test(note)));
    } finally {
      list.dispose();
    }
  });
});
