import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { registerSoundPlayer } from './soundPlayer';

/** Registers the sound player behind the INI audio lenses */
export const registerAudio = (
  context: ExtensionContext,
  { iniDocuments, iniIndex, locator }: Services,
): void => {
  context.subscriptions.push(
    ...registerSoundPlayer(
      { language: SAGE_INI_LANGUAGE },
      iniDocuments,
      iniIndex,
      locator,
    ),
  );
};
