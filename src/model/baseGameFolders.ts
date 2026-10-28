import { execFile } from 'child_process';
import { readdir } from 'fs/promises';
import { workspace } from 'vscode';
import {
  detectInstallKind,
  orderLayers,
  parseRegistryPath,
} from '../game/install/installLayers';
import type { InstallKind } from '../game/install/installLayers';

/**
 * The install folders the settings name as the game beneath the workspace:
 * `bigfs.baseGameFolder`, and below it the game it extends. ROTWK keeps only
 * what it adds, so a ROTWK folder alone leaves out the BFME II files most
 * of the game is made of; retail finds BFME II in the registry, and so does
 * this when the setting is empty (mint `games/rotwk/src/base_install.rs`).
 */

export const BASE_SETTING = 'bigfs.baseGameFolder';
export const UNDERLYING_SETTING = 'bigfs.underlyingGameFolder';

const BFME2_KEY =
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\lotrbfme2.exe';

const holds = async (folder: string, file: string): Promise<boolean> => {
  try {
    return (await readdir(folder)).some((name) => name.toLowerCase() === file);
  } catch {
    return false;
  }
};

const registryBfme2 = (): Promise<string | undefined> =>
  new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(undefined);
      return;
    }

    execFile(
      'reg',
      ['query', BFME2_KEY, '/v', 'Path', '/reg:32'],
      (error, stdout) => resolve(error ? undefined : parseRegistryPath(stdout)),
    );
  });

/** The base game folders, the highest layer first, those that exist */
export const findBaseGameFolders = async (): Promise<string[]> => {
  const configuration = workspace.getConfiguration();
  const base = configuration.get<string>(BASE_SETTING)?.trim();
  const named = configuration.get<string>(UNDERLYING_SETTING)?.trim();
  const folders: string[] = [];

  if (base) {
    folders.push(base);
  }

  if (named) {
    folders.push(named);
  } else if (
    base &&
    detectInstallKind(await readdir(base).catch(() => [])) === 'rotwk'
  ) {
    const found = await registryBfme2();

    if (found && (await holds(found, 'lotrbfme2.exe'))) {
      folders.push(found);
    }
  }

  const existing: string[] = [];

  for (const folder of folders) {
    if (
      !existing.some((held) => held.toLowerCase() === folder.toLowerCase()) &&
      (await readdir(folder).then(
        () => true,
        () => false,
      ))
    ) {
      existing.push(folder);
    }
  }

  // However the settings name them, the game takes ROTWK before BFME II
  const layers: { folder: string; kind: InstallKind; base: true }[] = [];

  for (const folder of existing) {
    layers.push({
      folder,
      kind: detectInstallKind(await readdir(folder).catch(() => [])),
      base: true,
    });
  }

  return orderLayers(layers).map(({ folder }) => folder);
};
