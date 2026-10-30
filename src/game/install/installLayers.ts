/**
 * Which game an install folder holds, and how installs sit on top of each
 * other. The engine mounts a folder's archives, then the folder of the game
 * it extends beneath them (mint's `games/rotwk/src/base_install.rs`: ROTWK
 * mounts BFME II beneath itself, and its own archives win where both name a
 * file). A mod is the highest layer, the base game folder setting the lowest.
 */

/** Which game an install folder holds; any folder no marker file names is a mod */
export type InstallKind = 'rotwk' | 'bfme2' | 'mod';

/**
 * The executable each retail install carries, which names it. ROTWK is
 * checked first: it is an expansion and may sit beside the base game's files.
 */
const INSTALL_MARKERS: readonly { kind: InstallKind; file: string }[] = [
  { kind: 'rotwk', file: 'lotrbfme2ep1.exe' },
  { kind: 'bfme2', file: 'lotrbfme2.exe' },
];

/** Whether a path is a folder or lies below it, without casing */
export const isInsideSource = (candidate: string, folder: string): boolean => {
  const normalise = (text: string) =>
    text.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const wanted = normalise(candidate);
  const base = normalise(folder);

  return wanted === base || wanted.startsWith(`${base}/`);
};

/** The traits of a layer that decide its priority */
export interface LayerTraits {
  kind: InstallKind;
  /** The folder of the `bigfs.baseGameFolder` setting, or one beneath it */
  base: boolean;
}

/** Detects which install a folder holds from the names of the files in it */
export const detectInstallKind = (fileNames: Iterable<string>): InstallKind => {
  const names = new Set(Array.from(fileNames, (name) => name.toLowerCase()));

  return INSTALL_MARKERS.find(({ file }) => names.has(file))?.kind ?? 'mod';
};

/**
 * Ranks a layer by priority, lower first: a mod, then ROTWK, then BFME II, then a base
 * folder no marker file names. Layers of one rank keep the order they come
 * in, which for workspace folders is their order in the workspace.
 */
export const getLayerRank = ({ kind, base }: LayerTraits): number => {
  if (kind === 'rotwk') {
    return 1;
  }
  if (kind === 'bfme2') {
    return 2;
  }
  return base ? 3 : 0;
};

/** Orders layers highest priority first; layers of one rank stay in order */
export const orderLayers = <T extends LayerTraits>(layers: readonly T[]): T[] =>
  layers
    .map((layer, position) => ({ layer, position }))
    .sort(
      (a, b) =>
        getLayerRank(a.layer) - getLayerRank(b.layer) || a.position - b.position,
    )
    .map(({ layer }) => layer);

/** Parses the value `reg query` prints for `Path`, from a line `Path REG_SZ <value>` */
export const parseRegistryPath = (stdout: string): string | undefined => {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);

    if (match) {
      return match[1];
    }
  }

  return undefined;
};
