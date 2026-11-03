import * as assert from 'assert';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { writeArchiveFile } from '../../node/archiveFile';
import type { BigFileEntry } from '../../formats/big/bigFormat';
import { createDebouncer } from '../../core/debounce';
import { buildGameTree, getGameFiles, indexByName } from '../../game/install/gameView';
import {
  detectInstallKind,
  orderLayers,
  parseRegistryPath,
} from '../../game/install/installLayers';
import { scanInstall, scanInstalls } from '../../node/installScan';
import { compareWithBase, indexBaseGame } from '../../node/modDiff';
import { getDefaultPackageFolder, buildOverrideReport } from '../../node/modPackage';

/** Writes a tiny archive holding the given files, entry path to content */
const writeArchive = async (
  file: string,
  files: Record<string, string>,
): Promise<void> => {
  const entries = new Map<string, BigFileEntry>(
    Object.entries(files).map(([name, content]) => {
      const pendingData = Buffer.from(content);

      return [name, { name, offset: 0, size: pendingData.length, pendingData }];
    }),
  );

  await mkdir(path.dirname(file), { recursive: true });
  await writeArchiveFile(
    file,
    { magic: 'BIG4', trailer: new Uint8Array(8) },
    entries,
  );
};

const writeLoose = async (root: string, entryPath: string, content = '') => {
  const file = path.join(root, ...entryPath.split('/'));

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

/** The origin of the file the game loads at a path of a scanned set of installs */
const winnerOf = async (
  folders: string[],
  entryPath: string,
): Promise<string | undefined> => {
  const { files } = await scanInstalls(folders);
  const tree = buildGameTree(files);
  const node = getGameFiles(tree).find(
    (each) => each.path === entryPath.toLowerCase(),
  );

  return node?.winner?.origin;
};

suite('Load order', () => {
  let root: string;
  let counter = 0;

  const folder = async (name: string): Promise<string> => {
    counter += 1;

    const directory = path.join(root, `${name}-${counter}`);

    await mkdir(directory, { recursive: true });

    return directory;
  };

  setup(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'bigfs-order-'));
  });

  teardown(() => rm(root, { recursive: true, force: true }));

  test('___a.big beats b.big, whatever order the disk lists them in', async () => {
    const install = await folder('install');

    await writeArchive(path.join(install, 'b.big'), { 'data/x.ini': 'b' });
    await writeArchive(path.join(install, '___a.big'), { 'data/x.ini': 'a' });
    await writeArchive(path.join(install, 'INI.big'), { 'data/x.ini': 'ini' });

    assert.strictEqual(
      await winnerOf([install], 'data/x.ini'),
      `${path.basename(install)}: ___a.big`,
    );
  });

  test('a loose file beats every archive of its install', async () => {
    const install = await folder('install');

    await writeArchive(path.join(install, '___a.big'), {
      'art/textures/x.tga': 'archived',
    });
    await writeLoose(install, 'art/textures/x.tga', 'loose');

    assert.strictEqual(
      await winnerOf([install], 'art/textures/x.tga'),
      `${path.basename(install)} (loose)`,
    );
  });

  test('the layer order decides between installs, mod then ROTWK then BFME II', async () => {
    const mod = await folder('mod');
    const rotwk = await folder('rotwk');
    const bfme2 = await folder('bfme2');
    const same = 'art/textures/aptcomponents_001.tga';

    await writeArchive(path.join(bfme2, 'Textures.big'), {
      [same]: 'from bfme 2',
      'art/textures/only_bfme2.tga': 'x',
    });
    await writeArchive(path.join(rotwk, 'Textures.big'), { [same]: 'rotwk' });
    await writeArchive(path.join(mod, 'z.big'), { 'data/mod.ini': 'x' });

    const folders = [mod, rotwk, bfme2];
    const origin = (folder: string, rest: string) =>
      `${path.basename(folder)}: ${rest}`;

    assert.strictEqual(
      await winnerOf(folders, same),
      origin(rotwk, 'Textures.big'),
    );
    assert.strictEqual(
      await winnerOf([bfme2, rotwk], same),
      origin(bfme2, 'Textures.big'),
    );
    assert.strictEqual(
      await winnerOf(folders, 'art/textures/only_bfme2.tga'),
      origin(bfme2, 'Textures.big'),
    );
    assert.strictEqual(
      await winnerOf(folders, 'data/mod.ini'),
      origin(mod, 'z.big'),
    );
  });

  test('a mod of loose files alone appears, with no archive to name its folders', async () => {
    const mod = await folder('mod');

    await writeLoose(mod, 'Data/INI/Object/Mine.ini', 'Object Mine\nEnd');
    await writeLoose(mod, 'Maps/skirmish/m.map');
    await writeLoose(mod, '.git/config');
    await writeLoose(mod, 'readme.txt');

    const { loose, archives } = await scanInstall(mod);

    assert.deepStrictEqual(archives, []);
    assert.deepStrictEqual(loose.map((file) => file.entryPath).sort(), [
      'Data/INI/Object/Mine.ini',
      'Maps/skirmish/m.map',
    ]);
  });

  test('loose files are found under a folder only an archive names', async () => {
    const install = await folder('install');

    await writeArchive(path.join(install, 'a.big'), { 'extras/one.txt': '1' });
    await writeLoose(install, 'extras/two.txt', '2');

    const { loose } = await scanInstall(install);

    assert.deepStrictEqual(
      loose.map((file) => file.entryPath),
      ['extras/two.txt'],
    );
  });

  test('a name found in several folders resolves to the file ranked highest', async () => {
    const mod = await folder('mod');
    const install = await folder('install');

    await writeArchive(path.join(install, 'a.big'), {
      'art/textures/x.tga': 'archived',
      'art/w3d/x.tga': 'other folder',
    });
    await writeLoose(mod, 'data/x.tga', 'loose');

    const { files } = await scanInstalls([mod, install]);
    const byName = indexByName(buildGameTree(files));

    assert.strictEqual(byName.get('x.tga')?.path, 'data/x.tga');
  });

  test('the base game index follows the layers and takes loose files first', async () => {
    const rotwk = await folder('rotwk');
    const bfme2 = await folder('bfme2');

    await writeArchive(path.join(bfme2, 'a.big'), {
      'data/ini/GameData.ini': 'bfme2 archived',
      'data/ini/Only.ini': 'only',
    });
    await writeArchive(path.join(rotwk, 'a.big'), {
      'data/ini/GameData.ini': 'rotwk archived',
    });
    await writeLoose(rotwk, 'data/INI/GameData.ini', 'rotwk loose!');

    const { index } = await indexBaseGame([rotwk, bfme2]);
    const game = index.get('data/ini/gamedata.ini');

    assert.strictEqual(game?.loose, true);
    assert.ok(game?.archive.startsWith(rotwk));
    assert.ok(index.get('data/ini/only.ini')?.archive.startsWith(bfme2));

    const [result] = await compareWithBase(
      [
        {
          entryPath: 'data/ini/GameData.ini',
          size: 12,
          read: () => Promise.resolve(Buffer.from('rotwk loose!')),
        },
      ],
      index,
    );

    assert.strictEqual(result.change, 'same');
  });

  test('an archive bigFS packed is not part of the base game', async () => {
    const install = await folder('install');
    const packed = path.join(install, '!Mod.big');

    await writeArchive(path.join(install, 'a.big'), { 'data/a.ini': 'a' });
    await writeArchive(packed, { 'data/a.ini': 'mine', 'data/b.ini': 'b' });

    const withIt = await indexBaseGame(install);
    const without = await indexBaseGame(install, {
      exclude: new Set([packed.toLowerCase()]),
    });

    assert.ok(withIt.index.has('data/b.ini'));
    assert.ok(!without.index.has('data/b.ini'));
    assert.ok(without.index.get('data/a.ini')?.archive.endsWith('a.big'));
  });

  test('the package archive is offered beside the mod, never in the base game', () => {
    const home = path.join(path.sep, 'home');
    const base = path.join(path.sep, 'games', 'bfme');

    assert.strictEqual(
      getDefaultPackageFolder(path.join(path.sep, 'work', 'mod'), [base], home),
      path.join(path.sep, 'work'),
    );
    // The mod folder sits in the game folder: its sibling is the base game
    assert.strictEqual(
      getDefaultPackageFolder(path.join(base, 'mod'), [base], home),
      home,
    );
    assert.strictEqual(
      getDefaultPackageFolder(
        path.join(base, 'sub', 'mod'),
        [path.join(path.sep, 'x'), base],
        home,
      ),
      home,
    );
  });

  test('a base loose file or a ROTWK archive that sorts first keeps a file out of a game folder package', () => {
    const base = [
      {
        path: 'rotwk (loose files)',
        layer: 0,
        loose: true,
        entries: new Set(['data/a.ini']),
      },
      { path: 'INI.big', layer: 0, entries: new Set(['data/b.ini']) },
      {
        path: 'INI.big',
        layer: 1,
        entries: new Set(['data/c.ini', 'data/b.ini']),
      },
    ];
    const files = ['data/a.ini', 'data/b.ini', 'data/c.ini'];
    const inGameFolder = buildOverrideReport(files, '!Mod.big', base, 'gameFolder');

    // `!` sorts before INI.big, but nothing sorts before a loose file
    assert.deepStrictEqual(inGameFolder.ignored, [
      { path: 'data/a.ini', keptBy: 'rotwk (loose files)' },
    ]);
    // A file only the install beneath holds is the mod's to override
    assert.deepStrictEqual(inGameFolder.overrides, [
      { path: 'data/b.ini', over: ['INI.big', 'INI.big'] },
      { path: 'data/c.ini', over: ['INI.big'] },
    ]);
    assert.strictEqual(
      buildOverrideReport(files, 'zz.big', base, 'gameFolder').ignored.length,
      2,
    );
    assert.strictEqual(
      buildOverrideReport(files, 'zz.big', base, 'modFolder').ignored.length,
      0,
    );
  });
});

suite('Install layers', () => {
  test('marker files name the install, without casing', () => {
    assert.strictEqual(detectInstallKind(['LOTRBFME2EP1.EXE']), 'rotwk');
    assert.strictEqual(
      detectInstallKind(['lotrbfme2.exe', 'game.dat']),
      'bfme2',
    );
    assert.strictEqual(
      detectInstallKind(['lotrbfme2.exe', 'lotrbfme2ep1.exe']),
      'rotwk',
    );
    assert.strictEqual(detectInstallKind(['data']), 'mod');
  });

  test('layers order mod, ROTWK, BFME II, unnamed base, workspace order within a rank', () => {
    const layers = [
      { id: 'base', kind: 'mod' as const, base: true },
      { id: 'bfme2', kind: 'bfme2' as const, base: true },
      { id: 'mod2', kind: 'mod' as const, base: false },
      { id: 'rotwk', kind: 'rotwk' as const, base: false },
      { id: 'mod1', kind: 'mod' as const, base: false },
    ];

    assert.deepStrictEqual(
      orderLayers(layers).map((layer) => layer.id),
      ['mod2', 'mod1', 'rotwk', 'bfme2', 'base'],
    );
  });

  test('reads the Path value of a registry query, keeping spaces', () => {
    assert.strictEqual(
      parseRegistryPath(
        '\r\nHKEY\\Key\r\n    PathExtra    REG_SZ    X:\\no\r\n    Path    REG_SZ    X:\\Games\\Base Game 2\r\n',
      ),
      'X:\\Games\\Base Game 2',
    );
    assert.strictEqual(
      parseRegistryPath('    Path    REG_DWORD    0x1'),
      undefined,
    );
  });
});

suite('Debouncer', () => {
  test('a burst of calls runs once, after the last', async () => {
    let runs = 0;
    const debouncer = createDebouncer(() => (runs += 1), 20);

    debouncer.schedule();
    debouncer.schedule();
    debouncer.schedule();
    assert.strictEqual(runs, 0);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.strictEqual(runs, 1);
  });

  test('a cancelled run does not happen', async () => {
    let runs = 0;
    const debouncer = createDebouncer(() => (runs += 1), 10);

    debouncer.schedule();
    debouncer.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.strictEqual(runs, 0);
  });
});
