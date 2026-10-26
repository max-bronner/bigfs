import * as vscode from 'vscode';
import { parseCsf } from '../formats/csf';
import { strRecord } from './model/sageStringRecords';
import { parseStringTable } from './model/sageStringTable';
import { languageOf, translationGaps } from './model/translations';
import type { LanguageGap, StringTable } from './model/translations';
import { readWorkspaceText } from './workspaceText';

/**
 * **Check Translations**: compares the workspace's string tables language
 * by language and reports the labels each one lacks. For a language kept
 * in a `.str` file, the missing labels can be added there with another
 * language's text standing in, so players see words instead of a missing
 * label until someone translates them. `.csf` tables are reported only;
 * the string table editor edits them.
 */

/** Where each table is, by the path the report shows */
const located = new Map<string, vscode.Uri>();

const readTables = async (): Promise<StringTable[]> => {
  const files = await vscode.workspace.findFiles(
    '**/*.{str,csf,STR,CSF}',
    '**/node_modules/**',
  );
  const tables: StringTable[] = [];

  for (const uri of files) {
    const relative = vscode.workspace.asRelativePath(uri);

    located.set(relative, uri);

    try {
      if (/\.csf$/i.test(uri.path)) {
        const csf = parseCsf(await vscode.workspace.fs.readFile(uri));

        tables.push({
          path: relative,
          language: languageOf(relative, csf.language),
          labels: new Map(
            csf.labels.map((label) => [
              label.name.toLowerCase(),
              { label: label.name, text: label.strings[0]?.text ?? '' },
            ]),
          ),
        });
      } else {
        tables.push({
          path: relative,
          language: languageOf(relative),
          labels: new Map(
            [...parseStringTable(await readWorkspaceText(uri))].map(
              ([key, { label, text }]) => [key, { label, text }],
            ),
          ),
        });
      }
    } catch {
      // A table that does not read is the validator's business, not this report's
    }
  }
  return tables;
};

const report = (gaps: LanguageGap[]): string =>
  [
    '# Translations',
    '',
    `${gaps.length} languages: ${gaps.map((gap) => `${gap.language} (${gap.missing.length} missing)`).join(', ')}.`,
    '',
    ...gaps.flatMap((gap) => [
      `## ${gap.language}: ${gap.missing.length} missing`,
      '',
      `Tables: ${gap.tables.map((table) => `\`${table}\``).join(', ')}`,
      '',
      ...(gap.missing.length
        ? gap.missing.map(
            (entry) =>
              `- \`${entry.label}\`: ${entry.from} has "${entry.text.replace(/\n/g, ' ')}"`,
          )
        : ['_nothing missing_']),
      '',
    ]),
  ].join('\n');

/** Appends a language's missing labels to its first `.str` table */
const fill = async (gap: LanguageGap, edit: vscode.WorkspaceEdit) => {
  const tablePath = gap.tables.find((table) => /\.str$/i.test(table));
  const uri = tablePath && located.get(tablePath);

  if (!uri) {
    return false;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const last = document.lineAt(document.lineCount - 1);

  edit.insert(
    uri,
    last.range.end,
    (last.text ? eol : '') +
      gap.missing
        .map((entry) => strRecord(entry.label, entry.text, eol))
        .join(''),
  );
  return true;
};

export const registerTranslationCheck = (): vscode.Disposable =>
  vscode.commands.registerCommand(
    'bigfs.checkTranslations',
    /** `fill` names the languages to fill without asking, for automation */
    async (options?: { fill?: string[] }) => {
      const gaps = translationGaps(await readTables());

      if (gaps.length < 2) {
        void vscode.window.showInformationMessage(
          gaps.length
            ? `Only ${gaps[0].language} string tables are in the workspace: nothing to compare.`
            : 'No string tables are in the workspace.',
        );
        return gaps;
      }

      const fillable = gaps.filter(
        (gap) =>
          gap.missing.length &&
          gap.tables.some((table) => /\.str$/i.test(table)),
      );
      let chosen = fillable.filter((gap) =>
        options?.fill?.includes(gap.language),
      );

      if (!options) {
        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: report(gaps),
        });

        await vscode.commands.executeCommand(
          'markdown.showPreviewToSide',
          document.uri,
        );
        if (fillable.length) {
          chosen =
            (
              await vscode.window.showQuickPick(
                fillable.map((gap) => ({
                  label: gap.language,
                  description: `${gap.missing.length} labels into ${gap.tables.find((table) => /\.str$/i.test(table))}`,
                  gap,
                })),
                {
                  canPickMany: true,
                  title:
                    "Add the missing labels, with another language's text standing in?",
                },
              )
            )?.map((item) => item.gap) ?? [];
        }
      }
      if (chosen.length) {
        const edit = new vscode.WorkspaceEdit();

        for (const gap of chosen) {
          await fill(gap, edit);
        }
        await vscode.workspace.applyEdit(edit);
      }
      return gaps;
    },
  );
