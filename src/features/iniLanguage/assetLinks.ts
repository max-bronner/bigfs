import * as vscode from 'vscode';
import type { EntryLocator } from '../../services/entryLocator';
import { PREVIEW_VIEW_TYPE } from '../../constants';
import { findAssetReferences } from '../../formats/ini/sageIniAssets';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import { registerCommand } from '../../platform/commands';

/**
 * Every model, animation, texture and sound an INI file names is a link that
 * opens the file in its viewer, wherever it lives: an animation opens on
 * the model drawn on its skeleton, a sound in the audio preview, whose
 * player starts only on a click.
 */

/** Creates the links from every asset an INI file names to its viewer */
const createAssetLinkProvider = (
  documents: SageIniDocuments,
): vscode.DocumentLinkProvider => ({
  async provideDocumentLinks(document) {
    const parsed = await documents.parse(document);

    return findAssetReferences(parsed).map((reference) => {
      const link = new vscode.DocumentLink(
        new vscode.Range(
          reference.line,
          reference.start,
          reference.line,
          reference.end,
        ),
        vscode.Uri.parse(
          `command:bigfs.openAsset?${encodeURIComponent(
            JSON.stringify([reference.candidates, document.uri.toString()]),
          )}`,
        ),
      );

      link.tooltip = `Open ${reference.candidates[0]}`;
      return link;
    });
  },
});

/** Registers the asset links and the `bigfs.openAsset` command they run */
export const registerAssetLinks = (
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  locator: EntryLocator,
): vscode.Disposable[] => [
  vscode.languages.registerDocumentLinkProvider(
    selector,
    createAssetLinkProvider(documents),
  ),
  registerCommand(
    'bigfs.openAsset',
    async (candidates: string[], near: string) => {
      for (const candidate of candidates) {
        const uri = await locator.findUri(candidate, vscode.Uri.parse(near));

        if (uri) {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            uri,
            PREVIEW_VIEW_TYPE,
            vscode.ViewColumn.Beside,
          );
          return;
        }
      }
      void vscode.window.showWarningMessage(
        `${candidates[0]} is in no archive or folder`,
      );
    },
  ),
];
