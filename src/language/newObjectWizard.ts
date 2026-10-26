import * as vscode from 'vscode';
import { strRecord } from './model/duplicateDefinition';
import {
  buttonName,
  copiedButton,
  copiedObject,
  displayLabel,
  inheritingObject,
  slotLine,
} from './model/newObject';
import type { NewObjectMode, PlannedBlock } from './model/newObject';
import { parseSageIni, stripComment, tokenize } from './model/sageIniParser';
import type { SageBlock } from './model/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import type { SageIniIndex } from './sageIniIndex';
import { readWorkspaceText } from './workspaceText';

/**
 * "New Unit, Hero or Building…": makes a new object from an existing one
 * in one go. It asks which object to start from, the new name, whether to
 * inherit (a `ChildObject`) or copy, the name players see, and which
 * command set should build it. Then it writes the object, a copy of the
 * button that builds the original (now building the new one, with its
 * own text), the button in the next free slot of that set, and the new
 * game text in the string table the original's comes from.
 *
 * Definitions are written next to the original when it is a file in the
 * workspace, else into the INI file open in the editor or a new one. A
 * command set or string table that lives inside an archive is not edited;
 * the summary says what is left to do by hand.
 */

const TEMPLATES = ['Object', 'ChildObject', 'ObjectReskin'];
const NAME = /^[A-Za-z0-9_]+$/;

/** What the wizard asks, given up front for automation */
export interface NewObjectRequest {
  source: string;
  name: string;
  mode: NewObjectMode;
  /** The name players see */
  text: string;
  /** The command set to build it from, or none */
  commandSet?: string;
}

interface Located {
  uri: vscode.Uri;
  lines: string[];
  block: SageBlock;
  name: string;
}

const firstName = (block: SageBlock) => block.name?.split(/\s+/)[0] ?? '';

export const registerNewObjectWizard = (
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable => {
  /** The block a definition or reference sits in, parsed from its file */
  const blockAt = async (
    uri: vscode.Uri,
    line: number,
    keyword?: string,
  ): Promise<Located | undefined> => {
    const lines = (await readWorkspaceText(uri)).split(/\r?\n/);
    const block = parseSageIni(lines, await documents.getSchema()).blocks.find(
      (each) =>
        each.startLine <= line &&
        line <= each.endLine &&
        (!keyword || each.keyword.toLowerCase() === keyword.toLowerCase()),
    );

    return block && { uri, lines, block, name: firstName(block) };
  };

  const findTemplate = async (name: string) => {
    for (const keyword of TEMPLATES) {
      const [place] = index.findDefinitions(keyword, name);

      if (place) {
        return blockAt(place.uri, place.line);
      }
    }
    return undefined;
  };

  /** Buttons that build the source, and the sets that hold each */
  const buildersOf = async (source: string) => {
    const builders: { button: Located; set: Located }[] = [];

    for (const reference of index.findReferences('Object', source)) {
      const button = await blockAt(
        reference.uri,
        reference.line,
        'CommandButton',
      );

      if (!button) {
        continue;
      }
      for (const use of index.findReferences('CommandButton', button.name)) {
        const set = await blockAt(use.uri, use.line, 'CommandSet');

        if (set) {
          builders.push({ button, set });
        }
      }
    }
    return builders;
  };

  const ask = async (): Promise<NewObjectRequest | undefined> => {
    await index.whenReady();

    const names = [
      ...new Set(TEMPLATES.flatMap((keyword) => index.getNames(keyword))),
    ].sort();
    const source = (
      await vscode.window.showQuickPick(names, {
        title: 'New unit, hero or building (1/5): start from',
        placeHolder: 'The object to start from',
      })
    )?.trim();

    if (!source) {
      return undefined;
    }

    const name = await vscode.window.showInputBox({
      title: 'New unit, hero or building (2/5): name',
      prompt: "The new object's name in the INI",
      value: `${source}_New`,
      validateInput: (value) =>
        !NAME.test(value)
          ? 'One word: letters, digits and _'
          : TEMPLATES.some(
                (keyword) => index.findDefinitions(keyword, value).length,
              )
            ? `${value} exists already`
            : undefined,
    });

    if (!name) {
      return undefined;
    }

    const mode = await vscode.window.showQuickPick(
      [
        {
          label: 'Inherit',
          detail: `A ChildObject of ${source}: write only what differs, and it follows changes to ${source}`,
          mode: 'inherit' as const,
        },
        {
          label: 'Copy',
          detail: `A full copy of ${source}'s definition, independent of it`,
          mode: 'copy' as const,
        },
      ],
      { title: 'New unit, hero or building (3/5): inherit or copy' },
    );

    if (!mode) {
      return undefined;
    }

    const located = await findTemplate(source);
    const label = located?.lines
      .slice(located.block.startLine, located.block.endLine)
      .map((line) => tokenize(stripComment(line)))
      .find(
        (tokens) => tokens[0]?.text.toLowerCase() === 'displayname',
      )?.[1]?.text;
    const text = await vscode.window.showInputBox({
      title: 'New unit, hero or building (4/5): the name players see',
      value: label ? (index.findString(label)?.text ?? name) : name,
    });

    if (text === undefined) {
      return undefined;
    }

    const sets = await buildersOf(source);
    const set = await vscode.window.showQuickPick(
      [
        ...sets.map(({ button, set }) => ({
          label: set.name,
          detail: `Where ${button.name} builds ${source}`,
          set: set.name,
        })),
        { label: 'No build button', detail: '', set: undefined },
      ],
      { title: 'New unit, hero or building (5/5): built from' },
    );

    if (!set) {
      return undefined;
    }
    return { source, name, mode: mode.mode, text, commandSet: set.set };
  };

  /** Where new definitions go: beside the original, or the open INI file */
  const targetFor = (original: Located): vscode.Uri | undefined => {
    if (original.uri.scheme === 'file') {
      return original.uri;
    }

    const open = vscode.window.activeTextEditor?.document;

    return open?.languageId === 'sage-ini' && open.uri.scheme === 'file'
      ? open.uri
      : undefined;
  };

  const create = async (request: NewObjectRequest) => {
    await index.whenReady();

    const original = await findTemplate(request.source);

    if (!original) {
      throw new Error(`${request.source} is not defined anywhere indexed`);
    }

    const left: string[] = [];
    const edit = new vscode.WorkspaceEdit();
    const blocks: PlannedBlock[] = [
      request.mode === 'inherit'
        ? inheritingObject(request.name, original.name)
        : copiedObject(
            original.lines,
            original.block.startLine,
            original.block.endLine,
            request.name,
          ),
    ];

    if (request.commandSet) {
      const builder = (await buildersOf(request.source)).find(
        ({ set }) =>
          set.name.toLowerCase() === request.commandSet!.toLowerCase(),
      );

      if (!builder) {
        throw new Error(
          `No button in ${request.commandSet} builds ${request.source}`,
        );
      }

      const newButton = buttonName(
        builder.button.name,
        request.source,
        request.name,
      );

      blocks.push(
        copiedButton(
          builder.button.lines,
          builder.button.block.startLine,
          builder.button.block.endLine,
          newButton,
          request.name,
        ),
      );
      if (builder.set.uri.scheme === 'file') {
        const slot = slotLine(
          builder.set.lines.slice(
            builder.set.block.startLine,
            builder.set.block.endLine + 1,
          ),
          newButton,
        );

        edit.insert(
          builder.set.uri,
          new vscode.Position(builder.set.block.startLine + slot.line, 0),
          `${slot.text}\n`,
        );
      } else {
        left.push(
          `add ${newButton} to ${builder.set.name}, which is inside an archive`,
        );
      }
    }

    // The text players see, and the copies of every renamed label's text
    const texts = [
      {
        from: undefined as string | undefined,
        to: displayLabel(request.name),
        text: request.text,
      },
      ...blocks.flatMap((block) =>
        block.labels.map((label) => ({
          from: label.from,
          to: label.to,
          text: index.findString(label.from)?.text ?? '',
        })),
      ),
    ].filter(
      (entry, at, all) =>
        !index.findString(entry.to) &&
        all.findIndex((other) => other.to === entry.to) === at,
    );
    const sourceLabel = original.lines
      .slice(original.block.startLine, original.block.endLine)
      .map((line) => tokenize(stripComment(line)))
      .find(
        (tokens) => tokens[0]?.text.toLowerCase() === 'displayname',
      )?.[1]?.text;

    // One insert per table: several at one position are refused as overlapping
    const records = new Map<string, { uri: vscode.Uri; text: string[] }>();

    for (const entry of texts) {
      const table = index.findString(entry.from ?? sourceLabel ?? '');

      if (
        table &&
        table.uri.scheme === 'file' &&
        /\.str$/i.test(table.uri.path)
      ) {
        const key = table.uri.toString();
        const record = records.get(key) ?? { uri: table.uri, text: [] };

        record.text.push(strRecord(entry.to, entry.text, '\n'));
        records.set(key, record);
      } else {
        left.push(`add ${entry.to} ("${entry.text}") to your string table`);
      }
    }
    for (const { uri, text } of records.values()) {
      const document = await vscode.workspace.openTextDocument(uri);
      const end = document.lineAt(document.lineCount - 1);

      edit.insert(uri, end.range.end, (end.text ? '\n' : '') + text.join(''));
    }

    const target = targetFor(original);
    const text = blocks.map((block) => block.lines.join('\n')).join('\n\n');

    if (target) {
      const document = await vscode.workspace.openTextDocument(target);
      const at =
        target.toString() === original.uri.toString()
          ? document.lineAt(original.block.endLine).range.end
          : document.lineAt(document.lineCount - 1).range.end;

      edit.insert(target, at, `\n\n${text}`);
    } else {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const file = await vscode.window.showSaveDialog({
        title: `Where to write ${request.name}`,
        defaultUri:
          folder && vscode.Uri.joinPath(folder, `${request.name}.ini`),
        filters: { INI: ['ini'] },
      });

      if (!file) {
        return undefined;
      }
      edit.createFile(file, { overwrite: false, ignoreIfExists: true });
      edit.insert(file, new vscode.Position(0, 0), `${text}\n`);
    }

    if (!(await vscode.workspace.applyEdit(edit))) {
      throw new Error(`${request.name} could not be written`);
    }
    if (left.length) {
      void vscode.window.showWarningMessage(
        `${request.name} created. Left to do: ${left.join('; ')}.`,
      );
    }
    return { name: request.name, left };
  };

  return vscode.commands.registerCommand(
    'bigfs.newObject',
    async (given?: NewObjectRequest) => {
      const request = given ?? (await ask());

      if (!request) {
        return undefined;
      }
      try {
        return await create(request);
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
        return undefined;
      }
    },
  );
};
