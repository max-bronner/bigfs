import { commands, window } from 'vscode';
import type { ExtensionContext, TreeView } from 'vscode';
import { SCHEME } from '../constants';
import { isVirtualNode } from '../providers/explorerNode';
import type { ExplorerNode } from '../providers/explorerNode';
import type { VirtualNode } from '../model/virtualNode';

export type NodeCommandRun = (targets: VirtualNode[]) => Promise<void>;

export type RegisterNodeCommand = (name: string, run: NodeCommandRun) => void;

/**
 * Creates the shared registration for tree node commands: it resolves the
 * nodes a command was invoked on and reports thrown errors to the user.
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
        return;
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
