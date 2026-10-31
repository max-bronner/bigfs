import type { ToolBox } from '../../core/toolRegistry';
import { readAnimationHierarchyName } from './w3dAnimation';
import { isOwnClip } from './w3dPose';
import type { SkeletonBones } from './w3dPose';
import { buildW3dScene, loadSkeleton } from './w3dScene';
import type { LoadFile, ModelScene, SceneSkeleton } from './w3dScene';
import { parseW3dTool } from './w3dTools';

/**
 * The model an animation plays on, found from its skeleton: an animation
 * file holds bones and their motion but no mesh, so to show it on the unit
 * the model drawn on the same skeleton is looked for. BFME names a unit's
 * files after it (`GUArcher_SKL` the skeleton, `GUArcher_SKN` the skinned
 * model, `GUArcher_ATKA` an animation), so the names sharing the skeleton's
 * stem are tried, the skinned one first, and the first whose HLOD names
 * that skeleton is the one. The same names can belong to another rig, so the
 * clips listed for a skeleton are grouped by the skeleton they name.
 */

/** Files tried at most, so a stem shared by many animations stays quick */
const MAX_TRIED = 24;

/** Lists the file names that could hold the model drawn on a skeleton, likeliest first */
export const listModelCandidates = (
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

/** A file named after a skeleton that animates another one */
export interface ForeignClip {
  file: string;
  /** The skeleton it was made for */
  hierarchyName: string;
}

/** The files a preview offers for a skeleton: its own clips, then those of other rigs */
export interface SkeletonClips {
  own: string[];
  foreign: ForeignClip[];
}

/**
 * Sorts files by whether their animation was made for a skeleton, reading each
 * one in turn. A file that holds no animation, like the skinned model beside
 * the clips, or does not parse, is neither.
 */
export const sortClipsBySkeleton = async (
  skeleton: SceneSkeleton,
  names: readonly string[],
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<SkeletonClips> => {
  const clipSkeletons = new Map<string, SkeletonBones | undefined>();
  const clips: SkeletonClips = { own: [], foreign: [] };

  for (const file of names) {
    const bytes = await loadFile(file);
    let hierarchyName: string | undefined;

    try {
      hierarchyName = bytes && readAnimationHierarchyName(bytes);
    } catch {
      continue;
    }
    if (hierarchyName === undefined) {
      continue;
    }

    const key = hierarchyName.toLowerCase();

    if (key !== skeleton.name.toLowerCase() && !clipSkeletons.has(key)) {
      clipSkeletons.set(
        key,
        await loadSkeleton(hierarchyName, loadFile, tools),
      );
    }

    if (isOwnClip(skeleton, { hierarchyName }, clipSkeletons.get(key))) {
      clips.own.push(file);
    } else {
      clips.foreign.push({ file, hierarchyName });
    }
  }

  return clips;
};

/** The model chosen to show an animation file on */
export interface AnimationCarrier {
  /** File name of the model, when one was found */
  name?: string;
  scene?: ModelScene;
}

/**
 * Chooses the model to show an animation file on: the one an object's INI plays
 * it on, whatever its skeleton, as the game does, else the model of the
 * animation's own skeleton.
 * @param skeletonName The skeleton the animation names
 * @param iniModel File name of the model the INI names, when it names one
 * @param listNames Lists every W3D file name, asked only when the INI's model does not do
 */
export const findAnimationCarrier = async (
  skeletonName: string,
  iniModel: string | undefined,
  listNames: () => Promise<readonly string[]>,
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<AnimationCarrier> => {
  const iniBytes = iniModel ? await loadFile(iniModel) : undefined;
  const iniScene =
    iniBytes && (await buildW3dScene(iniBytes, loadFile, tools));

  if (iniScene?.skeleton) {
    return { name: iniModel, scene: iniScene };
  }

  const name = await findModelForSkeleton(
    skeletonName,
    await listNames(),
    loadFile,
    tools,
  );
  const bytes = name ? await loadFile(name) : undefined;

  return {
    name,
    scene: bytes && (await buildW3dScene(bytes, loadFile, tools)),
  };
};

/** Finds the first candidate whose HLOD is drawn on `skeleton`, trying at most `MAX_TRIED` files */
export const findModelForSkeleton = async (
  skeleton: string,
  names: readonly string[],
  loadFile: LoadFile,
  tools: ToolBox,
): Promise<string | undefined> => {
  const parse = tools.use(parseW3dTool);

  for (const name of listModelCandidates(skeleton, names).slice(0, MAX_TRIED)) {
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
