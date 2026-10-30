import type { ExtensionContext } from 'vscode';
import { registerCommand } from '../../platform/commands';
import { isGameRow, isVirtualNode } from './explorerRow';
import { toEntryDirectory } from './gameViewModel';
import type { ExplorerNode } from './explorerRow';
import type { ExplorerSelection } from './explorerSelection';
import type { VirtualNode } from './virtualNode';

/**
 * Body of a tree node command, handed the nodes it was invoked on. Never run
 * with an empty array, so a command may take `targets[0]`.
 */
export type NodeCommandRun = (targets: VirtualNode[]) => Promise<void>;

/** Callback a command module is handed to register one command by its full `bigfs.x` id */
export type RegisterNodeCommand = (id: string, run: NodeCommandRun) => void;

/**
 * Commands a game view folder can be handed to: they read the files below it.
 * Any command that changes an archive needs a folder of one archive.
 */
const GAME_FOLDER_COMMANDS = new Set([
  'bigfs.extract',
  'bigfs.overrideInFolder',
]);

/**
 * Creates the register callback the command modules are handed: it resolves
 * the nodes a command was invoked on and disposes each command with the
 * extension.
 */
export const createNodeCommandRegistrar = (
  context: ExtensionContext,
  explorerSelection: ExplorerSelection,
): RegisterNodeCommand => {
  const getTargets = (
    id: string,
    target?: ExplorerNode,
    selection?: ExplorerNode[],
  ): VirtualNode[] => {
    const rows = selection?.length
      ? selection
      : target
        ? [target]
        : [...explorerSelection.rows];

    // A source or a folder on disk holds no entries, so a command that acts
    // on archive content has nothing to do with it. A game view file stands
    // for the entry the game loads; a game view folder spans archives, so
    // only the commands that just read its files take it
    return rows.flatMap((row): VirtualNode[] => {
      if (isVirtualNode(row)) {
        return [row];
      }

      if (!isGameRow(row)) {
        return [];
      }

      if (!row.node.children) {
        const ref = row.node.winner?.ref;

        return ref?.kind === 'entry' ? [ref.node] : [];
      }

      const directory = GAME_FOLDER_COMMANDS.has(id)
        ? toEntryDirectory(row.node)
        : undefined;

      return directory ? [directory] : [];
    });
  };

  return (id, run) => {
    const execute = async (
      target?: ExplorerNode,
      selection?: ExplorerNode[],
    ): Promise<void> => {
      const targets = getTargets(id, target, selection);

      if (!targets.length) {
        return; // nothing of ours in the selection, so there is nothing to act on
      }

      await run(targets);
    };

    context.subscriptions.push(registerCommand(id, execute));
  };
};
