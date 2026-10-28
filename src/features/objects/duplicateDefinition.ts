import * as vscode from 'vscode';
import { duplicateDefinition, strRecord } from '../../game/objects/duplicateDefinition';
import type { SageBlock } from '../../formats/ini/sageIniParser';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';

/**
 * "Duplicate Definition…": copies the file-scope block at the cursor under a
 * new name, below the original. Game-text labels inside that carry the old
 * name are renamed in the copy, and each gets its own record, with the
 * original's text, in the string table that holds the original's.
 */

const NAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

const blockAt = (blocks: SageBlock[], line: number) =>
  blocks.find((block) => block.startLine <= line && line <= block.endLine);

export interface DuplicateResult {
  name: string;
  line: number;
  labels: string[];
}

const duplicate = async (
  documents: SageIniDocuments,
  index: SageIniIndex,
  uri: vscode.Uri,
  line: number,
  givenName?: string,
): Promise<DuplicateResult | undefined> => {
  const document = await vscode.workspace.openTextDocument(uri);
  const parsed = await documents.parse(document);
  const block = blockAt(parsed.blocks, line);

  if (!block?.name || !block.isClosed) {
    void vscode.window.showInformationMessage(
      'Put the cursor in a definition that ends with End',
    );
    return undefined;
  }

  const oldName = block.name.split(/\s+/)[0];
  const newName =
    givenName ??
    (await vscode.window.showInputBox({
      prompt: `New name for the copy of ${block.keyword} ${oldName}`,
      value: `${oldName}_Copy`,
      validateInput: (value) =>
        !NAME_PATTERN.test(value)
          ? 'One word: letters, digits, _ . -'
          : index.findDefinitions(block.keyword, value).length
            ? `A ${block.keyword} named ${value} exists already`
            : undefined,
    }));

  if (!newName) {
    return undefined;
  }

  const lines = Array.from(
    { length: document.lineCount },
    (_, number) => document.lineAt(number).text,
  );
  const copy = duplicateDefinition(
    lines,
    block.startLine,
    block.endLine,
    newName,
  );
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const edit = new vscode.WorkspaceEdit();
  const at = document.lineAt(block.endLine).range.end;

  edit.insert(uri, at, `${eol}${copy.lines.join(eol)}`);

  // Each renamed label gets the original's text in the original's table
  const added: string[] = [];
  const tables = new Map<string, vscode.TextDocument>();

  for (const label of copy.labels) {
    const original = index.findString(label.from);

    if (
      !original ||
      !/\.str$/i.test(original.uri.path) ||
      index.findString(label.to)
    ) {
      continue;
    }

    const key = original.uri.toString();
    let table = tables.get(key);

    if (!table) {
      table = await vscode.workspace.openTextDocument(original.uri);
      tables.set(key, table);
    }

    const tableEol = table.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const end = table.lineAt(table.lineCount - 1).range.end;
    const lead = table.lineAt(table.lineCount - 1).text ? tableEol : '';

    edit.insert(
      original.uri,
      end,
      lead + strRecord(label.to, original.text, tableEol),
    );
    added.push(label.to);
  }

  await vscode.workspace.applyEdit(edit);

  const newLine = block.endLine + 1;
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(newLine, 0);

  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
  if (added.length) {
    void vscode.window.showInformationMessage(
      `${newName} added; its text ${added.join(', ')} copied into the string table`,
    );
  }
  return { name: newName, line: newLine, labels: added };
};

/** Offers the duplicate on any file-scope definition the cursor is in */
class DuplicateActionProvider implements vscode.CodeActionProvider {
  public constructor(private readonly documents: SageIniDocuments) {}

  public async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const parsed = await this.documents.parse(document);
    const block = blockAt(parsed.blocks, range.start.line);

    if (!block?.name || !block.isClosed) {
      return [];
    }

    const action = new vscode.CodeAction(
      `Duplicate ${block.keyword} ${block.name.split(/\s+/)[0]}…`,
      vscode.CodeActionKind.Refactor,
    );

    action.command = {
      title: action.title,
      command: 'bigfs.duplicateDefinition',
      arguments: [document.uri, block.startLine],
    };
    return [action];
  }
}

export const registerDuplicateDefinition = (
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable[] => [
  vscode.languages.registerCodeActionsProvider(
    selector,
    new DuplicateActionProvider(documents),
    { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] },
  ),
  vscode.commands.registerCommand(
    'bigfs.duplicateDefinition',
    (uri?: vscode.Uri, line?: number, name?: string) => {
      const editor = vscode.window.activeTextEditor;
      const target = uri ?? editor?.document.uri;

      if (!target) {
        return undefined;
      }
      return duplicate(
        documents,
        index,
        target,
        line ?? editor?.selection.active.line ?? 0,
        name,
      );
    },
  ),
];
