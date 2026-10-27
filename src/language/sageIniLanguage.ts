import { languages } from 'vscode';
import type { ExtensionContext, LogOutputChannel } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../constants';
import type { ArchiveModel } from '../model/archiveModel';
import { SageIniDocuments } from './sageIniDocuments';
import { SageIniIndex } from './sageIniIndex';
import { watchSageIniDialect } from './sageIniDialect';
import { watchSageIniDiagnostics } from './sageIniDiagnostics';
import { registerSageIniValidation } from './sageIniValidation';
import { createCommandSetPreview } from './commandSetPreview';
import { registerBulkEdit } from './bulkEditCommand';
import { registerEffectiveObjects } from './effectiveObjectView';
import { registerNewObjectWizard } from './newObjectWizard';
import { registerParticleTemplates } from './particleTemplates';
import { registerParticlePreview } from './particlePreview';
import { registerObjectPreview } from './objectPreview';
import { registerAssetLinks } from './assetLinks';
import { registerFileUses } from './fileUses';
import { registerUnusedDefinitions } from './unusedDefinitions';
import { watchHotkeyClashes } from './hotkeyDiagnostics';
import {
  createCallHierarchyProvider,
  createTypeHierarchyProvider,
} from './sageIniHierarchy';
import { registerDuplicateDefinition } from './duplicateDefinition';
import {
  createAudioLookup,
  describeSound,
  registerSoundPlayer,
} from './soundPlayer';
import { registerArmorTable } from './armorTable';
import { registerCommandSetEditor } from './commandSetEditor';
import { registerBalanceSheet } from './balanceSheet';
import type { EntryLocator } from '../formats/entryLocator';
import { createMappedImagePreview } from './mappedImagePreview';
import {
  SAGE_INI_CODE_ACTION_KINDS,
  createSageIniCodeActionProvider,
} from './providers/sageIniCodeActionProvider';
import { createSageIniFormattingProvider } from './providers/sageIniFormattingProvider';
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
  locator?: EntryLocator,
): void => {
  const documents = new SageIniDocuments(context.extensionUri);
  const index = new SageIniIndex(
    archiveModel,
    () => documents.getSchema(),
    log,
  );
  const selector = { language: SAGE_INI_LANGUAGE };
  const mappedImagePreview = locator && createMappedImagePreview(locator);
  const soundLookup = createAudioLookup(index, documents);

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
    ...registerParticlePreview(context, selector, index, locator),
    registerParticleTemplates(),
    registerBulkEdit(context, documents),
    ...registerEffectiveObjects(selector, documents, index),
    ...registerObjectPreview(context, selector, documents, index, locator),
    ...(locator ? registerAssetLinks(selector, documents, locator) : []),
    ...registerFileUses(documents, index),
    registerNewObjectWizard(documents, index),
    ...registerUnusedDefinitions(index),
    watchHotkeyClashes(documents, index),
    languages.registerCallHierarchyProvider(
      selector,
      createCallHierarchyProvider(documents, index),
    ),
    languages.registerTypeHierarchyProvider(
      selector,
      createTypeHierarchyProvider(documents, index),
    ),
    ...registerDuplicateDefinition(selector, documents, index),
    ...registerSoundPlayer(selector, documents, index, locator),
    registerBalanceSheet(documents, index),
    registerArmorTable(context, documents, index),
    ...registerCommandSetEditor(context, selector, documents, index, locator),
    watchSageIniDialect(),
    watchSageIniDiagnostics(documents, index, locator),
    ...registerSageIniValidation(documents, archiveModel, locator),
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
      createSageIniHoverProvider(
        documents,
        index,
        mappedImagePreview,
        createCommandSetPreview(index, mappedImagePreview),
        (parsed, line, token, uri) =>
          describeSound(soundLookup, parsed, line, token, uri),
      ),
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
    languages.registerCodeActionsProvider(
      selector,
      createSageIniCodeActionProvider(documents, index),
      { providedCodeActionKinds: SAGE_INI_CODE_ACTION_KINDS },
    ),
    languages.registerDocumentFormattingEditProvider(
      selector,
      createSageIniFormattingProvider(documents),
    ),
    languages.registerRenameProvider(
      selector,
      createSageIniRenameProvider(documents, index),
    ),
  );
};
