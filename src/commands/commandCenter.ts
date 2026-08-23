import { commands, window } from 'vscode';
import type { ExtensionContext, TreeView } from 'vscode';
import { SCHEME } from '../constants';
import { isVirtualNode } from '../providers/explorerNode';
import type { ExplorerNode } from '../providers/explorerNode';
import type { VirtualNode } from '../model/virtualNode';

/**
 * Body of a tree node command, handed the nodes it was invoked on. Never run
 * with an empty array, so a command may take `targets[0]`.
 */
export type NodeCommandRun = (targets: VirtualNode[]) => Promise<void>;

/**
 * Callback a command module is handed to register one command; `name` is the
 * id without the `bigfs.` prefix
 */
export type RegisterNodeCommand = (name: string, run: NodeCommandRun) => void;

/**
 * Creates the register callback the command modules are handed: it resolves
 * the nodes a command was invoked on, reports a thrown error to the user, and
 * disposes each command with the extension.
 */
export const createNodeCommandRegister = (
  context: ExtensionContext,
  treeView: TreeView<ExplorerNode>,
): RegisterNodeCommand => {
  const getTargets = (
    target?: ExplorerNode,
    selection?: ExplorerNode[],
  ): VirtualNode[] => {
    const rows = selection?.length
      ? selection
      : target
        ? [target]
        : [...treeView.selection];

    // A source or a folder on disk holds no entries, so a command that acts
    // on archive content has nothing to do with it
    return rows.filter(isVirtualNode);
  };

  return (name, run) => {
    const execute = async (
      target?: ExplorerNode,
      selection?: ExplorerNode[],
    ): Promise<void> => {
      const targets = getTargets(target, selection);

      if (!targets.length) {
        return; // nothing of ours in the selection, so there is nothing to act on
      }

      try {
        await run(targets);
      } catch (error) {
        window.showErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    context.subscriptions.push(
      commands.registerCommand(`${SCHEME}.${name}`, execute),
    );
  };
};
