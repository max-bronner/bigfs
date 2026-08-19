import { commands, window } from 'vscode';
import type { ExtensionContext, TreeView } from 'vscode';
import { SCHEME } from '../constants';
import type { VirtualNode } from '../types';

export type NodeCommandRun = (targets: VirtualNode[]) => Promise<void>;

export type RegisterNodeCommand = (name: string, run: NodeCommandRun) => void;

/**
 * Creates the shared registration for tree node commands: it resolves the
 * nodes a command was invoked on and reports thrown errors to the user.
 */
export const createNodeCommandRegister = (
  context: ExtensionContext,
  treeView: TreeView<VirtualNode>,
): RegisterNodeCommand => {
  const getTargets = (
    target?: VirtualNode,
    selection?: VirtualNode[],
  ): VirtualNode[] => {
    if (selection?.length) {
      return selection;
    }

    return target ? [target] : [...treeView.selection];
  };

  return (name, run) => {
    const execute = async (
      target?: VirtualNode,
      selection?: VirtualNode[],
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
