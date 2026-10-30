import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerEffectiveObjects } from './effectiveObjectView';
import { registerNewObjectWizard } from './newObjectWizard';

/** Registers the object features: the effective object view and the new object wizard */
export const registerObjects = (
  context: ExtensionContext,
  { iniDocuments, iniIndex, archives }: Services,
): void => {
  context.subscriptions.push(
    ...registerEffectiveObjects(
      { language: SAGE_INI_LANGUAGE },
      iniDocuments,
      iniIndex,
    ),
    registerNewObjectWizard(iniDocuments, iniIndex, archives),
  );
};
