import type { TreeView } from 'vscode';
import type { ExplorerRow } from './explorerRow';

/**
 * Rows selected in the archive explorer, readable by the node commands of any
 * feature. Features register before the explorer creates its tree view, so
 * the view is attached later and the selection is read when a command runs.
 */
export interface ExplorerSelection {
  /** Rows selected now; empty until the explorer attaches its tree view */
  readonly rows: readonly ExplorerRow[];
  /** Hands over the tree view the selection is read from */
  attach(treeView: TreeView<ExplorerRow>): void;
}

/** Creates the explorer selection the services hold for the session */
export const createExplorerSelection = (): ExplorerSelection => {
  let treeView: TreeView<ExplorerRow> | undefined;

  return {
    get rows() {
      return treeView?.selection ?? [];
    },
    attach: (view) => {
      treeView = view;
    },
  };
};
