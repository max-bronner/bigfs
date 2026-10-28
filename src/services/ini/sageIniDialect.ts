import { languages, workspace } from 'vscode';
import type { Disposable, TextDocument } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../../constants';

/**
 * Recognises the dialect inside a `.ini` file and switches its language mode.
 *
 * `.ini` is a crowded extension - VS Code's own built-in language claims it,
 * and so does every generic INI extension - so it cannot be declared in the
 * manifest the way `.inc` and `.bhav` are. Instead a `.ini` document is
 * inspected once it is open, and only switched when its content looks like
 * the dialect rather than a plain key=value file.
 */

/**
 * Root blocks whose presence identifies the dialect. Chosen as keywords a
 * plain INI file would never contain, so a false positive is unlikely even
 * from a single matching line.
 */
const DIALECT_PATTERN =
  /^\s*(?:Object|Weapon|Armor|FXList|AudioEvent|CommandButton|CommandSet|Upgrade|ObjectCreationList|FXParticleSystem|MappedImage|WindowTransition)\s+\S|^\s*End\s*$/im;

/** Language ids a `.ini` file arrives as before it is recognised */
const ADOPTABLE_LANGUAGES = new Set(['ini', 'plaintext']);

/** Whether a document is written in the dialect rather than as a plain INI */
const looksLikeSageIni = (document: TextDocument): boolean =>
  DIALECT_PATTERN.test(document.getText());

const adoptDocument = (document: TextDocument): void => {
  if (
    !ADOPTABLE_LANGUAGES.has(document.languageId) ||
    !document.uri.path.toLowerCase().endsWith('.ini') ||
    !looksLikeSageIni(document)
  ) {
    return;
  }

  languages.setTextDocumentLanguage(document, SAGE_INI_LANGUAGE);
};

/**
 * Checks every document already open, then watches for new ones. Called once
 * from `registerSageIniLanguage`; the returned disposable stops the watch.
 */
export const watchSageIniDialect = (): Disposable => {
  workspace.textDocuments.forEach(adoptDocument);

  return workspace.onDidOpenTextDocument(adoptDocument);
};
