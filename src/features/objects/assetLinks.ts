import * as vscode from 'vscode';
import type { EntryLocator } from '../../services/entryLocator';
import { PREVIEW_VIEW_TYPE } from '../../providers/previewEditorProvider';
import { findAssetReferences } from '../../formats/ini/sageIniAssets';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';

/**
 * Every model, animation, texture and sound an INI file names is a link that
 * opens the file in its viewer, wherever it lives: an animation opens on
 * the model drawn on its skeleton, a sound in the audio preview, whose
 * player starts only on a click.
 */

const OPEN_ASSET = 'bigfs.openAsset';

class AssetLinkProvider implements vscode.DocumentLinkProvider {
  public constructor(private readonly documents: SageIniDocuments) {}

  public async provideDocumentLinks(
    document: vscode.TextDocument,
  ): Promise<vscode.DocumentLink[]> {
    const parsed = await this.documents.parse(document);

    return findAssetReferences(parsed).map((reference) => {
      const link = new vscode.DocumentLink(
        new vscode.Range(
          reference.line,
          reference.start,
          reference.line,
          reference.end,
        ),
        vscode.Uri.parse(
          `command:${OPEN_ASSET}?${encodeURIComponent(
            JSON.stringify([reference.candidates, document.uri.toString()]),
          )}`,
        ),
      );

      link.tooltip = `Open ${reference.candidates[0]}`;
      return link;
    });
  }
}

export const registerAssetLinks = (
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  locator: EntryLocator,
): vscode.Disposable[] => [
  vscode.languages.registerDocumentLinkProvider(
    selector,
    new AssetLinkProvider(documents),
  ),
  vscode.commands.registerCommand(
    OPEN_ASSET,
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
