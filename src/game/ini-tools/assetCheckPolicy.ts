/**
 * Whether the missing-asset check runs. A name no archive or folder holds is
 * a mistake only when the base game's files are in reach to hold the names a
 * mod leaves to it; without them every texture and model the mod borrows
 * would be flagged. So `auto` needs a configured base game folder, and the
 * files actually loaded to show it was found; `on` and `off` are the user's
 * word.
 */

/** Fewest loaded `.w3d` files that show `auto` found the base game, which alone ships many more */
export const AUTO_MINIMUM_MODELS = 200;

/** The missing-asset check setting: decided from the files loaded, or forced on or off */
export type AssetCheckMode = 'auto' | 'on' | 'off';

/** Outcome of `decideAssetCheck`: run the check, skip it, or skip it for want of a base game */
export type AssetCheckDecision = 'check' | 'off' | 'no-base-game';

/** Decides whether the missing-asset check runs, from the setting and what is loaded */
export const decideAssetCheck = (
  mode: AssetCheckMode,
  hasBaseGameFolder: boolean,
  modelCount: number,
): AssetCheckDecision => {
  if (mode !== 'auto') {
    return mode === 'on' ? 'check' : 'off';
  }
  if (!hasBaseGameFolder) {
    return 'no-base-game';
  }
  return modelCount >= AUTO_MINIMUM_MODELS ? 'check' : 'off';
};
