import { Uri } from 'vscode';
import type { TreeItem } from 'vscode';
import { getNodeUri } from './nodeAddress';
import { isGameRow, isVirtualNode } from './explorerRow';
import type { ExplorerRow } from './explorerRow';

/** What a command can be given: a uri, or the row it was run from */
export type CommandTarget = Uri | TreeItem | ExplorerRow | undefined;

/**
 * Resolves the uri a command acts on. A menu or keybinding hands over the tree element,
 * not a uri: a `TreeItem` carries it as `resourceUri`, a `VirtualNode` is
 * addressed by its place in the archive, and a row of the game view stands
 * for the copy the game loads. Anything else has no uri
 */
export const toUri = (target: unknown): Uri | undefined => {
  if (!target || typeof target !== 'object') {
    return undefined;
  }
  if (target instanceof Uri) {
    return target;
  }

  const element = target as ExplorerRow;

  if (isVirtualNode(element)) {
    return getNodeUri(element);
  }
  if (isGameRow(element)) {
    const winner = element.node.winner?.ref;

    return winner?.kind === 'entry' ? getNodeUri(winner.node) : winner?.uri;
  }

  return (target as TreeItem).resourceUri;
};
