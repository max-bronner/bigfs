import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { SageIniDocuments } from '../../language/sageIniDocuments';
import { CahEditorProvider } from '../../providers/cahEditorProvider';

/** Registers the Create-a-Hero editor */
export const registerCah = (
  context: ExtensionContext,
  { iniIndex, gameLanguage, locator }: Services,
): void => {
  // Its own documents rather than the shared `iniDocuments`; whether the two
  // can be one is an open question in docs/refactor-plan.md
  const documents = new SageIniDocuments(context.extensionUri);

  context.subscriptions.push(
    documents,
    CahEditorProvider.register({
      documents,
      index: iniIndex,
      gameLanguage,
      locator,
    }),
  );
};
