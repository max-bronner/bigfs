import * as vscode from 'vscode';
import { parseCsf } from '../../formats/csf/csf';
import { formatStrRecord } from '../../formats/str/sageStringRecords';
import { parseStringTable } from '../../formats/str/sageStringTable';
import { findLabelsInText } from '../../game/text/gameTextLabels';
import { getArchiveLanguage } from '../../game/text/gameLanguage';
import {
  detectTableLanguage,
  findTranslationGaps,
  findUndefinedLabels,
} from '../../game/text/translations';
import type {
  LanguageGap,
  StringTable,
  UndefinedLabel,
} from '../../game/text/translations';
import {
  isArchiveUri,
  listArchiveEntries,
  offerOverride,
  readEntryText,
  saveEntryTexts,
} from '../../services/ini/archiveText';
import { decodeIniText } from '../../core/windows1252';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { registerCommand } from '../../platform/commands';

/**
 * **Check Translations**: compares the workspace's string tables language
 * by language and reports the labels each one lacks. For a language kept
 * in a `.str` file, the missing labels can be added there with another
 * language's text standing in, so players see words instead of a missing
 * label until someone translates them. `.csf` tables are reported only;
 * the string table editor edits them.
 *
 * Tables are read from loose files and from inside archives. A `.str` in a
 * writable archive is filled like a loose one, saved with its archive once;
 * a table in a base game archive is compared but never written, and is
 * offered for "Override in Folder". The INI files, loose and in archives, are
 * read for the game text they use, and the labels no table defines are
 * reported as missing strings.
 */

/** Where each table is, by the path the report shows */
const located = new Map<string, { uri: vscode.Uri; readOnly: boolean }>();

/** A string table to read, loose or inside an archive */
interface TableSource {
  uri: vscode.Uri;
  /** The path the report shows */
  path: string;
  /** The language its archive is named for, if it is a language archive */
  archiveLanguage?: string;
  readOnly: boolean;
}

const listTableSources = async (
  archiveModel: ArchiveModel,
): Promise<TableSource[]> => {
  const files = await vscode.workspace.findFiles(
    '**/*.{str,csf,STR,CSF}',
    '**/node_modules/**',
  );
  const entries = await listArchiveEntries(archiveModel, /\.(?:str|csf)$/i);

  return [
    ...files.map((uri) => ({
      uri,
      path: vscode.workspace.asRelativePath(uri),
      readOnly: false,
    })),
    ...entries.map((entry) => ({
      uri: entry.uri,
      path: `${entry.archivePath.split(/[\\/]/).pop()}/${entry.uri.path.split('/').slice(2).join('/')}`,
      archiveLanguage: getArchiveLanguage(entry.archivePath),
      readOnly: entry.readOnly,
    })),
  ];
};

const readTables = async (
  archiveModel: ArchiveModel,
): Promise<StringTable[]> => {
  const tables: StringTable[] = [];

  located.clear();
  for (const {
    uri,
    path: relative,
    archiveLanguage,
    readOnly,
  } of await listTableSources(archiveModel)) {
    located.set(relative, { uri, readOnly });

    try {
      if (/\.csf$/i.test(uri.path)) {
        const csf = parseCsf(await vscode.workspace.fs.readFile(uri));

        tables.push({
          path: relative,
          language: archiveLanguage ?? detectTableLanguage(relative, csf.language),
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
          language: archiveLanguage ?? detectTableLanguage(relative),
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

/** Collects the labels the INI files, loose and in archives, use, with the first file using each */
const collectUsedLabels = async (
  archiveModel: ArchiveModel,
): Promise<Map<string, { label: string; usedIn: string }>> => {
  const used = new Map<string, { label: string; usedIn: string }>();
  const files = await vscode.workspace.findFiles(
    '**/*.{ini,INI}',
    '**/node_modules/**',
  );
  const entries = await listArchiveEntries(archiveModel, /\.ini$/i);

  for (const uri of [...files, ...entries.map((entry) => entry.uri)]) {
    try {
      const text = isArchiveUri(uri)
        ? decodeIniText(await vscode.workspace.fs.readFile(uri))
        : await readWorkspaceText(uri);

      for (const label of findLabelsInText(text)) {
        const key = label.toLowerCase();

        if (!used.has(key)) {
          used.set(key, {
            label,
            usedIn: isArchiveUri(uri)
              ? uri.path.split('/').slice(2).join('/')
              : vscode.workspace.asRelativePath(uri),
          });
        }
      }
    } catch {
      // A file that does not read is the validator's business, not this report's
    }
  }
  return used;
};

const report = (
  gaps: LanguageGap[],
  undefinedStrings: UndefinedLabel[],
): string =>
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
    `## Used by INI, defined nowhere: ${undefinedStrings.length}`,
    '',
    ...(undefinedStrings.length
      ? undefinedStrings.map(
          (entry) => `- \`${entry.label}\`: first used in \`${entry.usedIn}\``,
        )
      : ['_nothing missing_']),
    '',
  ].join('\n');

/** Finds the first `.str` table of a gap that may be written to */
const findEditableTable = (gap: LanguageGap): string | undefined =>
  gap.tables.find(
    (table) => /\.str$/i.test(table) && !located.get(table)?.readOnly,
  );

/** Appends a language's missing labels to its first writable `.str` table */
const fill = async (
  gap: LanguageGap,
  edit: vscode.WorkspaceEdit,
  archiveTexts: { uri: vscode.Uri; text: string }[],
) => {
  const tablePath = findEditableTable(gap);
  const uri = tablePath && located.get(tablePath)?.uri;

  if (!uri) {
    return false;
  }

  if (isArchiveUri(uri)) {
    const before = await readEntryText(uri);
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    const earlier = archiveTexts.find(
      (each) => each.uri.toString() === uri.toString(),
    );
    const text = earlier?.text ?? before;
    const records = gap.missing
      .map((entry) => formatStrRecord(entry.label, entry.text, eol))
      .join('');
    const filled = text + (text && !/\n$/.test(text) ? eol : '') + records;

    if (earlier) {
      earlier.text = filled;
    } else {
      archiveTexts.push({ uri, text: filled });
    }
    return true;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const last = document.lineAt(document.lineCount - 1);

  edit.insert(
    uri,
    last.range.end,
    (last.text ? eol : '') +
      gap.missing
        .map((entry) => formatStrRecord(entry.label, entry.text, eol))
        .join(''),
  );
  return true;
};

/**
 * Registers `bigfs.checkTranslations`, which resolves to the gaps it found.
 * Given options it shows no report and fills only the languages `fill`
 * names, for automation.
 */
export const registerTranslationCheck = (
  archiveModel: ArchiveModel,
): vscode.Disposable =>
  registerCommand(
    'bigfs.checkTranslations',
    async (options?: { fill?: string[] }) => {
      const tables = await readTables(archiveModel);
      const gaps = findTranslationGaps(tables);
      const undefinedStrings = findUndefinedLabels(
        await collectUsedLabels(archiveModel),
        tables,
      );

      if (gaps.length < 2) {
        void vscode.window.showInformationMessage(
          gaps.length
            ? `Only ${gaps[0].language} string tables are in the workspace: nothing to compare.`
            : 'No string tables are in the workspace.',
        );
        return gaps;
      }

      const fillable = gaps.filter(
        (gap) => gap.missing.length && findEditableTable(gap),
      );
      const readOnlyTables = gaps
        .filter((gap) => gap.missing.length && !findEditableTable(gap))
        .flatMap((gap) => gap.tables)
        .filter((table) => located.get(table)?.readOnly);
      let chosen = fillable.filter((gap) =>
        options?.fill?.includes(gap.language),
      );

      if (!options) {
        const document = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content: report(gaps, undefinedStrings),
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
                  description: `${gap.missing.length} labels into ${findEditableTable(gap)}`,
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
        const archiveTexts: { uri: vscode.Uri; text: string }[] = [];

        for (const gap of chosen) {
          await fill(gap, edit, archiveTexts);
        }
        if (archiveTexts.length) {
          await saveEntryTexts(archiveModel, archiveTexts);
        }
        await vscode.workspace.applyEdit(edit);
      }
      if (!options && readOnlyTables.length) {
        void offerOverride(
          archiveModel,
          readOnlyTables.flatMap((table) => located.get(table)?.uri ?? []),
          `${readOnlyTables.length} string table${readOnlyTables.length === 1 ? ' lacks' : 's lack'} labels but ${readOnlyTables.length === 1 ? 'is' : 'are'} in base game archives, which are never changed.`,
        );
      }
      return gaps;
    },
  );
