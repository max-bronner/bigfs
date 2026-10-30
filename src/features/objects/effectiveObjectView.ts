import * as vscode from 'vscode';
import { composeEffectiveObject, parseTemplateHeader } from '../../services/ini/effectiveObject';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { registerCommand } from '../../platform/commands';

/**
 * "Show Effective Definition" on a `ChildObject` or `ObjectReskin`: a
 * read-only document holding the object as the game composes it from its
 * lineage, every line marked with the definition it comes from. It follows
 * edits to the files it was composed from.
 */

const SCHEME = 'bigfs-effective';

/** Creates the content provider of the effective views, which can redraw them */
const createEffectiveContentProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
) => {
  const changed = new vscode.EventEmitter<vscode.Uri>();

  return {
    onDidChange: changed.event,

    /** Asks for one view again, the next time it is shown */
    update: (uri: vscode.Uri): void => changed.fire(uri),

    /** Redraws every effective view open, after an INI edit */
    refresh: (): void => {
      for (const document of vscode.workspace.textDocuments) {
        if (document.uri.scheme === SCHEME) {
          changed.fire(document.uri);
        }
      }
    },

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const query = new URLSearchParams(uri.query);

      return (
        (await composeEffectiveObject(
          documents,
          index,
          vscode.Uri.parse(query.get('uri') ?? ''),
          Number(query.get('line')),
        )) ?? `; ${uri.path.slice(1)} is no longer where it was`
      );
    },
  };
};

/** Builds the URI of the effective view of the template written at a line */
const toEffectiveUri = (uri: vscode.Uri, line: number, name: string) =>
  vscode.Uri.from({
    scheme: SCHEME,
    path: `/${name} (effective).ini`,
    query: new URLSearchParams({
      uri: uri.toString(),
      line: String(line),
    }).toString(),
  });

/** Creates a lens over every ChildObject and ObjectReskin header */
const createEffectiveLensProvider = (): vscode.CodeLensProvider => ({
  provideCodeLenses(document) {
    const lenses: vscode.CodeLens[] = [];

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;

      if (!/^\s*(ChildObject|ObjectReskin)\s/i.test(text)) {
        continue;
      }

      const header = parseTemplateHeader(text);

      if (header.parent) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: `Effective definition (inherits ${header.parent})`,
            command: 'bigfs.showEffectiveObject',
            arguments: [document.uri, line],
          }),
        );
      }
    }
    return lenses;
  },
});

/**
 * Registers the effective definition documents, their lens and
 * `bigfs.showEffectiveObject`; open views redraw on any INI edit
 */
export const registerEffectiveObjects = (
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable[] => {
  const provider = createEffectiveContentProvider(documents, index);
  // Edits outside the editor change a lineage too
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.ini');

  return [
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.languages.registerCodeLensProvider(
      selector,
      createEffectiveLensProvider(),
    ),
    watcher,
    watcher.onDidChange(() => provider.refresh()),
    watcher.onDidCreate(() => provider.refresh()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        event.document.uri.scheme !== SCHEME &&
        event.document.languageId === 'sage-ini'
      ) {
        provider.refresh();
      }
    }),
    registerCommand(
      'bigfs.showEffectiveObject',
      async (uri?: vscode.Uri, line?: number) => {
        const editor = vscode.window.activeTextEditor;

        if (!uri || line === undefined) {
          if (!editor) {
            return undefined;
          }
          uri = editor.document.uri;

          // The template header at or above the cursor
          for (line = editor.selection.active.line; line >= 0; line--) {
            if (
              /^\s*(Object|ChildObject|ObjectReskin)\s/i.test(
                editor.document.lineAt(line).text,
              )
            ) {
              break;
            }
          }
          if (line < 0) {
            void vscode.window.showInformationMessage(
              'Put the cursor inside an Object, ChildObject or ObjectReskin',
            );
            return undefined;
          }
        }

        const text = (await vscode.workspace.openTextDocument(uri)).lineAt(
          line,
        ).text;
        const target = toEffectiveUri(uri, line, parseTemplateHeader(text).name);

        // An open view may predate files indexed since
        provider.update(target);

        const view = await vscode.workspace.openTextDocument(target);

        await vscode.languages.setTextDocumentLanguage(view, 'sage-ini');
        await vscode.window.showTextDocument(view, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        });
        return view;
      },
    ),
  ];
};
