import * as vscode from 'vscode';
import {
  BulkQueryError,
  bulkChanges,
  compileBulkQuery,
} from './model/bulkEdit';
import type { BulkQuery } from './model/bulkEdit';
import { parseSageIni } from './model/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import { readWorkspaceText } from './workspaceText';

/**
 * "Bulk Edit INI Values…": asks for blocks, conditions, a field and a
 * formula, finds every matching value in the workspace's loose INI files,
 * and opens the change as a refactor preview, where each value can be
 * looked at as a diff and unticked before it is applied. Files inside
 * archives are left alone.
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

/** The four parts, asked for one after another with the last answers filled in */
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

export const registerBulkEdit = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
): vscode.Disposable =>
  vscode.commands.registerCommand(
    'bigfs.bulkEditIni',
    /**
     * With a query, runs it without asking; `confirm: false` applies it
     * without the preview, for automation. Returns how many values changed.
     */
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
      let changed = 0;
      let blocks = 0;
      let skipped = 0;
      let touched = 0;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Finding values to change',
        },
        async () => {
          for (const uri of files) {
            const result = bulkChanges(
              parseSageIni(
                (await readWorkspaceText(uri)).split(/\r?\n/),
                schema,
              ),
              compiled,
            );

            blocks += result.blocks;
            skipped += result.skipped;
            if (result.changes.length) {
              touched++;
            }
            for (const change of result.changes) {
              changed++;
              edit.replace(
                uri,
                new vscode.Range(
                  change.line,
                  change.start,
                  change.line,
                  change.end,
                ),
                change.after,
                {
                  needsConfirmation: confirm,
                  label: change.block,
                  description: `${change.before} → ${change.after}`,
                },
              );
            }
          }
        },
      );

      const summary =
        `${changed} value${changed === 1 ? '' : 's'} in ${blocks} matching block${blocks === 1 ? '' : 's'}` +
        (touched ? ` across ${touched} file${touched === 1 ? '' : 's'}` : '') +
        (skipped ? `; ${skipped} left alone, not being numbers` : '');

      if (!changed) {
        void vscode.window.showInformationMessage(
          `Nothing to change: ${summary}`,
        );
        return 0;
      }
      if (confirm) {
        void vscode.window.showInformationMessage(
          `${summary}. Review them in the refactor preview, then apply.`,
        );
      }
      await vscode.workspace.applyEdit(edit, { isRefactoring: true });
      return changed;
    },
  );
