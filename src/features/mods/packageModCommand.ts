import * as vscode from 'vscode';
import os from 'os';
import path from 'path';
import { listBaseArchives } from '../../node/modDiff';
import {
  defaultPackageFolder,
  overrideReport,
  reportMarkdown,
  skippedFromPackage,
} from '../../node/modPackage';
import type { Delivery, OverrideReport } from '../../node/modPackage';
import { packedArchives } from '../../services/archives/packagedOutputs';
import { decodeWindows1252 } from '../../core/windows1252';
import { diagnoseText } from '../../language/sageIniValidation';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import { listFiles, packFolderInto } from './modCommands';

/**
 * **Package Mod…**: packs a mod folder into one archive after showing what
 * shipping it does. The report lists, against the base game, the files the
 * archive overrides, the new ones, and the ones it would not override
 * because a base archive sorts before its name; and the INI errors of the
 * folder's files, checked here rather than read off the Problems panel. Hidden files and archives inside the
 * folder are left out.
 *
 * The base game is every install the settings name, ROTWK above BFME II,
 * loose files included. The archive is offered beside the mod folder, never
 * in the base game folder, and a copy saved there is not counted as base.
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

/**
 * The INI errors of the mod folder's files, found by checking them here: a
 * file nobody opened has no diagnostics in the Problems panel to count
 */
const errorsIn = async (
  files: { uri: vscode.Uri; relativePath: string }[],
  documents: SageIniDocuments,
) => {
  const schema = await documents.getSchema();
  const errors: { path: string; line: number; message: string }[] = [];

  for (const { uri, relativePath } of files) {
    if (!/\.(ini|inc)$/i.test(relativePath)) {
      continue;
    }

    try {
      const text = decodeWindows1252(await vscode.workspace.fs.readFile(uri));

      for (const diagnostic of diagnoseText(text, relativePath, schema)) {
        if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
          errors.push({
            path: relativePath,
            line: diagnostic.range.start.line,
            message: diagnostic.message,
          });
        }
      }
    } catch {
      // a file that does not read has nothing to report
    }
  }

  return errors;
};

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
  baseLayers: () => Promise<string[]>,
  documents: SageIniDocuments,
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

      const layers = await baseLayers();
      const listed = (await listFiles(request.folder)).filter(
        (file) => !skippedFromPackage(file.relativePath),
      );
      const files = listed.map((file) => file.relativePath);
      const archives = layers.length
        ? (await listBaseArchives(layers, { exclude: packedArchives() }))
            .archives
        : [];
      const report = overrideReport(
        files,
        request.name,
        archives,
        request.delivery,
      );
      const problems = await errorsIn(listed, documents);

      if (request.confirm !== false) {
        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: reportMarkdown(
            report,
            request.name,
            request.delivery,
            problems,
            layers.length > 0,
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
              defaultPackageFolder(request.folder.fsPath, layers, os.homedir()),
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
