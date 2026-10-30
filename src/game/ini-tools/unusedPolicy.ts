/**
 * Definition keywords, lowercased, that "Find Unused Definitions" may report. Only a kind that
 * nothing outside the INI files looks up by name can be called unused from
 * the INI alone: maps and their scripts name objects, upgrades, sciences,
 * special powers, sounds, movies and command sets; the engine looks up
 * player templates, mouse cursors, weather, levels of detail, experience
 * levels, the default command sets, announcer events and GameData. So the
 * kinds listed here are the allow list, and everything else is left alone.
 */
export const REPORTABLE_KINDS: ReadonlySet<string> = new Set(
  [
    'Armor',
    'CommandButton',
    'DamageFX',
    'FXList',
    'FXParticleSystem',
    'ParticleSystem',
    'Locomotor',
    'ModifierList',
    'ObjectCreationList',
    'Weapon',
  ].map((kind) => kind.toLowerCase()),
);

/** Whether "Find Unused Definitions" may report a definition with this keyword */
export const isReportableKind = (keyword: string): boolean =>
  REPORTABLE_KINDS.has(keyword.toLowerCase());

const normal = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const within = (path: string, folder: string): boolean => {
  const inner = normal(path);
  const outer = normal(folder);

  return outer !== '' && (inner === outer || inner.startsWith(`${outer}/`));
};

/**
 * Whether a file is the mod's own: inside a workspace folder and not inside
 * a base game install, which a workspace may hold beside, or be, the mod
 */
export const isModFile = (
  path: string,
  workspaceFolders: readonly string[],
  baseGameFolders: readonly string[],
): boolean =>
  workspaceFolders.some((folder) => within(path, folder)) &&
  !baseGameFolders.some((folder) => within(path, folder));
