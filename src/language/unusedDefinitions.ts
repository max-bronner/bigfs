import * as vscode from 'vscode';
import type { SageIniIndex } from './sageIniIndex';

/**
 * "Find Unused Definitions": every definition in the workspace's own files
 * that no INI file references, listed in the Problems panel at its header.
 * Only kinds some field can name are checked; objects (placed by maps),
 * images (named by WND and APT files) and the engine's own entry points are
 * left out, since nothing in INI names them.
 */

/** Namespaces used by name from outside INI, lowercased */
const NAMED_ELSEWHERE = new Set([
  'object',
  'childobject',
  'objectreskin',
  'mappedimage',
  'playertemplate',
]);

export const registerUnusedDefinitions = (
  index: SageIniIndex,
): vscode.Disposable[] => {
  const collection =
    vscode.languages.createDiagnosticCollection('sage-ini-unused');

  const find = async (): Promise<number> => {
    await index.whenReady();

    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
      folder.uri.toString(),
    );
    const unused = index.findUnreferenced(
      (definition) =>
        definition.uri.scheme === 'file' &&
        folders.some((folder) => definition.uri.toString().startsWith(folder)),
      NAMED_ELSEWHERE,
    );
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const definition of unused) {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          definition.line,
          definition.start,
          definition.line,
          definition.end,
        ),
        `${definition.keyword} '${definition.name}' is not referenced by any INI file`,
        vscode.DiagnosticSeverity.Information,
      );

      diagnostic.source = 'bigFS unused';
      diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];

      const key = definition.uri.toString();

      byFile.set(key, [...(byFile.get(key) ?? []), diagnostic]);
    }

    collection.clear();
    collection.set(
      [...byFile].map(([uri, diagnostics]) => [
        vscode.Uri.parse(uri),
        diagnostics,
      ]),
    );
    return unused.length;
  };

  return [
    collection,
    vscode.commands.registerCommand('bigfs.findUnusedDefinitions', async () => {
      const count = await find();

      if (count) {
        void vscode.window.showInformationMessage(
          `${count} definition${count === 1 ? '' : 's'} in the workspace that no INI file references; see the Problems panel. Maps, scripts and the engine may still use some by name.`,
        );
        await vscode.commands.executeCommand('workbench.actions.view.problems');
      } else {
        void vscode.window.showInformationMessage(
          'Every definition in the workspace is referenced.',
        );
      }
      return count;
    }),
    vscode.commands.registerCommand('bigfs.clearUnusedDefinitions', () =>
      collection.clear(),
    ),
  ];
};
