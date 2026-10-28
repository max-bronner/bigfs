import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerBulkEdit as registerBulkEditCommand } from './bulkEditCommand';

/** Registers the command that edits one field across many INI blocks */
export const registerBulkEdit = (
  context: ExtensionContext,
  { iniDocuments, archives }: Services,
): void => {
  context.subscriptions.push(
    registerBulkEditCommand(context, iniDocuments, archives),
  );
};
