import {
  CodeAction,
  CodeActionKind,
  Range,
  WorkspaceEdit,
  workspace,
} from 'vscode';
import type { Uri } from 'vscode';
import type { CodeActionProvider, Diagnostic, TextDocument } from 'vscode';
import type { SageIniDocuments } from '../sageIniDocuments';
import type { SageIniIndex } from '../sageIniIndex';
import { closestNames, missingEndLine } from '../../formats/ini/sageIniFormat';
import {
  findGameTextLabels,
  labelOfMissingText,
  placeholderText,
} from '../model/gameTextLabels';
import { strRecord } from '../../formats/str/sageStringRecords';
import type { SageDocument } from '../../formats/ini/sageIniParser';
import {
  isMissingAssetMessage,
  suggestedAssetNames,
} from '../../formats/ini/sageIniAssets';

/**
 * Quick fixes for the problems the diagnostics report: add a missing `End`,
 * remove a stray one, and replace an unknown keyword or an unresolved name
 * with the close ones the game does know.
 */
/**
 * The string table a new label belongs in: the one holding the labels this
 * file already uses, else the first one in the workspace folders
 */
const stringTableFor = async (
  parsed: SageDocument,
  index: SageIniIndex,
): Promise<Uri | undefined> => {
  for (const label of findGameTextLabels(parsed)) {
    const place = index.findString(label.text);

    if (place && /\.str$/i.test(place.uri.path)) {
      return place.uri;
    }
  }

  const [loose] = await workspace.findFiles('**/*.{str,STR}', undefined, 1);

  return loose;
};

export const createSageIniCodeActionProvider = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): CodeActionProvider => ({
  async provideCodeActions(document: TextDocument, _range: Range, context) {
    const ours = context.diagnostics.filter(
      (diagnostic) =>
        diagnostic.source === 'bigFS' ||
        (diagnostic.source === 'bigFS validation' &&
          isMissingAssetMessage(diagnostic.message)),
    );

    if (!ours.length) {
      return [];
    }

    const [parsed, schema] = await Promise.all([
      documents.parse(document),
      documents.getSchema(),
    ]);
    const lines = Array.from(
      { length: document.lineCount },
      (_, line) => document.lineAt(line).text,
    );
    const actions: CodeAction[] = [];
    const fix = (
      title: string,
      diagnostic: Diagnostic,
      build: (edit: WorkspaceEdit) => void,
      preferred = false,
    ) => {
      const action = new CodeAction(title, CodeActionKind.QuickFix);
      const edit = new WorkspaceEdit();

      build(edit);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      action.isPreferred = preferred;
      actions.push(action);
    };

    for (const diagnostic of ours) {
      const line = diagnostic.range.start.line;
      const message = diagnostic.message;

      if (message.endsWith('is never closed with End')) {
        const at = missingEndLine(lines, line);
        const indent = lines[line].slice(
          0,
          lines[line].length - lines[line].trimStart().length,
        );
        const eol = document.eol === 2 ? '\r\n' : '\n';

        fix(
          'Add the missing End',
          diagnostic,
          (edit) =>
            at >= lines.length
              ? edit.insert(
                  document.uri,
                  document.lineAt(lines.length - 1).range.end,
                  `${eol}${indent}End`,
                )
              : edit.insert(
                  document.uri,
                  document.lineAt(at).range.start,
                  `${indent}End${eol}`,
                ),
          true,
        );
      } else if (message === 'End with no block open to close') {
        fix(
          'Remove this End',
          diagnostic,
          (edit) =>
            edit.delete(
              document.uri,
              document.lineAt(line).rangeIncludingLineBreak,
            ),
          true,
        );
      } else if (message.includes('is not a block or field')) {
        const statement = parsed.statements.find(
          (candidate) => candidate.line === line,
        );

        if (statement) {
          const known = schema
            .getContextKeywords(statement.context)
            .map((keyword) => keyword.name);

          for (const name of closestNames(statement.keyword.text, known)) {
            fix(`Change to '${name}'`, diagnostic, (edit) =>
              edit.replace(document.uri, diagnostic.range, name),
            );
          }
        }
      } else if (isMissingAssetMessage(message)) {
        suggestedAssetNames(message).forEach((name, place) =>
          fix(
            `Change to '${name}'`,
            diagnostic,
            (edit) => edit.replace(document.uri, diagnostic.range, name),
            place === 0,
          ),
        );
      } else if (labelOfMissingText(message)) {
        const label = labelOfMissingText(message)!;
        const table = await stringTableFor(parsed, index);

        if (table) {
          const target = await workspace.openTextDocument(table);
          const eol = target.eol === 2 ? '\r\n' : '\n';
          const last = target.lineAt(target.lineCount - 1);
          const name = table.path.slice(table.path.lastIndexOf('/') + 1);

          fix(
            `Add '${label}' to ${name}`,
            diagnostic,
            (edit) =>
              edit.insert(
                table,
                last.range.end,
                (last.text ? eol : '') +
                  strRecord(label, placeholderText(label), eol),
              ),
            true,
          );
        }
      } else {
        const unresolved = /^No (.+) named '(.+)' is defined/.exec(message);

        if (unresolved) {
          const names = unresolved[1]
            .split(' or ')
            .flatMap((namespace) => index.getNames(namespace));

          for (const name of closestNames(unresolved[2], names)) {
            fix(`Change to '${name}'`, diagnostic, (edit) =>
              edit.replace(document.uri, diagnostic.range, name),
            );
          }
        }
      }
    }

    return actions;
  },
});

export const SAGE_INI_CODE_ACTION_KINDS = [CodeActionKind.QuickFix];
