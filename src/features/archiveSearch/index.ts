import { window } from 'vscode';
import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerCommand } from '../../platform/commands';
import { createSearchView } from './createSearchView';

/**
 * Registers the search view that looks for text in every archive, and the
 * command that opens it with the selected text as the query
 */
export const registerArchiveSearch = (
  context: ExtensionContext,
  { archives }: Services,
): void => {
  const searchView = createSearchView(context, archives);

  context.subscriptions.push(
    searchView,
    registerCommand('bigfs.searchArchives', () => {
      const editor = window.activeTextEditor;
      const selected =
        editor && !editor.selection.isEmpty && editor.selection.isSingleLine
          ? editor.document.getText(editor.selection)
          : undefined;

      return searchView.focus(selected);
    }),
  );
};
