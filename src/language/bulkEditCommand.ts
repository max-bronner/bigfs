import * as vscode from 'vscode';
import {
  BulkQueryError,
  bulkChangesAcross,
  compileBulkQuery,
} from './model/bulkEdit';
import type { BulkQuery, BulkSource } from './model/bulkEdit';
import { isFragmentPath, parseSageIni } from './model/sageIniParser';
import { resolveIncludeUri } from './sageIniInclude';
import type { SageIniDocuments } from './sageIniDocuments';
import { readWorkspaceText } from './workspaceText';

/**
 * "Bulk Edit INI Values…": asks for blocks, conditions, a field and a
 * formula, finds every matching value in the workspace's loose INI files,
 * and opens the change as a refactor preview, where each value can be
 * looked at as a diff and unticked before it is applied. A value written as
 * a macro, in an included file or inherited from a parent object is edited
 * where it is defined; one that cannot be is reported. Files inside archives
 * are left alone.
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
      const includesOf = async (source: BulkSource) => {
        for (const include of source.document.includes) {
          const target = resolveIncludeUri(
            vscode.Uri.parse(source.uri),
            include.path,
          );

          if (!sources.has(target.toString())) {
            const loaded = await read(target);

            if (loaded) {
              await includesOf(loaded);
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
          for (const uri of files) {
            const source = await read(uri);

            if (source) {
              roots.push(source);
              await includesOf(source);
            }
          }
        },
      );

      const result = bulkChangesAcross(
        {
          sources: roots,
          include: (from, path) =>
            sources.get(
              resolveIncludeUri(vscode.Uri.parse(from.uri), path).toString(),
            ),
        },
        compiled,
      );
      const changed = result.changes.length;
      const blocks = result.blocks;
      const skipped = result.skipped;
      const touched = new Set(result.changes.map((change) => change.uri)).size;

      for (const change of result.changes) {
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
          : '');

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
