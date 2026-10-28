import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerArmorTable as registerArmorTableCommand } from './armorTable';

/** Registers the armor table that compares armor sets by damage type */
export const registerArmorTable = (
  context: ExtensionContext,
  { iniDocuments, iniIndex }: Services,
): void => {
  context.subscriptions.push(
    registerArmorTableCommand(context, iniDocuments, iniIndex),
  );
};
