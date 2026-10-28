import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerParticlePreview } from '../../language/particlePreview';
import { registerParticleTemplates } from '../../language/particleTemplates';

/** Registers the particle system preview and the particle templates */
export const registerParticles = (
  context: ExtensionContext,
  { iniIndex, locator }: Services,
): void => {
  context.subscriptions.push(
    ...registerParticlePreview(
      context,
      { language: SAGE_INI_LANGUAGE },
      iniIndex,
      locator,
    ),
    registerParticleTemplates(),
  );
};
