import * as vscode from 'vscode';
import { webviewPage } from '../providers/webviewPage';
import type { EntryLocator } from '../formats/entryLocator';
import {
  commandSetSlots,
  createLineReader,
  resolveSlots,
} from './commandSetPreview';
import { createMappedImagePreview } from './mappedImagePreview';
import { hotkeyClashes } from './model/hotkeys';
import {
  commandSetHeader,
  moveSlot,
  sameSlots,
  slotEdits,
} from './model/commandSetEdit';
import type {
  CommandSetMessage,
  FromCommandSetPage,
} from './model/commandSetEdit';
import { parseSageIni } from './model/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import type { SageIniIndex } from './sageIniIndex';
import { readWorkspaceText } from './workspaceText';

/**
 * The CommandSet editor: a set's buttons in their slots, as the player sees
 * them, with icon, game text and hotkey, clashing hotkeys marked. Drag a
 * button to another slot (swapping with what is there), clear a slot, or
 * add a button to an empty one; every change rewrites the set's slot lines.
 */

const COLUMNS = 5;

class CommandSetEditor {
  private static readonly open = new Map<string, CommandSetEditor>();
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly icon?: ReturnType<typeof createMappedImagePreview>;
  private slots = new Map<number, string>();

  public static show(
    context: vscode.ExtensionContext,
    documents: SageIniDocuments,
    index: SageIniIndex,
    locator: EntryLocator | undefined,
    uri: vscode.Uri,
    name: string,
  ): CommandSetEditor {
    const key = `${uri.toString()}#${name.toLowerCase()}`;
    const existing = CommandSetEditor.open.get(key);

    if (existing) {
      existing.panel.reveal();
      return existing;
    }

    const editor = new CommandSetEditor(
      context,
      documents,
      index,
      locator,
      uri,
      name,
      key,
    );

    CommandSetEditor.open.set(key, editor);
    return editor;
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly documents: SageIniDocuments,
    private readonly index: SageIniIndex,
    locator: EntryLocator | undefined,
    private readonly uri: vscode.Uri,
    private readonly name: string,
    key: string,
  ) {
    const scripts = vscode.Uri.joinPath(
      context.extensionUri,
      'dist',
      'webview',
    );

    this.icon = locator && createMappedImagePreview(locator);
    this.panel = vscode.window.createWebviewPanel(
      'bigfs.commandSet',
      `CommandSet: ${name}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [scripts],
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = webviewPage({
      allow: { img: 'data:', script: this.panel.webview.cspSource },
      scriptFiles: [
        this.panel.webview
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
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: FromCommandSetPage) =>
        this.receive(message),
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.uri.toString()) {
          void this.refresh();
        }
      }),
    );
    this.panel.onDidDispose(() => {
      CommandSetEditor.open.delete(key);
      this.disposables.forEach((each) => each.dispose());
    });
  }

  /** The set's block as the file has it now */
  private async block() {
    const lines = (await readWorkspaceText(this.uri)).split(/\r?\n/);
    const block = parseSageIni(
      lines,
      await this.documents.getSchema(),
    ).blocks.find(
      (each) =>
        each.keyword.toLowerCase() === 'commandset' &&
        each.name?.split(/\s+/)[0].toLowerCase() === this.name.toLowerCase(),
    );

    return block && { lines, block };
  }

  public async refresh(): Promise<CommandSetMessage | undefined> {
    await this.index.whenReady();

    const found = await this.block();

    if (!found) {
      return undefined;
    }

    const linesOf = createLineReader();
    const own = commandSetSlots(
      found.lines.slice(found.block.startLine + 1, found.block.endLine),
    );
    const resolved = await resolveSlots(this.index, own, linesOf);
    const clashes = hotkeyClashes(resolved);

    this.slots = new Map(own.map(({ slot, button }) => [slot, button]));

    const message: CommandSetMessage = {
      kind: 'set',
      name: this.name,
      slots: await Promise.all(
        resolved.map(async (slot) => {
          const [image] = slot.imageName
            ? this.index.findDefinitions('MappedImage', slot.imageName)
            : [];
          const picture = image && this.icon && (await this.icon(image));

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

    await this.panel.webview.postMessage(message);
    return message;
  }

  /** Writes the slots as the set's numbered lines */
  private async write(
    before: ReadonlyMap<number, string>,
    slots: Map<number, string>,
  ): Promise<void> {
    const found = await this.block();

    if (!found) {
      return;
    }

    // The page drew the slots as of the last refresh, which may be behind
    // the file: the edit must start from the same lines it was asked of
    const current = new Map(
      commandSetSlots(
        found.lines.slice(found.block.startLine + 1, found.block.endLine),
      ).map(({ slot, button }) => [slot, button]),
    );

    if (!sameSlots(current, before)) {
      await this.stale();
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const document = await vscode.workspace.openTextDocument(this.uri);

    for (
      let line = found.block.startLine;
      line <= found.block.endLine;
      line++
    ) {
      if (document.lineAt(line).text !== found.lines[line]) {
        await this.stale();
        return;
      }
    }

    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';

    for (const change of slotEdits(
      found.lines,
      found.block.startLine,
      found.block.endLine,
      slots,
    )) {
      edit.replace(
        this.uri,
        new vscode.Range(change.line, 0, change.line + change.remove, 0),
        change.insert.map((line) => line + eol).join(''),
      );
    }
    await vscode.workspace.applyEdit(edit);
    await this.refresh();
  }

  private async stale(): Promise<void> {
    void vscode.window.showErrorMessage(
      'The file changed since the editor was drawn; it has been refreshed',
    );
    await this.refresh();
  }

  public async receive(message: FromCommandSetPage): Promise<void> {
    switch (message.kind) {
      case 'ready':
        await this.refresh();
        return;
      case 'move':
        await this.write(
          this.slots,
          moveSlot(this.slots, message.from, message.to),
        );
        return;
      case 'clear': {
        const next = new Map(this.slots);

        next.delete(message.slot);
        await this.write(this.slots, next);
        return;
      }
      case 'add': {
        const button =
          message.button ??
          (await vscode.window.showQuickPick(
            this.index.getNames('CommandButton'),
            {
              placeHolder: `The button for slot ${message.slot}`,
            },
          ));

        if (button) {
          await this.write(
            this.slots,
            new Map(this.slots).set(message.slot, button),
          );
        }
        return;
      }
      case 'reveal': {
        const button = this.slots.get(message.slot);
        const [place] = button
          ? this.index.findDefinitions('CommandButton', button)
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
  }
}

/** A lens over every CommandSet header */
class CommandSetLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    for (let line = 0; line < document.lineCount; line++) {
      const name = commandSetHeader(document.lineAt(line).text);

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
  }
}

export const registerCommandSetEditor = (
  context: vscode.ExtensionContext,
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
  locator: EntryLocator | undefined,
): vscode.Disposable[] => [
  vscode.languages.registerCodeLensProvider(
    selector,
    new CommandSetLensProvider(),
  ),
  vscode.commands.registerCommand(
    'bigfs.editCommandSet',
    /** With `message`, acts as the page does, for automation */
    async (uri?: vscode.Uri, name?: string, message?: FromCommandSetPage) => {
      if (!uri || !name) {
        void vscode.window.showInformationMessage(
          'Use the Edit slots lens on a CommandSet',
        );
        return undefined;
      }

      const editor = CommandSetEditor.show(
        context,
        documents,
        index,
        locator,
        uri,
        name,
      );

      if (message) {
        await editor.receive(message);
      }
      return editor.refresh();
    },
  ),
];
