import { execFile } from 'child_process';
import { readdir } from 'fs/promises';
import {
  detectInstallKind,
  orderLayers,
  parseRegistryPath,
} from '../../game/install/installLayers';
import type { InstallKind } from '../../game/install/installLayers';
import { settings } from '../../platform/settings';

/**
 * The install folders the settings name as the game beneath the workspace:
 * `bigfs.baseGameFolder`, and below it the game it extends. ROTWK keeps only
 * what it adds, so a ROTWK folder alone leaves out the BFME II files most
 * of the game is made of; retail finds BFME II in the registry, and so does
 * this when the setting is empty (mint `games/rotwk/src/base_install.rs`).
 */

const BFME2_KEY =
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\lotrbfme2.exe';

const holds = async (folder: string, file: string): Promise<boolean> => {
  try {
    return (await readdir(folder)).some((name) => name.toLowerCase() === file);
  } catch {
    return false;
  }
};

/** Reads where retail recorded BFME II in the registry; nothing off Windows */
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

/** Finds the base game folders that exist, the highest layer first */
export const findBaseGameFolders = async (): Promise<string[]> => {
  const base = settings.baseGameFolder.get().trim();
  const named = settings.underlyingGameFolder.get().trim();
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
