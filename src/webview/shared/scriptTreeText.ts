import type {
  MapScriptCall,
  MapScriptNode,
} from '../../formats/map/mapFile';

/** A script call with the indexes of the parameters that name a sound */
export interface SoundCall extends MapScriptCall {
  sounds?: number[];
}

/** A group or script of a map's script tree, as the host sends it */
export type ScriptTreeNode =
  | Extract<MapScriptNode, { kind: 'group' }>
  | (Omit<
      Extract<MapScriptNode, { kind: 'script' }>,
      'conditions' | 'actions' | 'actionsFalse'
    > & {
      conditions: SoundCall[][];
      actions: SoundCall[];
      actionsFalse: SoundCall[];
    });

/** One player's dictionary entry, of which the tree reads the name */
export interface SideEntry {
  key: string;
  value: { value: boolean | number | string };
}

/** Counts the scripts of a tree, groups not included */
export const countScripts = (nodes: readonly ScriptTreeNode[]): number =>
  nodes.reduce(
    (sum, node) =>
      sum + (node.kind === 'group' ? countScripts(node.children as ScriptTreeNode[]) : 1),
    0,
  );

/** Formats a script's label: its name and the ways it differs from the default */
export const describeScript = (
  node: Extract<ScriptTreeNode, { kind: 'script' }>,
): string =>
  node.name +
  (node.oneShot ? ' · once' : '') +
  (node.subroutine ? ' · subroutine' : '') +
  (node.difficulties.length < 3 ? ` · ${node.difficulties.join('/')}` : '');

/** Formats the summary of one player's list: the player's name, or its place when the player has none */
export const describePlayerList = (
  list: readonly ScriptTreeNode[],
  side: readonly SideEntry[] | undefined,
  slot: number,
  hasSides: boolean,
): string => {
  const owner = side?.find((entry) => entry.key === 'playerName');
  const name = owner?.value.value
    ? String(owner.value.value)
    : `${hasSides ? 'Player ' : 'Script list '}${slot + 1}`;

  return `${name} (${countScripts(list)})`;
};
