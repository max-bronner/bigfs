import * as vscode from 'vscode';
import path from 'path';
import { listBaseArchives } from '../model/modDiff';
import {
  overrideReport,
  reportMarkdown,
  skippedFromPackage,
} from '../model/modPackage';
import type { Delivery, OverrideReport } from '../model/modPackage';
import { listFiles, packFolderInto } from './modCommands';

/**
 * **Package Mod…**: packs a mod folder into one archive after showing what
 * shipping it does. The report lists, against the base game, the files the
 * archive overrides, the new ones, and the ones it would not override
 * because a base archive sorts before its name; and the INI errors open in
 * the Problems panel for the folder. Hidden files and archives inside the
 * folder are left out.
 */

export interface PackageRequest {
  folder: vscode.Uri;
  name: string;
  delivery: Delivery;
  /** Where the archive goes; asked for when missing */
  target?: vscode.Uri;
  /** False packs without asking, for automation */
  confirm?: boolean;
}

/** INI errors the Problems panel holds for files below the folder */
const errorsBelow = (folder: vscode.Uri) =>
  vscode.languages.getDiagnostics().flatMap(([uri, diagnostics]) =>
    uri.scheme === 'file' &&
    uri.fsPath.startsWith(folder.fsPath + path.sep) &&
    /\.(ini|inc)$/i.test(uri.fsPath)
      ? diagnostics
          .filter(
            (diagnostic) =>
              diagnostic.severity === vscode.DiagnosticSeverity.Error,
          )
          .map((diagnostic) => ({
            path: path.relative(folder.fsPath, uri.fsPath).replace(/\\/g, '/'),
            line: diagnostic.range.start.line,
            message: diagnostic.message,
          }))
      : [],
  );

const ask = async (): Promise<PackageRequest | undefined> => {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder =
    folders.length === 1
      ? folders[0].uri
      : (
          await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            defaultUri: folders[0]?.uri,
            openLabel: 'Package',
            title: 'The mod folder to package',
          })
        )?.[0];

  if (!folder) {
    return undefined;
  }

  const name = await vscode.window.showInputBox({
    title: 'Package mod: archive name',
    prompt:
      'In the game folder an archive overrides only those whose names sort after it: ! and _ sort first',
    value: `!${path.basename(folder.fsPath)}.big`,
    validateInput: (value) =>
      /^[^\\/:*?"<>|]+\.big$/i.test(value)
        ? undefined
        : 'A file name ending in .big',
  });

  if (!name) {
    return undefined;
  }

  const delivery = await vscode.window.showQuickPick(
    [
      {
        label: 'Copied into the game folder',
        detail: "Loads by its name among the game's own archives",
        delivery: 'gameFolder' as const,
      },
      {
        label: 'Loaded with -mod',
        detail: 'A layer of its own, before the game: wins whatever its name',
        delivery: 'modFolder' as const,
      },
    ],
    { title: 'Package mod: how players install it' },
  );

  return delivery && { folder, name, delivery: delivery.delivery };
};

export const registerPackageMod = (
  baseFolder: () => Promise<string | undefined>,
): vscode.Disposable =>
  vscode.commands.registerCommand(
    'bigfs.packageMod',
    async (
      given?: PackageRequest,
    ): Promise<{ report: OverrideReport; packed: number } | undefined> => {
      const request = given ?? (await ask());

      if (!request) {
        return undefined;
      }

      const base = await baseFolder();
      const files = (await listFiles(request.folder))
        .map((file) => file.relativePath)
        .filter((file) => !skippedFromPackage(file));
      const archives = base ? (await listBaseArchives(base)).archives : [];
      const report = overrideReport(
        files,
        request.name,
        archives,
        request.delivery,
      );
      const problems = errorsBelow(request.folder);

      if (request.confirm !== false) {
        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: reportMarkdown(
            report,
            request.name,
            request.delivery,
            problems,
            !!base,
          ),
        });

        await vscode.commands.executeCommand(
          'markdown.showPreviewToSide',
          document.uri,
        );

        const choice = await vscode.window.showInformationMessage(
          `${files.length} files: ${report.overrides.length} override the game, ${report.added.length} new, ${report.ignored.length} ignored; ${problems.length} INI errors.`,
          { modal: true, detail: 'The full report is open beside the editor.' },
          'Pack',
        );

        if (choice !== 'Pack') {
          return { report, packed: 0 };
        }
      }

      const target =
        request.target ??
        (await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(
            path.join(
              request.delivery === 'gameFolder' && base
                ? base
                : path.dirname(request.folder.fsPath),
              request.name,
            ),
          ),
          filters: { 'BIG archive': ['big'] },
          saveLabel: 'Pack',
        }));

      if (!target) {
        return { report, packed: 0 };
      }

      const packed = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Packing ${path.basename(target.fsPath)}`,
        },
        () => packFolderInto(request.folder, target, skippedFromPackage),
      );

      void vscode.window.showInformationMessage(
        `Packed ${packed} files into ${path.basename(target.fsPath)}.`,
      );
      return { report, packed };
    },
  );
