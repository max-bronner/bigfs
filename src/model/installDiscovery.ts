import { execFile } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import * as path from 'path';

/**
 * Finds the game installs of a machine without the user naming a folder: the
 * install paths EA's installers wrote to the registry, the usual places the
 * games and the EA and Origin launchers put them, and the same inside Wine,
 * Proton and CrossOver prefixes. Only ever reads, and a lookup that fails
 * finds nothing rather than raising.
 */

/** The games that can be offered, by the executable that tells them apart */
export type GameId = 'bfme' | 'bfme2' | 'rotwk';

export interface GameInfo {
  id: GameId;
  title: string;
  executable: string;
  /** The registry keys the retail installer wrote, below `HKLM\SOFTWARE` */
  registryKeys: readonly string[];
  /** Folder names the install is usually found under */
  folders: readonly string[];
}

/** ROTWK comes first: it is an expansion and may sit beside the base game's files */
export const GAMES: readonly GameInfo[] = [
  {
    id: 'rotwk',
    title: 'The Lord of the Rings: The Rise of the Witch-king',
    executable: 'lotrbfme2ep1.exe',
    registryKeys: [
      'Electronic Arts\\Electronic Arts\\The Lord of the Rings, The Rise of the Witch-king',
    ],
    folders: [
      'The Lord of the Rings, The Rise of the Witch-king',
      'The Lord of the Rings - The Rise of the Witch-king',
      'The Lord of the Rings, The Rise of the Witch-king(tm)',
    ],
  },
  {
    id: 'bfme2',
    title: 'The Lord of the Rings: The Battle for Middle-earth II',
    executable: 'lotrbfme2.exe',
    registryKeys: [
      'Electronic Arts\\Electronic Arts\\The Battle for Middle-earth II',
    ],
    folders: [
      'The Battle for Middle-earth II',
      'The Lord of the Rings, The Battle for Middle-earth II',
      'The Lord of the Rings - The Battle for Middle-earth II',
      'The Battle for Middle-earth(tm) II',
    ],
  },
  {
    id: 'bfme',
    title: 'The Lord of the Rings: The Battle for Middle-earth',
    executable: 'lotrbfme.exe',
    registryKeys: ['Electronic Arts\\EA Games\\The Battle for Middle-earth'],
    folders: [
      'The Battle for Middle-earth',
      'The Lord of the Rings, The Battle for Middle-earth',
      'The Lord of the Rings - The Battle for Middle-earth',
      'The Battle for Middle-earth(tm)',
    ],
  },
];

/** A game found on disk */
export interface FoundInstall {
  game: GameInfo;
  folder: string;
}

/** The values the installers wrote the folder to */
const INSTALL_VALUES = ['InstallPath', 'Install Dir'];

/** Whether a path names the same folder as another, without casing or a trailing separator */
const sameFolder = (a: string, b: string): boolean => {
  const normalise = (text: string) =>
    text.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  return normalise(a) === normalise(b);
};

/** Drops a trailing separator, which `Install Dir` carries and nothing wants */
const trimSeparator = (folder: string): string =>
  folder.length > 3 ? folder.replace(/[\\/]+$/, '') : folder;

/**
 * Reads the folders out of `reg query <key>` output: lines of the form
 * `    InstallPath    REG_SZ    C:\Games\...`
 */
export const parseRegistryInstallPaths = (stdout: string): string[] => {
  const found: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s+(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);

    if (match && INSTALL_VALUES.includes(match[1])) {
      found.push(trimSeparator(match[2]));
    }
  }

  return found;
};

/**
 * Reads the folders out of the text of a Wine `system.reg`, where each key is
 * a `[Software\\...]` header followed by `"Name"="value"` lines with
 * backslashes doubled. The keys are matched in both the native and the
 * `Wow6432Node` position.
 */
export const parseWineRegistry = (text: string, game: GameInfo): string[] => {
  const doubled = (value: string) => value.replace(/\\/g, '\\\\');
  const wanted = game.registryKeys.flatMap((key) => [
    doubled(`software\\${key}`).toLowerCase(),
    doubled(`software\\wow6432node\\${key}`).toLowerCase(),
  ]);
  const found: string[] = [];
  let inKey = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('[')) {
      inKey = wanted.includes(line.slice(1, line.indexOf(']')).toLowerCase());
      continue;
    }

    const match = /^"([^"]+)"="((?:[^"\\]|\\.)*)"/.exec(line);

    if (inKey && match && INSTALL_VALUES.includes(match[1])) {
      found.push(trimSeparator(match[2].replace(/\\\\/g, '\\')));
    }
  }

  return found;
};

/** Where Windows programs live in a prefix, below `drive_c` */
const PROGRAM_ROOTS = [
  'Program Files',
  'Program Files (x86)',
  'Program Files/EA Games',
  'Program Files (x86)/EA Games',
  'Program Files/Electronic Arts',
  'Program Files (x86)/Electronic Arts',
  'Program Files/Origin Games',
  'Program Files (x86)/Origin Games',
  'Program Files/Steam/steamapps/common',
  'Program Files (x86)/Steam/steamapps/common',
  'Origin Games',
  'EA Games',
  'Games',
];

/** Joins every root with every folder name a game goes by */
const underRoots = (
  roots: readonly string[],
  join: (...parts: string[]) => string,
): string[] =>
  roots.flatMap((root) =>
    GAMES.flatMap((game) => game.folders.map((name) => join(root, name))),
  );

/** The machine the paths are built for */
export interface Machine {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

/** Wine prefixes by kind: plain, a Steam Proton prefix, CrossOver, Lutris and Bottles */
export const winePrefixRoots = (machine: Machine): string[] => {
  const { home, platform } = machine;

  if (platform === 'win32') {
    return [];
  }

  const roots = [
    path.join(home, '.wine'),
    path.join(home, '.local/share/wineprefixes'),
    path.join(home, 'Games'),
    path.join(home, '.var/app/com.usebottles.bottles/data/bottles/bottles'),
    path.join(home, '.local/share/bottles/bottles'),
  ];

  if (platform === 'darwin') {
    roots.push(
      path.join(home, 'Library/Application Support/CrossOver/Bottles'),
    );
  } else {
    roots.push(
      path.join(home, '.steam/steam/steamapps/compatdata'),
      path.join(home, '.local/share/Steam/steamapps/compatdata'),
      path.join(
        home,
        '.var/app/com.valvesoftware.Steam/data/Steam/steamapps/compatdata',
      ),
    );
  }

  return roots;
};

/** Where `drive_c` can sit below a prefix root: the root itself, or a folder it holds */
export const driveCOfPrefix = (
  prefix: string,
  children: string[],
): string[] => [
  path.join(prefix, 'drive_c'),
  path.join(prefix, 'pfx', 'drive_c'),
  ...children.flatMap((child) => [
    path.join(prefix, child, 'drive_c'),
    path.join(prefix, child, 'pfx', 'drive_c'),
  ]),
];

/** The usual install folders of a Windows machine, from its environment */
export const windowsCandidates = (machine: Machine): string[] => {
  const { env } = machine;
  const programs = [
    env['ProgramFiles'],
    env['ProgramFiles(x86)'],
    env['ProgramW6432'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter((root): root is string => Boolean(root));
  const drives = ['C:', 'D:', 'E:', 'F:'];
  const roots = [
    ...programs.flatMap((root) => [
      root,
      path.win32.join(root, 'EA Games'),
      path.win32.join(root, 'Electronic Arts'),
      path.win32.join(root, 'Origin Games'),
      path.win32.join(root, 'Steam', 'steamapps', 'common'),
    ]),
    ...drives.flatMap((drive) => [
      `${drive}\\Origin Games`,
      `${drive}\\EA Games`,
      `${drive}\\Games`,
      `${drive}\\Program Files\\EA Games`,
    ]),
  ];

  return unique(underRoots(roots, path.win32.join));
};

/** The usual install folders inside one Wine drive C */
export const wineCandidates = (driveC: string): string[] =>
  underRoots(
    PROGRAM_ROOTS.map((root) => path.join(driveC, root)),
    path.join,
  );

const unique = (folders: string[]): string[] => {
  const seen: string[] = [];

  for (const folder of folders) {
    if (!seen.some((held) => sameFolder(held, folder))) {
      seen.push(folder);
    }
  }

  return seen;
};

/** What discovery reads from the machine, replaceable so a test runs on synthetic data */
export interface DiscoveryHost {
  machine: Machine;
  /** Entry names of a folder, empty when it cannot be read */
  list(folder: string): Promise<string[]>;
  /** Text of a file, undefined when it cannot be read */
  read(file: string): Promise<string | undefined>;
  /** Output of `reg query <key> /reg:<32|64>`, undefined when it fails */
  query(key: string, view: '32' | '64'): Promise<string | undefined>;
}

/** The host of the running machine: the real file system and `reg query` */
export const systemHost = (machine: Machine): DiscoveryHost => ({
  machine,
  list: (folder) => readdir(folder).catch(() => []),
  read: (file) => readFile(file, 'latin1').catch(() => undefined),
  query: (key, view) =>
    new Promise((resolve) => {
      if (machine.platform !== 'win32') {
        resolve(undefined);
        return;
      }

      try {
        execFile(
          'reg',
          ['query', `HKLM\\SOFTWARE\\${key}`, `/reg:${view}`],
          { timeout: 5000, windowsHide: true },
          (error, stdout) => resolve(error ? undefined : stdout),
        );
      } catch {
        resolve(undefined);
      }
    }),
});

/** The game a folder holds, from the executable in it, or undefined for a folder that holds none */
export const identifyInstall = async (
  host: DiscoveryHost,
  folder: string,
): Promise<GameInfo | undefined> => {
  const names = new Set(
    (await host.list(folder)).map((name) => name.toLowerCase()),
  );

  return GAMES.find((game) => names.has(game.executable));
};

/**
 * Finds the installs on the machine, ROTWK first, then BFME II, then BFME,
 * each folder once. A folder is only reported when it holds the game's
 * executable, so a stale registry entry or a guess that missed finds nothing.
 */
export const findInstalls = async (
  host: DiscoveryHost,
): Promise<FoundInstall[]> => {
  const candidates: string[] = [];
  const { machine } = host;

  if (machine.platform === 'win32') {
    for (const game of GAMES) {
      for (const key of game.registryKeys) {
        for (const view of ['32', '64'] as const) {
          const output = await host.query(key, view);

          if (output) {
            candidates.push(...parseRegistryInstallPaths(output));
          }
        }
      }
    }

    candidates.push(...windowsCandidates(machine));
  } else {
    for (const prefix of winePrefixRoots(machine)) {
      const children = await host.list(prefix);

      for (const driveC of driveCOfPrefix(prefix, children)) {
        if (!(await host.list(driveC)).length) {
          continue;
        }

        const registry = await host.read(
          path.join(path.dirname(driveC), 'system.reg'),
        );

        for (const game of GAMES) {
          for (const windowsPath of registry
            ? parseWineRegistry(registry, game)
            : []) {
            const match = /^([a-z]):\\(.*)$/i.exec(windowsPath);

            if (match && match[1].toLowerCase() === 'c') {
              candidates.push(path.join(driveC, ...match[2].split('\\')));
            }
          }
        }

        candidates.push(...wineCandidates(driveC));
      }
    }
  }

  const found: FoundInstall[] = [];

  for (const folder of unique(candidates)) {
    const game = await identifyInstall(host, folder);

    if (game) {
      found.push({ game, folder });
    }
  }

  const rank = (install: FoundInstall) => GAMES.indexOf(install.game);

  return found
    .map((install, position) => ({ install, position }))
    .sort(
      (a, b) => rank(a.install) - rank(b.install) || a.position - b.position,
    )
    .map(({ install }) => install);
};
