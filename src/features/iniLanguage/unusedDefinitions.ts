import * as vscode from 'vscode';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { AUDIO_NAMESPACES, EVA_NAMESPACES } from '../../formats/ini/sageAudioFields';
import { isModFile, isReportableKind } from '../../game/ini-tools/unusedPolicy';
import { findBaseGameFolders } from '../../services/archives/baseGameFolders';
import { registerCommand } from '../../platform/commands';

/**
 * "Find Unused Definitions": every definition in the workspace's own files
 * that no INI file references, listed in the Problems panel at its header.
 * Only kinds nothing outside INI names are checked (`unusedPolicy`): objects
 * and sciences are placed or granted by maps and scripts, images are named by
 * WND and APT files, and the engine looks up player templates, default
 * command sets, announcer events and GameData itself. Only the mod's own
 * files are scanned, never a base game folder in or beside the workspace.
 * Nothing is deleted; the findings are Problems-panel notes.
 */

/** Namespaces used by name from outside INI, lowercased */
const NAMED_ELSEWHERE = new Set(
  [
    'object',
    'childobject',
    'objectreskin',
    'mappedimage',
    'playertemplate',
    // Maps, APT movies and the engine play sounds and announcements by name
    ...AUDIO_NAMESPACES,
    ...EVA_NAMESPACES,
  ].map((namespace) => namespace.toLowerCase()),
);

export const registerUnusedDefinitions = (
  index: SageIniIndex,
): vscode.Disposable[] => {
  const collection =
    vscode.languages.createDiagnosticCollection('sage-ini-unused');

  const find = async (): Promise<number> => {
    await index.whenReady();

    const folders = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    );
    const base = await findBaseGameFolders();
    const unused = index.findUnreferenced(
      (definition) =>
        definition.uri.scheme === 'file' &&
        isReportableKind(definition.keyword) &&
        isModFile(definition.uri.fsPath, folders, base),
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
    registerCommand('bigfs.findUnusedDefinitions', async () => {
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
    registerCommand('bigfs.clearUnusedDefinitions', () =>
      collection.clear(),
    ),
  ];
};
