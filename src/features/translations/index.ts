import type { ExtensionContext } from 'vscode';
import type { Services } from '../../services/createServices';
import { registerTranslationCheck } from './translationCheck';

/** Registers the translation check across the workspace's string tables */
export const registerTranslations = (
  context: ExtensionContext,
  { archives }: Services,
): void => {
  context.subscriptions.push(registerTranslationCheck(archives));
};
