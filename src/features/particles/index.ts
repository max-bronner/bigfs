import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerParticlePreview } from './particlePreview';
import { registerParticleTemplates } from './particleTemplates';

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
