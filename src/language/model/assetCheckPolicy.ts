/**
 * Whether the missing-asset check runs. A name no archive or folder holds is
 * a mistake only when the base game's files are in reach to hold the names a
 * mod leaves to it; without them every texture and model the mod borrows
 * would be flagged. So `auto` needs a configured base game folder, and the
 * files actually loaded to show it was found; `on` and `off` are the user's
 * word.
 */

/** `.w3d` files the base game alone ships many more of */
export const AUTO_MINIMUM_MODELS = 200;

export type AssetCheckMode = 'auto' | 'on' | 'off';

export type AssetCheckDecision = 'check' | 'off' | 'no-base-game';

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
