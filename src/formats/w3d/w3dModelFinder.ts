import type { ToolBox } from '../tools/toolRegistry';
import { parseW3dTool } from '../tools/w3dTools';
import type { LoadFile } from './w3dScene';

/**
 * The model an animation plays on, found from its skeleton: an animation
 * file holds bones and their motion but no mesh, so to show it on the unit
 * the model drawn on the same skeleton is looked for. BFME names a unit's
 * files after it (`GUArcher_SKL` the skeleton, `GUArcher_SKN` the skinned
 * model, `GUArcher_ATKA` an animation), so the names sharing the skeleton's
 * stem are tried, the skinned one first, and the first whose HLOD names
 * that skeleton is the one.
 */

/** Files tried at most, so a stem shared by many animations stays quick */
const MAX_TRIED = 24;

/** File names that could hold the model drawn on a skeleton, likeliest first */
export const modelCandidates = (
  skeleton: string,
  names: readonly string[],
): string[] => {
  const stem = skeleton.toLowerCase().replace(/_skl$/, '');
  const own = `${skeleton.toLowerCase()}.w3d`;
  const rank = (name: string) =>
    name === `${stem}_skn.w3d`
      ? 0
      : name === `${stem}.w3d`
        ? 1
        : /_skn\.w3d$/.test(name)
          ? 2
          : 3;

  return names
    .map((name) => name.toLowerCase())
    .filter(
      (name) =>
        name !== own &&
        name.endsWith('.w3d') &&
        (name === `${stem}.w3d` || name.startsWith(`${stem}_`)),
    )
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
};

/** The first candidate whose HLOD is drawn on `skeleton`, if any */
export const findModelForSkeleton = async (
  skeleton: string,
  names: readonly string[],
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<string | undefined> => {
  const parse = tools.use(parseW3dTool);

  for (const name of modelCandidates(skeleton, names).slice(0, MAX_TRIED)) {
    const bytes = await loadFile(name);

    if (!bytes) {
      continue;
    }
    try {
      const file = await parse(bytes);

      if (
        file.meshes.length &&
        file.hlod?.hierarchyName.toLowerCase() === skeleton.toLowerCase()
      ) {
        return name;
      }
    } catch {
      // Not a model this can read; the next may be
    }
  }
  return undefined;
};
