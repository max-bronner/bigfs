import { languages } from 'vscode';
import type { ExtensionContext, LogOutputChannel } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../constants';
import type { ArchiveModel } from '../model/archiveModel';
import { SageIniDocuments } from './sageIniDocuments';
import { SageIniIndex } from './sageIniIndex';
import { watchSageIniDialect } from './sageIniDialect';
import { watchSageIniDiagnostics } from './sageIniDiagnostics';
import { createSageIniFoldingProvider } from './providers/sageIniFoldingProvider';
import { createSageIniOutlineProvider } from './providers/sageIniOutlineProvider';
import {
  SAGE_INI_LEGEND,
  createSageIniSemanticTokensProvider,
} from './providers/sageIniSemanticTokensProvider';
import { createSageIniHoverProvider } from './providers/sageIniHoverProvider';
import { createSageIniDefinitionProvider } from './providers/sageIniDefinitionProvider';
import { createSageIniReferenceProvider } from './providers/sageIniReferenceProvider';
import { createSageIniCompletionProvider } from './providers/sageIniCompletionProvider';
import { createSageIniRenameProvider } from './providers/sageIniRenameProvider';

/**
 * Language support for the SAGE INI dialect the game's `.ini` and `.inc`
 * entries are written in.
 *
 * The layout mirrors the rest of the extension: `model/` knows the dialect
 * and nothing about VS Code, `providers/` adapts that knowledge to one
 * language feature each, and `sageIniDocuments` / `sageIniIndex` are the two
 * services every provider is handed - one reads a single document, the other
 * answers questions that reach across every archive. This file only wires
 * the three together.
 *
 * Adding a feature means adding one file under `providers/` and one
 * registration call below; nothing here should otherwise need to change.
 */
export const registerSageIniLanguage = (
  context: ExtensionContext,
  archiveModel: ArchiveModel,
  log: LogOutputChannel,
): void => {
  const documents = new SageIniDocuments(context.extensionUri);
  const index = new SageIniIndex(
    archiveModel,
    () => documents.getSchema(),
    log,
  );
  const selector = { language: SAGE_INI_LANGUAGE };

  // Built up front rather than on the first navigation. Reading a full
  // install takes a few seconds, and a provider that slow is cancelled by the
  // editor before it answers - which reads as ctrl-click doing nothing.
  archiveModel
    .whenReady()
    .then(() => index.whenReady())
    .catch((error: unknown) => log.error('Failed to index INI entries', error));

  context.subscriptions.push(
    documents,
    index,
    // Another game reads some lines differently, so every file is read again
    documents.onDidChangeSchema(() => index.reset()),
    watchSageIniDialect(),
    watchSageIniDiagnostics(documents),
    languages.registerFoldingRangeProvider(
      selector,
      createSageIniFoldingProvider(documents),
    ),
    languages.registerDocumentSymbolProvider(
      selector,
      createSageIniOutlineProvider(documents),
    ),
    languages.registerDocumentSemanticTokensProvider(
      selector,
      createSageIniSemanticTokensProvider(documents),
      SAGE_INI_LEGEND,
    ),
    languages.registerHoverProvider(
      selector,
      createSageIniHoverProvider(documents, index),
    ),
    languages.registerDefinitionProvider(
      selector,
      createSageIniDefinitionProvider(documents, index),
    ),
    languages.registerReferenceProvider(
      selector,
      createSageIniReferenceProvider(documents, index),
    ),
    languages.registerCompletionItemProvider(
      selector,
      createSageIniCompletionProvider(documents, index),
    ),
    languages.registerRenameProvider(
      selector,
      createSageIniRenameProvider(documents, index),
    ),
  );
};
