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
    const names = entries.map((entry) =>
      (entry.storedName ?? entry.name).toLowerCase(),
    );

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

  test('a new key rewrites the keys with the values pending, in one edit', async function () {
    this.timeout(30_000);

    const original = document.getText();
    const size = preview.lastScene!.fields.find(
      (field) => field.keyword === 'Size' && field.part === 'min',
    )!;

    await preview.receive({ kind: 'set', id: size.id, value: 4 });
    await preview.receive({
      kind: 'keys',
      keyKind: 'Alpha',
      keys: [
        { min: 1, max: 1, frame: 0 },
        { min: 0, max: 0, frame: 30 },
      ],
    });
    await waitFor(() =>
      assert.match(
        document.getText(),
        /Size = 4 5\r?\n[\s\S]*Alpha1 = 1\.00 1\.00 0\r?\n {4}Alpha2 = 0\.00 0\.00 30\r?\n {2}End/,
      ),
    );

    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('undo');
    await waitFor(() => assert.strictEqual(document.getText(), original));
  });

  test('A/B holds the values back, and a variant keeps them under a new name', async function () {
    this.timeout(30_000);

    const original = document.getText();
    const size = preview.lastScene!.fields.find(
      (field) => field.keyword === 'Size' && field.part === 'max',
    )!;

    await preview.receive({ kind: 'set', id: size.id, value: 8 });
    await preview.receive({ kind: 'compare', on: true });
    await preview.settled();
    assert.strictEqual(preview.lastScene!.systems.flowsparks.size.high, 5);

    await preview.receive({ kind: 'compare', on: false });
    await preview.settled();
    assert.strictEqual(preview.lastScene!.systems.flowsparks.size.high, 8);

    await preview.receive({ kind: 'variant', name: 'FlowSparksBig' });
    await waitFor(() =>
      assert.match(
        document.getText(),
        /\nEnd\r?\n\r?\nFXParticleSystem FlowSparksBig\r?\n[\s\S]*?Size = 3 8\r?\n/,
      ),
    );
    assert.match(document.getText(), /FlowSparks\r?\n[\s\S]*?Size = 3 5\r?\n/);

    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('undo');
    await waitFor(() => assert.strictEqual(document.getText(), original));
  });

  test('a template is inserted after the definition the cursor is in', async function () {
    this.timeout(30_000);

    const editor = await vscode.window.showTextDocument(document);

    editor.selection = new vscode.Selection(2, 0, 2, 0);
    await vscode.commands.executeCommand('bigfs.newParticleSystem', 'Sparks');
    await waitFor(() =>
      assert.match(
        document.getText(),
        /\nEnd\r?\n\r?\nFXParticleSystem FX_Sparks\r?\n {2}System\r?\n/,
      ),
    );
    await vscode.commands.executeCommand('undo');
  });
});
