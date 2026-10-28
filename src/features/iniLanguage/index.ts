import { languages } from 'vscode';
import type { ExtensionContext } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';
import type { Services } from '../../services/createServices';
import { watchSageIniDialect } from '../../services/ini/sageIniDialect';
import { watchSageIniDiagnostics } from '../../language/sageIniDiagnostics';
import { registerSageIniValidation } from '../../language/sageIniValidation';
import { createCommandSetPreview } from '../../language/commandSetPreview';
import { registerAssetLinks } from '../../language/assetLinks';
import { registerFileUses } from '../../language/fileUses';
import { registerUnusedDefinitions } from '../../language/unusedDefinitions';
import { watchHotkeyClashes } from '../../language/hotkeyDiagnostics';
import {
  createCallHierarchyProvider,
  createTypeHierarchyProvider,
} from '../../language/sageIniHierarchy';
import { registerDuplicateDefinition } from '../../language/duplicateDefinition';
import { createAudioLookup, describeSound } from '../../language/soundPlayer';
import { createMappedImagePreview } from '../preview/mappedImagePreview';
import {
  SAGE_INI_CODE_ACTION_KINDS,
  createSageIniCodeActionProvider,
} from '../../language/providers/sageIniCodeActionProvider';
import { createSageIniFormattingProvider } from '../../language/providers/sageIniFormattingProvider';
import { createSageIniFoldingProvider } from '../../language/providers/sageIniFoldingProvider';
import { createSageIniOutlineProvider } from '../../language/providers/sageIniOutlineProvider';
import {
  SAGE_INI_LEGEND,
  createSageIniSemanticTokensProvider,
} from '../../language/providers/sageIniSemanticTokensProvider';
import { createSageIniHoverProvider } from '../../language/providers/sageIniHoverProvider';
import { createSageIniDefinitionProvider } from '../../language/providers/sageIniDefinitionProvider';
import { createSageIniReferenceProvider } from '../../language/providers/sageIniReferenceProvider';
import { createSageIniCompletionProvider } from '../../language/providers/sageIniCompletionProvider';
import { createSageIniRenameProvider } from '../../language/providers/sageIniRenameProvider';

/**
 * Registers language support for the SAGE INI dialect the game's `.ini` and
 * `.inc` entries are written in: the editor providers, the checks and the
 * cross-archive navigation.
 *
 * `language/model/` knows the dialect and nothing about VS Code,
 * `language/providers/` adapts it to one language feature each, and the
 * `iniDocuments` / `iniIndex` services are what every provider is handed.
 * Adding a feature means adding one file under `language/providers/` and one
 * registration call below.
 */
export const registerIniLanguage = (
  context: ExtensionContext,
  { archives, iniDocuments: documents, iniIndex: index, locator }: Services,
): void => {
  const selector = { language: SAGE_INI_LANGUAGE };
  const mappedImagePreview = createMappedImagePreview(locator);
  const soundLookup = createAudioLookup(index, documents);

  context.subscriptions.push(
    ...registerAssetLinks(selector, documents, locator),
    ...registerFileUses(documents, index),
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
    watchSageIniDialect(),
    watchSageIniDiagnostics(documents, index, locator),
    ...registerSageIniValidation(documents, archives, locator),
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
