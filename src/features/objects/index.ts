import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerEffectiveObjects } from '../../language/effectiveObjectView';
import { registerObjectPreview } from '../../language/objectPreview';
import { registerNewObjectWizard } from '../../language/newObjectWizard';

/**
 * Registers the object features: the effective object view, the object
 * preview and the new object wizard
 */
export const registerObjects = (
  context: ExtensionContext,
  { iniDocuments, iniIndex, locator, archives }: Services,
): void => {
  const selector = { language: SAGE_INI_LANGUAGE };

  context.subscriptions.push(
    ...registerEffectiveObjects(selector, iniDocuments, iniIndex),
    ...registerObjectPreview(
      context,
      selector,
      iniDocuments,
      iniIndex,
      locator,
    ),
    registerNewObjectWizard(iniDocuments, iniIndex, archives),
  );
};
