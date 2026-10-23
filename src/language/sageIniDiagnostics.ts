import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  languages,
  workspace,
} from 'vscode';
import type { Disposable, TextDocument } from 'vscode';
import { SAGE_INI_LANGUAGE } from '../constants';
import { findSageIniProblems } from './model/sageIniProblems';
import type { SageProblem } from './model/sageIniProblems';
import type { SageDocument } from './model/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import { includeExists, resolveIncludeUri } from './sageIniInclude';

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
  ];

  return {
    dispose: () => {
      pending.forEach((timeout) => clearTimeout(timeout));
      subscriptions.forEach((subscription) => subscription.dispose());
    },
  };
};
