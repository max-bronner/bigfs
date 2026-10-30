import {
  ProgressLocation,
  commands,
  languages,
  window,
  workspace,
} from 'vscode';
import type { Diagnostic, Disposable, Uri } from 'vscode';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { getFileNodes } from '../../services/archives/virtualNode';
import { getNodeUri } from '../../services/archives/nodeAddress';
import { formatCount } from '../../core/messages';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import { decodeIniText } from '../../core/windows1252';
import type { EntryLocator } from '../../services/entryLocator';
import { assetNamesToCheck } from '../../services/ini/sageIniAssetCheck';
import { diagnoseIniText } from '../../services/ini/diagnoseIniText';
import { registerCommand } from '../../platform/commands';

/**
 * Checks every INI file of the workspace at once, in archives and loose, and
 * lists what it finds in the Problems panel: what the editor reports for an
 * open file, for a whole mod before it is shipped. The results stay until the
 * next run, or until the command is run with nothing to report.
 */

/** INI files a validation reads */
const INI_PATTERN = /\.(ini|inc|bhav)$/i;

/** Registers `bigfs.validateIni`, which fills its own diagnostic collection */
export const registerSageIniValidation = (
  documents: SageIniDocuments,
  archiveModel: ArchiveModel,
  locator?: EntryLocator,
): Disposable[] => {
  const collection = languages.createDiagnosticCollection(
    'sage-ini-validation',
  );

  const validate = async (): Promise<void> => {
    const schema = await documents.getSchema();
    const assetNames = await assetNamesToCheck(locator);
    const results: [Uri, Diagnostic[]][] = [];
    let fileCount = 0;

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'Validating INI files',
        cancellable: true,
      },
      async (progress, token) => {
        for (const root of archiveModel.getArchiveRoots()) {
          if (token.isCancellationRequested) {
            return;
          }

          progress.report({ message: root.name });

          try {
            await archiveModel.loadArchiveOf(root);
          } catch {
            continue; // an archive that does not read has nothing to check
          }

          const nodes = getFileNodes(root).filter((node) =>
            INI_PATTERN.test(node.name),
          );

          await archiveModel.readFiles(
            nodes.map((node) => ({ node })),
            async ({ node }, content) => {
              fileCount += 1;
              results.push([
                getNodeUri(node),
                diagnoseIniText(
                  decodeIniText(content),
                  node.entryPath,
                  schema,
                  assetNames,
                ),
              ]);
            },
          );
        }

        progress.report({ message: 'loose files' });

        for (const uri of await workspace.findFiles(
          '**/*.{ini,inc,bhav,INI,INC,BHAV}',
          '**/node_modules/**',
        )) {
          if (token.isCancellationRequested) {
            return;
          }

          fileCount += 1;
          results.push([
            uri,
            diagnoseIniText(
              decodeIniText(await workspace.fs.readFile(uri)),
              uri.path,
              schema,
              assetNames,
            ),
          ]);
        }
      },
    );

    collection.clear();
    collection.set(results.filter(([, diagnostics]) => diagnostics.length));

    const problems = results.reduce(
      (total, [, diagnostics]) => total + diagnostics.length,
      0,
    );

    if (problems) {
      window.showWarningMessage(
        `${formatCount(problems, 'problem')} in ${formatCount(fileCount, 'file')} checked; see the Problems panel.`,
      );
      await commands.executeCommand('workbench.actions.view.problems');
    } else {
      window.showInformationMessage(
        `No problems in ${formatCount(fileCount, 'INI file')}.`,
      );
    }
  };

  return [
    collection,
    registerCommand('bigfs.validateIni', validate),
  ];
};
