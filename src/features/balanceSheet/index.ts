import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerBalanceSheet as registerBalanceSheetCommand } from '../../language/balanceSheet';

/** Registers the balance sheet that compares units side by side */
export const registerBalanceSheet = (
  context: ExtensionContext,
  { iniDocuments, iniIndex }: Services,
): void => {
  context.subscriptions.push(
    registerBalanceSheetCommand(iniDocuments, iniIndex),
  );
};
