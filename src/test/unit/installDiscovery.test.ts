import * as assert from 'assert';
import {
  GAMES,
  findInstalls,
  parseRegistryInstallPaths,
  parseWineRegistry,
  windowsCandidates,
  winePrefixRoots,
} from '../../node/installDiscovery';
import type { DiscoveryHost, Machine } from '../../node/installDiscovery';

const game = (id: string) => GAMES.find((each) => each.id === id)!;

const makeHost = (
  machine: Machine,
  folders: Record<string, string[]>,
  files: Record<string, string> = {},
  registry: Record<string, string> = {},
): DiscoveryHost => ({
  machine,
  list: async (folder) => folders[folder] ?? [],
  read: async (file) => files[file],
  query: async (key, view) => registry[`${key}|${view}`],
});

suite('install discovery', () => {
  test('reads InstallPath and Install Dir out of reg query output', () => {
    const output = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Electronic Arts\\Electronic Arts\\The Battle for Middle-earth II',
      '    Language    REG_SZ    English',
      '    InstallPath    REG_SZ    C:\\Games\\BFME II',
      '    Install Dir    REG_SZ    D:\\Games\\BFME II\\',
      '    ERTokenID    REG_DWORD    0x1',
      '',
    ].join('\r\n');

    assert.deepStrictEqual(parseRegistryInstallPaths(output), [
      'C:\\Games\\BFME II',
      'D:\\Games\\BFME II',
    ]);
    assert.deepStrictEqual(parseRegistryInstallPaths('ERROR: not found'), []);
  });

  test('reads the install folder out of a Wine system.reg', () => {
    const text = [
      '[Software\\\\Wow6432Node\\\\Electronic Arts\\\\Electronic Arts\\\\The Battle for Middle-earth II] 1700000000',
      '"InstallPath"="C:\\\\Program Files (x86)\\\\EA Games\\\\BFME II"',
      '"Language"="English"',
      '',
      '[Software\\\\Other] 1700000000',
      '"InstallPath"="C:\\\\Elsewhere"',
    ].join('\n');

    assert.deepStrictEqual(parseWineRegistry(text, game('bfme2')), [
      'C:\\Program Files (x86)\\EA Games\\BFME II',
    ]);
    assert.deepStrictEqual(parseWineRegistry(text, game('rotwk')), []);
  });

  test('builds Windows candidates from the environment, each once', () => {
    const candidates = windowsCandidates({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      home: 'C:\\Users\\a',
    });

    assert.ok(
      candidates.includes(
        'C:\\Program Files\\EA Games\\The Battle for Middle-earth II',
      ),
    );
    assert.strictEqual(new Set(candidates).size, candidates.length);
  });

  test('names Wine, Proton and CrossOver prefixes by platform', () => {
    const linux = winePrefixRoots({ platform: 'linux', env: {}, home: '/h' });
    const mac = winePrefixRoots({ platform: 'darwin', env: {}, home: '/h' });

    assert.ok(linux.some((root) => root.endsWith('compatdata')));
    assert.ok(mac.some((root) => root.includes('CrossOver')));
    assert.deepStrictEqual(
      winePrefixRoots({ platform: 'win32', env: {}, home: 'C:\\' }),
      [],
    );
  });

  test('finds a registry install on Windows, and drops a stale entry', async () => {
    const machine: Machine = { platform: 'win32', env: {}, home: 'C:\\u' };
    const key = game('rotwk').registryKeys[0];
    const host = makeHost(
      machine,
      {
        'D:\\Games\\ROTWK': ['lotrbfme2ep1.exe', 'Data'],
        'D:\\Gone': [],
      },
      {},
      {
        [`${key}|32`]: '    InstallPath    REG_SZ    D:\\Games\\ROTWK\r\n',
        [`${key}|64`]: '    InstallPath    REG_SZ    D:\\Gone\r\n',
      },
    );

    const found = await findInstalls(host);

    assert.deepStrictEqual(
      found.map(({ game: each, folder }) => [each.id, folder]),
      [['rotwk', 'D:\\Games\\ROTWK']],
    );
  });

  test('finds installs in a Wine prefix by its registry and by common paths, ROTWK first', async () => {
    const machine: Machine = { platform: 'linux', env: {}, home: '/h' };
    const driveC = '/h/.wine/drive_c';
    const bfme2 = `${driveC}/Program Files (x86)/EA Games/BFME II`;
    const rotwk = `${driveC}/Program Files/EA Games/The Lord of the Rings, The Rise of the Witch-king`;
    const host = makeHost(
      machine,
      {
        [driveC]: ['Program Files'],
        [bfme2]: ['lotrbfme2.exe'],
        [rotwk]: ['LOTRBFME2EP1.EXE'],
      },
      {
        '/h/.wine/system.reg':
          '[Software\\\\Wow6432Node\\\\Electronic Arts\\\\Electronic Arts\\\\The Battle for Middle-earth II] 1\n' +
          '"InstallPath"="C:\\\\Program Files (x86)\\\\EA Games\\\\BFME II"\n',
      },
    );

    const found = await findInstalls(host);

    assert.deepStrictEqual(
      found.map(({ game: each, folder }) => [each.id, folder]),
      [
        ['rotwk', rotwk],
        ['bfme2', bfme2],
      ],
    );
  });

  test('finds nothing, without raising, when nothing is installed', async () => {
    const machine: Machine = { platform: 'linux', env: {}, home: '/h' };

    assert.deepStrictEqual(await findInstalls(makeHost(machine, {})), []);
  });
});
