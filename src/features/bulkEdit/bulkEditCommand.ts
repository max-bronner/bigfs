import * as vscode from 'vscode';
import {
  BulkQueryError,
  planBulkChangesAcross,
  compileBulkQuery,
} from '../../game/ini-tools/bulkEdit';
import type { BulkQuery, BulkSource } from '../../game/ini-tools/bulkEdit';
import { isFragmentPath, parseSageIni } from '../../formats/ini/sageIniParser';
import { resolveIncludeUri } from '../../services/ini/sageIniInclude';
import {
  isArchiveUri,
  listArchiveEntries,
  offerOverride,
  readEntryText,
  restoreEntries,
  saveEntryTexts,
} from '../../services/ini/archiveText';
import { replaceInLines } from '../../formats/ini/iniTextEdits';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { registerCommand } from '../../platform/commands';

/**
 * "Bulk Edit INI Values…": asks for blocks, conditions, a field and a
 * formula, finds every matching value in the workspace's loose INI files,
 * and opens the change as a refactor preview, where each value can be
 * looked at as a diff and unticked before it is applied. A value written as
 * a macro, in an included file or inherited from a parent object is edited
 * where it is defined; one that cannot be is reported. INI files inside
 * writable archives are edited too, through the archive model: each archive
 * is saved once for all its values, and the save can be undone. A value
 * defined in a base game archive is never written; the files are offered for
 * "Override in Folder" instead.
 */

const LAST_QUERY = 'bigfs.bulkEdit.lastQuery';

const STEPS: {
  key: keyof BulkQuery;
  title: string;
  prompt: string;
  placeHolder: string;
}[] = [
  {
    key: 'blocks',
    title: 'Which blocks?',
    prompt: 'A top-level keyword, and a name pattern with * and ? if you like',
    placeHolder: 'Object *Archer*',
  },
  {
    key: 'where',
    title: 'Only where… (optional)',
    prompt:
      "Conditions on the block's fields, separated by ;  —  = equals, ~ has the value, != !~, and < <= > >= on numbers",
    placeHolder: 'Side = Rohan; KindOf ~ INFANTRY',
  },
  {
    key: 'field',
    title: 'Which field?',
    prompt:
      'A field, Module/Field to name the module (keyword, type or tag), Field[2] for its second value only',
    placeHolder: 'ActiveBody/MaxHealth',
  },
  {
    key: 'formula',
    title: 'New value',
    prompt:
      "A formula of x, the value now, and the block's own numeric fields by name; a whole number stays whole",
    placeHolder: 'round(x * 1.1)',
  },
];

/** Asks for the four parts of a query one after another, with the last answers filled in */
const askQuery = async (
  state: vscode.Memento,
): Promise<BulkQuery | undefined> => {
  const query: BulkQuery = {
    blocks: '',
    where: '',
    field: '',
    formula: 'x',
    ...state.get<BulkQuery>(LAST_QUERY),
  };

  for (const [index, step] of STEPS.entries()) {
    const answer = await vscode.window.showInputBox({
      title: `Bulk edit INI values (${index + 1}/${STEPS.length}): ${step.title}`,
      prompt: step.prompt,
      placeHolder: step.placeHolder,
      value: query[step.key],
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          compileBulkQuery({
            ...{ blocks: 'Object', where: '', field: 'X', formula: 'x' },
            [step.key]: value,
          });
          return undefined;
        } catch (error) {
          return error instanceof BulkQueryError ? error.message : undefined;
        }
      },
    });

    if (answer === undefined) {
      return undefined;
    }
    query[step.key] = answer;
  }
  await state.update(LAST_QUERY, query);
  return query;
};

/**
 * Registers `bigfs.bulkEditIni`. Given a query it runs without asking;
 * `confirm: false` applies it without the preview, for automation. The
 * command resolves to how many values changed.
 */
export const registerBulkEdit = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  archiveModel: ArchiveModel,
): vscode.Disposable =>
  registerCommand(
    'bigfs.bulkEditIni',
    async (given?: BulkQuery & { confirm?: boolean }) => {
      const query = given ?? (await askQuery(context.workspaceState));

      if (!query) {
        return undefined;
      }

      let compiled;

      try {
        compiled = compileBulkQuery(query);
      } catch (error) {
        void vscode.window.showErrorMessage(String((error as Error).message));
        return undefined;
      }

      const schema = await documents.getSchema();
      const files = await vscode.workspace.findFiles(
        '**/*.ini',
        '**/node_modules/**',
      );
      const edit = new vscode.WorkspaceEdit();
      const confirm = given?.confirm ?? true;
      const sources = new Map<string, BulkSource | undefined>();
      const read = async (uri: vscode.Uri) => {
        const key = uri.toString();

        if (!sources.has(key)) {
          sources.set(key, undefined);
          try {
            sources.set(key, {
              uri: key,
              document: parseSageIni(
                (await readWorkspaceText(uri)).split(/\r?\n/),
                schema,
                { isFragment: isFragmentPath(uri.path) },
              ),
            });
          } catch {
            // Unreadable or missing: an include of it simply resolves to nothing
          }
        }
        return sources.get(key);
      };
      const readIncludes = async (source: BulkSource) => {
        for (const include of source.document.includes) {
          const target = resolveIncludeUri(
            vscode.Uri.parse(source.uri),
            include.path,
          );

          if (!sources.has(target.toString())) {
            const loaded = await read(target);

            if (loaded) {
              await readIncludes(loaded);
            }
          }
        }
      };
      const roots: BulkSource[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Finding values to change',
        },
        async () => {
          const entries = await listArchiveEntries(archiveModel, /\.ini$/i);

          for (const uri of [...files, ...entries.map((entry) => entry.uri)]) {
            const source = await read(uri);

            if (source) {
              roots.push(source);
              await readIncludes(source);
            }
          }
        },
      );

      const result = planBulkChangesAcross(
        {
          sources: roots,
          include: (from, path) =>
            sources.get(
              resolveIncludeUri(vscode.Uri.parse(from.uri), path).toString(),
            ),
        },
        compiled,
      );
      // A value in a base game archive is not written: it is offered for an override
      const unwritable = result.changes.filter(
        (change) =>
          isArchiveUri(vscode.Uri.parse(change.uri)) &&
          archiveModel.isReadOnlyUri(vscode.Uri.parse(change.uri)),
      );
      const writable = result.changes.filter(
        (change) => !unwritable.includes(change),
      );
      const inArchives = writable.filter((change) =>
        isArchiveUri(vscode.Uri.parse(change.uri)),
      );
      const changed = writable.length;
      const blocks = result.blocks;
      const skipped = result.skipped;
      const touched = new Set(writable.map((change) => change.uri)).size;
      const readOnlyFiles = [
        ...new Set(unwritable.map((change) => change.uri)),
      ];

      for (const change of writable.filter(
        (each) => !inArchives.includes(each),
      )) {
        edit.replace(
          vscode.Uri.parse(change.uri),
          new vscode.Range(change.line, change.start, change.line, change.end),
          change.after,
          {
            needsConfirmation: confirm,
            label: change.block,
            description: `${change.before} → ${change.after}${change.via ? ` (${change.via})` : ''}`,
          },
        );
      }

      const summary =
        `${changed} value${changed === 1 ? '' : 's'} in ${blocks} matching block${blocks === 1 ? '' : 's'}` +
        (touched ? ` across ${touched} file${touched === 1 ? '' : 's'}` : '') +
        (result.redirected
          ? `; ${result.redirected} edited where defined (macro, included file or parent object)`
          : '') +
        (skipped ? `; ${skipped} left alone, not being numbers` : '') +
        (result.unresolved.length
          ? `; ${result.unresolved.length} cannot be edited: ${result.unresolved.slice(0, 3).join('; ')}`
          : '') +
        (unwritable.length
          ? `; ${unwritable.length} in base game archives, which are read-only`
          : '');

      if (unwritable.length) {
        void offerOverride(
          archiveModel,
          readOnlyFiles.map((uri) => vscode.Uri.parse(uri)),
          `${unwritable.length} value${unwritable.length === 1 ? '' : 's'} are defined in ${readOnlyFiles.length} base game file${readOnlyFiles.length === 1 ? '' : 's'}, which are never changed. Override them in a folder of your mod, then run the edit again.`,
        );
      }
      if (!changed) {
        void vscode.window.showInformationMessage(
          `Nothing to change: ${summary}`,
        );
        return 0;
      }

      const archives = new Set(
        inArchives.map((change) => {
          const resolved = vscode.Uri.parse(change.uri);

          return archiveModel.getNode(resolved)?.archive.name ?? change.uri;
        }),
      );

      if (confirm) {
        void vscode.window.showInformationMessage(
          `${summary}. Review them in the refactor preview, then apply.`,
        );
      }
      if (
        confirm &&
        inArchives.length &&
        (await vscode.window.showWarningMessage(
          `Save ${inArchives.length} value${inArchives.length === 1 ? '' : 's'} into ${archives.size} archive${archives.size === 1 ? '' : 's'}?`,
          {
            modal: true,
            detail: `${[...archives].join(', ')}. Each archive is rewritten once; you can undo it afterwards.`,
          },
          'Save',
        )) !== 'Save'
      ) {
        return 0;
      }
      if (inArchives.length) {
        const byEntry = new Map<string, typeof inArchives>();

        for (const change of inArchives) {
          byEntry.set(change.uri, [...(byEntry.get(change.uri) ?? []), change]);
        }

        const texts = await Promise.all(
          [...byEntry].map(async ([uri, changes]) => {
            const target = vscode.Uri.parse(uri);

            return {
              uri: target,
              text: replaceInLines(await readEntryText(target), changes),
            };
          }),
        );
        const saved = await saveEntryTexts(archiveModel, texts);

        void vscode.window
          .showInformationMessage(
            `Saved ${inArchives.length} value${inArchives.length === 1 ? '' : 's'} into ${archives.size} archive${archives.size === 1 ? '' : 's'}.`,
            'Undo',
          )
          .then(async (answer) => {
            if (answer === 'Undo') {
              await restoreEntries(archiveModel, saved);
            }
          });
      }
      if (!edit.size) {
        return changed;
      }
      await vscode.workspace.applyEdit(edit, { isRefactoring: true });
      return changed;
    },
  );
