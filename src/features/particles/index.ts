import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerObjectPreview } from './objectPreview';
import { registerParticlePreview } from './particlePreview';
import { registerParticleTemplates } from './particleTemplates';

/**
 * Registers the particle page's two previews, of a particle system and of an
 * object with its effects, and the particle templates
 */
export const registerParticles = (
  context: ExtensionContext,
  { iniDocuments, iniIndex, locator }: Services,
): void => {
  const selector = { language: SAGE_INI_LANGUAGE };

  context.subscriptions.push(
    ...registerObjectPreview(
      context,
      selector,
      iniDocuments,
      iniIndex,
      locator,
    ),
    ...registerParticlePreview(context, selector, iniIndex, locator),
    registerParticleTemplates(),
  );
};
