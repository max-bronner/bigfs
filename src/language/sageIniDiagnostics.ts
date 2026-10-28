import { findScriptProblems } from '../formats/ini/sageIniScripts';
import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  languages,
  workspace,
} from 'vscode';
import type { Disposable, TextDocument } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../constants';
import { findUnresolvedReferences } from '../formats/ini/sageIniReferenceCheck';
import { findSageIniProblems } from '../formats/ini/sageIniProblems';
import { findGameTextLabels, missingTextMessage } from './model/gameTextLabels';
import type { SageProblem } from '../formats/ini/sageIniProblems';
import type { SageDocument } from '../formats/ini/sageIniParser';
import type { SageIniSchema } from '../formats/ini/sageIniSchema';
import type { SageIniIndex } from './sageIniIndex';
import type { SageIniDocuments } from './sageIniDocuments';
import { includeExists, resolveIncludeUri } from './sageIniInclude';
import type { EntryLocator } from '../formats/entryLocator';
import {
  CHECK_ASSETS_SETTING,
  checkedAssetDiagnostics,
} from './sageIniAssetCheck';

/**
 * Keeps the Problems panel current for every open SAGE INI document: what
 * `findSageIniProblems` finds in its parse, and every `#include` naming a
 * file that is not there.
 */

/** Source label every diagnostic carries, which the Problems panel shows */
const SOURCE = 'bigFS';

/** How long typing has to pause before a document is checked again */
const CHECK_DELAY_MS = 300;

/** Turns a problem into the diagnostic the editor shows */
const toDiagnostic = (
  document: TextDocument,
  { line, start, end, message, severity }: SageProblem,
): Diagnostic => {
  const diagnostic = new Diagnostic(
    new Range(line, start, line, end ?? document.lineAt(line).text.length),
    message,
    severity === 'error'
      ? DiagnosticSeverity.Error
      : DiagnosticSeverity.Warning,
  );

  diagnostic.source = SOURCE;

  return diagnostic;
};

/** Setting choosing whether references to unknown names are reported */
const CHECK_REFERENCES_SETTING = 'bigfs.ini.checkReferences';

/**
 * Builds a diagnostic for every value of a reference field that names
 * nothing in any namespace the field can point into
 */
const getReferenceDiagnostics = async (
  parsed: SageDocument,
  schema: SageIniSchema,
  index: SageIniIndex,
): Promise<Diagnostic[]> => {
  const mode = workspace
    .getConfiguration()
    .get<'auto' | 'on' | 'off'>(CHECK_REFERENCES_SETTING, 'auto');

  if (mode === 'off') {
    return [];
  }

  await index.whenReady();

  return findUnresolvedReferences(parsed, schema, index, mode === 'on').map(
    ({ name, line, start, end, namespaces }) => {
      const diagnostic = new Diagnostic(
        new Range(line, start, line, end),
        `No ${namespaces.join(' or ')} named '${name}' is defined in the workspace`,
        // The engine tolerates a name nothing defines, so it is a hint
        DiagnosticSeverity.Information,
      );

      diagnostic.source = SOURCE;

      return diagnostic;
    },
  );
};

/** Setting choosing whether game-text labels nothing defines are reported */
export const CHECK_STRINGS_SETTING = 'bigfs.ini.checkStrings';

/** Records the base game's tables alone hold many more of */
const AUTO_MINIMUM_STRINGS = 1000;

/**
 * Builds a warning for every game-text label (`OBJECT:Name`) no string
 * table defines: the game shows such a label as its raw name or a
 * "MISSING" marker
 */
const getStringDiagnostics = async (
  parsed: SageDocument,
  index: SageIniIndex,
): Promise<Diagnostic[]> => {
  const mode = workspace
    .getConfiguration()
    .get<'auto' | 'on' | 'off'>(CHECK_STRINGS_SETTING, 'auto');

  if (mode === 'off') {
    return [];
  }
  await index.whenReady();
  if (mode === 'auto' && index.stringCount < AUTO_MINIMUM_STRINGS) {
    return [];
  }

  return findGameTextLabels(parsed)
    .filter((label) => !index.findString(label.text))
    .map((label) => {
      const diagnostic = new Diagnostic(
        new Range(label.line, label.start, label.line, label.end),
        missingTextMessage(label.text),
        DiagnosticSeverity.Warning,
      );

      diagnostic.source = SOURCE;
      return diagnostic;
    });
};

/** Builds a diagnostic for every `#include` whose file does not exist */
const getIncludeDiagnostics = async (
  document: TextDocument,
  parsed: SageDocument,
): Promise<Diagnostic[]> => {
  const missing = await Promise.all(
    parsed.includes.map(
      async (include) =>
        !(await includeExists(resolveIncludeUri(document.uri, include.path))),
    ),
  );

  return parsed.includes
    .filter((_, index) => missing[index])
    .map((include) => {
      const diagnostic = new Diagnostic(
        new Range(include.line, include.start, include.line, include.end),
        `Included file not found: ${include.path}`,
        DiagnosticSeverity.Warning,
      );

      diagnostic.source = SOURCE;

      return diagnostic;
    });
};

/**
 * Checks every open SAGE INI document and keeps its diagnostics current as it
 * is edited, and again for every document when another game is picked.
 */
export const watchSageIniDiagnostics = (
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator?: EntryLocator,
): Disposable => {
  const collection = languages.createDiagnosticCollection(SAGE_INI_LANGUAGE);
  const pending = new Map<string, NodeJS.Timeout>();

  const check = async (document: TextDocument): Promise<void> => {
    if (document.languageId !== SAGE_INI_LANGUAGE) {
      collection.delete(document.uri);
      return;
    }

    const version = document.version;
    const [parsed, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);
    const diagnostics = [
      ...findSageIniProblems(parsed, schema).map((problem) =>
        toDiagnostic(document, problem),
      ),
      ...(await getIncludeDiagnostics(document, parsed)),
      ...(await getReferenceDiagnostics(parsed, schema, index)),
      ...(await getStringDiagnostics(parsed, index)),
      ...(await checkedAssetDiagnostics(parsed, locator, SOURCE).catch(
        () => [],
      )),
      ...findScriptProblems(
        Array.from(
          { length: document.lineCount },
          (_, line) => document.lineAt(line).text,
        ),
        parsed.scripts.filter((script) => script.endLine > script.startLine),
      ).map((problem) => {
        const diagnostic = new Diagnostic(
          new Range(
            problem.line,
            problem.column,
            problem.line,
            document.lineAt(Math.min(problem.line, document.lineCount - 1)).text
              .length,
          ),
          problem.message,
          // A warning: the games' Lua is 5.0, which luaparse reads as 5.1
          DiagnosticSeverity.Warning,
        );

        diagnostic.source = SOURCE;

        return diagnostic;
      }),
    ];

    // An edit that landed while the includes were checked has its own run
    if (!document.isClosed && document.version === version) {
      collection.set(document.uri, diagnostics);
    }
  };

  const checkSoon = (document: TextDocument): void => {
    const key = document.uri.toString();

    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        void check(document);
      }, CHECK_DELAY_MS),
    );
  };

  const checkAll = (): void => workspace.textDocuments.forEach(checkSoon);

  checkAll();

  const subscriptions = [
    collection,
    workspace.onDidOpenTextDocument(checkSoon),
    workspace.onDidChangeTextDocument(({ document }) => checkSoon(document)),
    workspace.onDidCloseTextDocument((document) =>
      collection.delete(document.uri),
    ),
    documents.onDidChangeSchema(checkAll),
    workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(CHECK_REFERENCES_SETTING) ||
        event.affectsConfiguration(CHECK_STRINGS_SETTING) ||
        event.affectsConfiguration(CHECK_ASSETS_SETTING)
      ) {
        checkAll();
      }
    }),
  ];

  return {
    dispose: () => {
      pending.forEach((timeout) => clearTimeout(timeout));
      subscriptions.forEach((subscription) => subscription.dispose());
    },
  };
};
