import * as vscode from 'vscode';
import { strRecord } from '../../game/objects/duplicateDefinition';
import {
  buttonName,
  copiedButton,
  copiedObject,
  displayLabel,
  inheritingObject,
  isLoadedObjectPath,
  newObjectEntryPath,
  slotLine,
} from '../../game/objects/newObject';
import type { NewObjectMode, PlannedBlock } from '../../game/objects/newObject';
import { parseSageIni, stripComment, tokenize } from '../../formats/ini/sageIniParser';
import type { SageBlock } from '../../formats/ini/sageIniParser';
import { insertLines, lineEndOf } from '../../formats/ini/iniTextEdits';
import type { LineInsertion } from '../../formats/ini/iniTextEdits';
import {
  isArchiveUri,
  isEditable,
  readEntryText,
  saveEntryTexts,
} from '../../services/ini/archiveText';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { readWorkspaceText } from '../../services/ini/workspaceText';

/**
 * "New Unit, Hero or Building…": makes a new object from an existing one
 * in one go. It asks which object to start from, the new name, whether to
 * inherit (a `ChildObject`) or copy, the name players see, and which
 * command set should build it. Then it writes the object, a copy of the
 * button that builds the original (now building the new one, with its
 * own text), the button in the next free slot of that set, and the new
 * game text in the string table the original's comes from.
 *
 * Definitions are written next to the original when it is a file the game
 * loads, in the workspace or in a writable archive; else into a file of
 * their own in `Data\INI\Object`, which the game reads, in the original's
 * archive or in a folder of the workspace. A command set or string table in
 * a base game archive is not edited, since those are never written; the
 * summary says what is left to do, and that Override in Folder makes the
 * file editable.
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

/** Text added to an entry of an archive, applied when its archive is saved */
interface EntryAdditions {
  uri: vscode.Uri;
  insertions: LineInsertion[];
  /** Appended as is, for string table records that carry their own line ends */
  raw: string[];
}

const OBJECT_ENTRY = /^(.*\/)?(data\/ini\/object\/(?:.+\/)?[^/]+\.ini)$/i;

export const registerNewObjectWizard = (
  documents: SageIniDocuments,
  index: SageIniIndex,
  archiveModel: ArchiveModel,
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

  /**
   * Where the new definitions go, always at a path the game loads: the
   * original's own file when that is one, else `Data\INI\Object\<name>.ini`
   * beside it in the same archive or mod folder. Nothing is written to a base
   * game archive, so a new file for one goes to a folder of the workspace.
   */
  const targetFor = async (
    original: Located,
    name: string,
    left: string[],
  ): Promise<{ uri: vscode.Uri; sameFile: boolean } | undefined> => {
    const uri = original.uri;

    if (isArchiveUri(uri) && !archiveModel.isReadOnlyUri(uri)) {
      const node = archiveModel.getNode(uri);

      if (node) {
        const entry = newObjectEntryPath(node.entryPath, name);

        return {
          uri:
            entry.toLowerCase() === node.entryPath.toLowerCase()
              ? uri
              : uri.with({ path: `${node.archive.rootPath}/${entry}` }),
          sameFile: entry.toLowerCase() === node.entryPath.toLowerCase(),
        };
      }
    }

    const loaded = !isArchiveUri(uri) && OBJECT_ENTRY.exec(uri.path);

    if (loaded && isLoadedObjectPath(loaded[2])) {
      return { uri, sameFile: true };
    }

    const folder =
      (!isArchiveUri(uri) && vscode.workspace.getWorkspaceFolder(uri)?.uri) ||
      (vscode.workspace.workspaceFolders?.length === 1
        ? vscode.workspace.workspaceFolders[0].uri
        : (
            await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              openLabel: 'Write Here',
              title: `Folder of the mod to write ${name} into`,
            })
          )?.[0]);

    if (!folder) {
      return undefined;
    }
    if (isArchiveUri(uri)) {
      left.push(
        `${original.name} is in a base game archive, which is never changed: ${name} was written to ${newObjectEntryPath(undefined, name)} in ${folder.fsPath}`,
      );
    }
    return {
      uri: vscode.Uri.joinPath(
        folder,
        ...newObjectEntryPath(undefined, name).split('/'),
      ),
      sameFile: false,
    };
  };

  const create = async (request: NewObjectRequest) => {
    await index.whenReady();

    const original = await findTemplate(request.source);

    if (!original) {
      throw new Error(`${request.source} is not defined anywhere indexed`);
    }

    const left: string[] = [];
    const edit = new vscode.WorkspaceEdit();
    const additions = new Map<string, EntryAdditions>();
    const additionsTo = (uri: vscode.Uri) => {
      const key = uri.toString();
      const found = additions.get(key) ?? { uri, insertions: [], raw: [] };

      additions.set(key, found);
      return found;
    };
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
      if (isEditable(archiveModel, builder.set.uri)) {
        const slot = slotLine(
          builder.set.lines.slice(
            builder.set.block.startLine,
            builder.set.block.endLine + 1,
          ),
          newButton,
        );
        const line = builder.set.block.startLine + slot.line;

        if (isArchiveUri(builder.set.uri)) {
          additionsTo(builder.set.uri).insertions.push({
            line,
            lines: [slot.text],
          });
        } else {
          edit.insert(
            builder.set.uri,
            new vscode.Position(line, 0),
            `${slot.text}\n`,
          );
        }
      } else {
        left.push(
          `add ${newButton} to ${builder.set.name}, which is in a base game archive (Override in Folder makes it editable)`,
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
        isEditable(archiveModel, table.uri) &&
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
      if (isArchiveUri(uri)) {
        additionsTo(uri).raw.push(...text);
        continue;
      }

      const document = await vscode.workspace.openTextDocument(uri);
      const end = document.lineAt(document.lineCount - 1);

      edit.insert(uri, end.range.end, (end.text ? '\n' : '') + text.join(''));
    }

    const target = await targetFor(original, request.name, left);

    if (!target) {
      return undefined;
    }

    const text = blocks.map((block) => block.lines.join('\n')).join('\n\n');

    if (isArchiveUri(target.uri)) {
      additionsTo(target.uri).insertions.push(
        target.sameFile
          ? {
              line: original.block.endLine + 1,
              lines: ['', ...text.split('\n')],
            }
          : { lines: text.split('\n') },
      );
    } else if (target.sameFile) {
      const document = await vscode.workspace.openTextDocument(target.uri);

      edit.insert(
        target.uri,
        document.lineAt(original.block.endLine).range.end,
        `\n\n${text}`,
      );
    } else {
      let exists = true;

      try {
        await vscode.workspace.fs.stat(target.uri);
      } catch {
        exists = false;
      }
      if (exists) {
        const document = await vscode.workspace.openTextDocument(target.uri);

        edit.insert(
          target.uri,
          document.lineAt(document.lineCount - 1).range.end,
          `\n\n${text}`,
        );
      } else {
        edit.createFile(target.uri, { overwrite: false, ignoreIfExists: true });
        edit.insert(target.uri, new vscode.Position(0, 0), `${text}\n`);
      }
    }

    // Every changed entry of an archive is built here and saved with its archive once
    const saves: { uri: vscode.Uri; text: string }[] = [];

    for (const { uri, insertions, raw } of additions.values()) {
      let before = '';

      try {
        before = await readEntryText(uri);
      } catch {
        // A new entry in the archive
      }

      const eol = lineEndOf(before);
      const inserted = insertions.length
        ? insertLines(before, insertions)
        : before;

      saves.push({
        uri,
        text: raw.length
          ? inserted +
            (inserted && !/\n$/.test(inserted) ? eol : '') +
            raw.join('').replace(/\r?\n/g, eol)
          : inserted,
      });
    }
    if (saves.length) {
      await saveEntryTexts(archiveModel, saves);
    }
    if (!edit.size) {
      if (left.length) {
        void vscode.window.showWarningMessage(
          `${request.name} created. Left to do: ${left.join('; ')}.`,
        );
      }
      return { name: request.name, left };
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
