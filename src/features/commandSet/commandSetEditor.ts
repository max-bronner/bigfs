import * as vscode from 'vscode';
import { renderWebviewPage } from '../../platform/webview/webviewPage';
import { createSingletonPanel } from '../../platform/webview/singletonPanel';
import type { EntryLocator } from '../../services/entryLocator';
import {
  readCommandSetSlots,
  createLineReader,
  resolveSlots,
} from '../../services/ini/commandSetPreview';
import { createMappedImagePreview } from '../../services/mappedImagePreview';
import { findHotkeyClashes } from '../../game/ini-tools/hotkeys';
import {
  readCommandSetName,
  moveSlot,
  hasSameSlots,
  buildSlotEdits,
} from '../../game/objects/commandSetEdit';
import type {
  CommandSetMessage,
  FromCommandSetPage,
} from '../../game/objects/commandSetEdit';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import type { SageIniDocuments } from '../../services/ini/sageIniDocuments';
import type { SageIniIndex } from '../../services/ini/sageIniIndex';
import { readWorkspaceText } from '../../services/ini/workspaceText';
import { registerCommand } from '../../platform/commands';

/**
 * The CommandSet editor: a set's buttons in their slots, as the player sees
 * them, with icon, game text and hotkey, clashing hotkeys marked. Drag a
 * button to another slot (swapping with what is there), clear a slot, or
 * add a button to an empty one; every change rewrites the set's slot lines.
 */

const COLUMNS = 5;

/** Creates the editor of one CommandSet; `onClose` runs when its panel is closed */
const createCommandSetEditor = (
  context: vscode.ExtensionContext,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
  uri: vscode.Uri,
  name: string,
  onClose: () => void,
) => {
  const icon = locator && createMappedImagePreview(locator);
  const scripts = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  let slots = new Map<number, string>();

  const panel = createSingletonPanel<FromCommandSetPage, CommandSetMessage>({
    viewType: 'bigfs.commandSet',
    title: `CommandSet: ${name}`,
    column: vscode.ViewColumn.Beside,
    options: {
      enableScripts: true,
      localResourceRoots: [scripts],
      retainContextWhenHidden: true,
    },
    render: ({ webview }) => {
      webview.html = renderWebviewPage({
        allow: { img: 'data:', script: webview.cspSource },
        scriptFiles: [
          webview
            .asWebviewUri(vscode.Uri.joinPath(scripts, 'commandset.js'))
            .toString(),
        ],
        style: `
body { color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); padding: 8px 12px; }
#grid { display: grid; grid-template-columns: repeat(${COLUMNS}, 112px); gap: 6px; }
.slot { border: 1px solid var(--vscode-panel-border, #555); border-radius: 3px; min-height: 92px; padding: 4px; position: relative; font-size: 11px; text-align: center; }
.slot.empty { opacity: 0.55; border-style: dashed; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.slot.over { outline: 2px solid var(--vscode-focusBorder, #007fd4); }
.slot .number { position: absolute; left: 4px; top: 2px; opacity: 0.6; }
.slot .clear { position: absolute; right: 2px; top: 0; cursor: pointer; opacity: 0.6; border: none; background: none; color: inherit; }
.slot img { width: 48px; height: 48px; image-rendering: auto; display: block; margin: 8px auto 2px; }
.slot .noicon { width: 48px; height: 48px; margin: 8px auto 2px; background: var(--vscode-editorWidget-background, #333); }
.slot .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slot .command { opacity: 0.6; font-size: 10px; }
.slot.undefined .text { color: var(--vscode-errorForeground, #f66); }
.clash { color: var(--vscode-editorWarning-foreground, #cca700); font-weight: 600; }
.muted { opacity: 0.7; }
`,
        body: '<p class="muted">Drag a button to another slot to move it (it swaps with what is there); click an empty slot to add one; click a name to open it.</p><div id="grid"></div>',
      });
      return [
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.document.uri.toString() === uri.toString()) {
            void refresh();
          }
        }),
      ];
    },
    onMessage: (message) => receive(message),
    onDispose: onClose,
  });

  /** Reads the set's block, and the file's lines, as the file has them now */
  const readBlock = async () => {
    const lines = (await readWorkspaceText(uri)).split(/\r?\n/);
    const block = parseSageIni(lines, await documents.getSchema()).blocks.find(
      (each) =>
        each.keyword.toLowerCase() === 'commandset' &&
        each.name?.split(/\s+/)[0].toLowerCase() === name.toLowerCase(),
    );

    return block && { lines, block };
  };

  const refresh = async (): Promise<CommandSetMessage | undefined> => {
    await index.whenReady();

    const found = await readBlock();

    if (!found) {
      return undefined;
    }

    const linesOf = createLineReader();
    const own = readCommandSetSlots(
      found.lines.slice(found.block.startLine + 1, found.block.endLine),
    );
    const resolved = await resolveSlots(index, own, linesOf);
    const clashes = findHotkeyClashes(resolved);

    slots = new Map(own.map(({ slot, button }) => [slot, button]));

    const message: CommandSetMessage = {
      kind: 'set',
      name: name,
      slots: await Promise.all(
        resolved.map(async (slot) => {
          const [image] = slot.imageName
            ? index.findDefinitions('MappedImage', slot.imageName)
            : [];
          const picture = image && icon && (await icon(image));

          return {
            slot: slot.slot,
            button: slot.button,
            defined: slot.defined,
            text: slot.text,
            hotkey: slot.hotkey,
            clashes: clashes.get(slot.slot),
            command: slot.command,
            icon: picture
              ? /\((data:image\/png;base64,[^)]+)\)/.exec(picture)?.[1]
              : undefined,
          };
        }),
      ),
    };

    await panel.post(message);
    return message;
  };

  /** Writes the slots as the set's numbered lines */
  const write = async (
    before: ReadonlyMap<number, string>,
    newSlots: Map<number, string>,
  ): Promise<void> => {
    const found = await readBlock();

    if (!found) {
      return;
    }

    // The page drew the slots as of the last refresh, which may be behind
    // the file: the edit must start from the same lines it was asked of
    const current = new Map(
      readCommandSetSlots(
        found.lines.slice(found.block.startLine + 1, found.block.endLine),
      ).map(({ slot, button }) => [slot, button]),
    );

    if (!hasSameSlots(current, before)) {
      await refreshStale();
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const document = await vscode.workspace.openTextDocument(uri);

    for (
      let line = found.block.startLine;
      line <= found.block.endLine;
      line++
    ) {
      if (document.lineAt(line).text !== found.lines[line]) {
        await refreshStale();
        return;
      }
    }

    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

    for (const change of buildSlotEdits(
      found.lines,
      found.block.startLine,
      found.block.endLine,
      newSlots,
    )) {
      edit.replace(
        uri,
        new vscode.Range(change.line, 0, change.line + change.remove, 0),
        change.insert.map((line) => line + eol).join(''),
      );
    }
    await vscode.workspace.applyEdit(edit);
    await refresh();
  };

  const refreshStale = async (): Promise<void> => {
    void vscode.window.showErrorMessage(
      'The file changed since the editor was drawn; it has been refreshed',
    );
    await refresh();
  };

  const receive = async (message: FromCommandSetPage): Promise<void> => {
    switch (message.kind) {
      case 'ready':
        await refresh();
        return;
      case 'move':
        await write(slots, moveSlot(slots, message.from, message.to));
        return;
      case 'clear': {
        const next = new Map(slots);

        next.delete(message.slot);
        await write(slots, next);
        return;
      }
      case 'add': {
        const button =
          message.button ??
          (await vscode.window.showQuickPick(index.getNames('CommandButton'), {
            placeHolder: `The button for slot ${message.slot}`,
          }));

        if (button) {
          await write(slots, new Map(slots).set(message.slot, button));
        }
        return;
      }
      case 'reveal': {
        const button = slots.get(message.slot);
        const [place] = button
          ? index.findDefinitions('CommandButton', button)
          : [];

        if (place) {
          const editor = await vscode.window.showTextDocument(place.uri, {
            viewColumn: vscode.ViewColumn.One,
          });
          const at = new vscode.Position(place.line, 0);

          editor.selection = new vscode.Selection(at, at);
          editor.revealRange(new vscode.Range(at, at));
        }
      }
    }
  };

  return { show: panel.show, refresh, receive };
};

/** Creates a lens over every CommandSet header */
const createCommandSetLensProvider = (): vscode.CodeLensProvider => ({
  provideCodeLenses(document) {
    const lenses: vscode.CodeLens[] = [];

    for (let line = 0; line < document.lineCount; line++) {
      const name = readCommandSetName(document.lineAt(line).text);

      if (name) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: 'Edit slots',
            command: 'bigfs.editCommandSet',
            arguments: [document.uri, name],
          }),
        );
      }
    }
    return lenses;
  },
});

/**
 * Registers the Edit slots lens and `bigfs.editCommandSet`, which opens one
 * editor per set; given a message it acts as the page does, for automation.
 */
export const registerCommandSetEditor = (
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => {
  const open = new Map<string, ReturnType<typeof createCommandSetEditor>>();

  const showEditor = (uri: vscode.Uri, name: string) => {
    const key = `${uri.toString()}#${name.toLowerCase()}`;
    let editor = open.get(key);

    if (!editor) {
      editor = createCommandSetEditor(
        context,
        documents,
        index,
        locator,
        uri,
        name,
        () => open.delete(key),
      );
      open.set(key, editor);
    }
    editor.show();
    return editor;
  };

  return [
    vscode.languages.registerCodeLensProvider(
      selector,
      createCommandSetLensProvider(),
    ),
    registerCommand(
      'bigfs.editCommandSet',
      async (uri?: vscode.Uri, name?: string, message?: FromCommandSetPage) => {
        if (!uri || !name) {
          void vscode.window.showInformationMessage(
            'Use the Edit slots lens on a CommandSet',
          );
          return undefined;
        }

        const editor = showEditor(uri, name);

        if (message) {
          await editor.receive(message);
        }
        return editor.refresh();
      },
    ),
  ];
};
