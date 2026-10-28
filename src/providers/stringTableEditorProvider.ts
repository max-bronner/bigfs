import * as vscode from 'vscode';
import {
  CsfFile,
  csfNameProblem,
  keepLineBreaks,
  parseCsf,
  writeCsf,
} from '../formats/csf/csf';
import {
  parseStringRecords,
  quoteStringText,
} from '../formats/str/sageStringRecords';
import { STRING_TABLE_SCRIPT } from './stringTableViewScript';
import { webviewPage } from './webviewPage';

/**
 * Table editors for string tables: `.str` as an alternative view of the text
 * file (edits go through the text document, so its undo, save and encoding
 * apply and untouched records keep their bytes), and `.csf` as its default
 * editor.
 */

export const STR_TABLE_VIEW_TYPE = 'bigfs.strTable';
export const CSF_VIEW_TYPE = 'bigfs.csfEditor';

/** One row of the table */
interface Row {
  id: number;
  label: string;
  text: string;
  hasText?: boolean;
  speech?: string;
  /** Strings under the label after the first */
  extra?: number;
  problems?: string[];
}

/** What the page sends */
interface PageMessage {
  kind:
    | 'ready'
    | 'setText'
    | 'setLabel'
    | 'setSpeech'
    | 'add'
    | 'remove'
    | 'reveal';
  id?: number;
  label?: string;
  value?: string;
}

export const renderHtml = (): string => {
  return webviewPage({
    style: `
  body { margin: 0; padding: 8px 12px; color: var(--vscode-foreground); font: var(--vscode-font-size) var(--vscode-font-family); }
  header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  input, textarea { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 3px 5px; font: inherit; }
  #filter { flex: 1; min-width: 200px; }
  form { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  #newLabel { width: 240px; } #newText { flex: 1; min-width: 200px; }
  button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th { text-align: left; position: sticky; top: 0; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 4px; }
  td { border-bottom: 1px solid var(--vscode-panel-border); padding: 3px 4px; vertical-align: top; white-space: pre-wrap; word-break: break-word; }
  td.label { font-family: var(--vscode-editor-font-family, monospace); width: 30%; }
  td.missing { opacity: 0.5; font-style: italic; }
  td.actions { width: 64px; text-align: right; white-space: nowrap; }
  td input, td textarea { width: 100%; box-sizing: border-box; }
  tr.problem td.label { color: var(--vscode-editorWarning-foreground); }
  th.label { width: 30%; } th.speech { width: 20%; } th.actions { width: 64px; }
  .muted { opacity: 0.7; }
  #notice { position: fixed; bottom: 8px; left: 12px; right: 12px; padding: 6px 10px; background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
`,
    body: `<header><input id="filter" placeholder="Filter labels and text"><span id="count" class="muted"></span><span id="summary" class="muted"></span></header>
<form id="add"><input id="newLabel" placeholder="NEW:Label"><input id="newText" placeholder="Text"><button type="submit">Add</button></form>
<table><thead><tr><th class="label">Label</th><th>Text <span class="muted">(double-click to edit; Ctrl+Enter saves)</span></th><th class="speech" id="speechHead">Speech</th><th class="actions"></th></tr></thead><tbody id="rows"></tbody></table>
<p><button id="more" hidden>Show more</button></p>
<div id="notice" hidden></div>`,
    script: STRING_TABLE_SCRIPT,
  });
};

/** Wires a page to a source of rows and a handler for its messages */
const connect = (
  panel: vscode.WebviewPanel,
  table: () => {
    rows: Row[];
    hasSpeech: boolean;
    canReveal: boolean;
    summary: string;
  },
  handle: (message: PageMessage) => Promise<void> | void,
): (() => Thenable<boolean>) => {
  panel.webview.options = { enableScripts: true, localResourceRoots: [] };
  panel.webview.html = renderHtml();

  const send = () => panel.webview.postMessage({ kind: 'table', ...table() });

  panel.webview.onDidReceiveMessage(async (message: PageMessage) => {
    try {
      await handle(message);
    } catch (error) {
      await panel.webview.postMessage({
        kind: 'notice',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await send();
  });

  return send;
};

const LABEL_PATTERN = /^[^\s"/][^\s"]*$/;

const checkLabel = (label: string) => {
  if (!LABEL_PATTERN.test(label)) {
    throw new Error(
      `"${label}" is not a label: it cannot hold spaces or quotes`,
    );
  }
};

/** Refuses a label or speech name the `.csf` cannot store */
const checkEncodable = (name: string) => {
  const problem = csfNameProblem(name);

  if (problem) {
    throw new Error(problem);
  }
};

/** The `.str` table: a view over the text document */
export class StrTableEditorProvider implements vscode.CustomTextEditorProvider {
  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): void {
    const records = () => parseStringRecords(document.getText());
    const eol = () => (document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n');
    const range = (start: number, end: number) =>
      new vscode.Range(document.positionAt(start), document.positionAt(end));
    const apply = async (build: (edit: vscode.WorkspaceEdit) => void) => {
      const edit = new vscode.WorkspaceEdit();

      build(edit);

      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new Error('The edit was refused');
      }
    };
    /** The record a message means, refused if the file moved under it */
    const recordOf = (message: PageMessage) => {
      const record = records()[message.id ?? -1];

      if (
        !record ||
        (message.label !== undefined && record.label !== message.label)
      ) {
        throw new Error('The file changed; try again');
      }

      return record;
    };

    const send = connect(
      panel,
      () => {
        const all = records();
        const seen = new Map<string, number>();

        return {
          rows: all.map((record, id) => {
            const key = record.label.toLowerCase();
            const first = seen.get(key);
            const problems = [
              ...(first === undefined
                ? []
                : [`a duplicate of line ${first + 1}; the first one is used`]),
              ...(record.text === undefined ? ['has no text'] : []),
              ...(record.hasEnd ? [] : ['has no END']),
              ...(record.isUnclosed ? ['its text has no closing quote'] : []),
            ];

            if (first === undefined) {
              seen.set(key, record.line);
            }

            return {
              id,
              label: record.label,
              text: record.text ?? '',
              hasText: record.text !== undefined,
              problems,
            };
          }),
          hasSpeech: false,
          canReveal: true,
          summary: '',
        };
      },
      async (message) => {
        switch (message.kind) {
          case 'setText': {
            const record = recordOf(message);
            const quoted = quoteStringText(message.value ?? '');

            return apply((edit) => {
              if (record.textSpan) {
                edit.replace(
                  document.uri,
                  range(record.textSpan.start, record.textSpan.end),
                  quoted,
                );
              } else {
                edit.insert(
                  document.uri,
                  document.positionAt(record.labelSpan.end),
                  `${eol()}${quoted}`,
                );
              }
            });
          }
          case 'setLabel': {
            const record = recordOf(message);
            const label = (message.value ?? '').trim();

            checkLabel(label);

            return apply((edit) =>
              edit.replace(
                document.uri,
                range(record.labelSpan.start, record.labelSpan.end),
                label,
              ),
            );
          }
          case 'add': {
            const label = (message.label ?? '').trim();

            checkLabel(label);

            const text = document.getText();
            const separator = !text || /\n\s*$/.test(text) ? '' : eol();

            return apply((edit) =>
              edit.insert(
                document.uri,
                document.positionAt(text.length),
                `${separator}${text ? eol() : ''}${label}${eol()}${quoteStringText(message.value ?? '')}${eol()}END${eol()}`,
              ),
            );
          }
          case 'remove': {
            const record = recordOf(message);

            return apply((edit) =>
              edit.delete(
                document.uri,
                range(record.span.start, record.span.end),
              ),
            );
          }
          case 'reveal': {
            const record = recordOf(message);

            await vscode.window.showTextDocument(document, {
              selection: range(record.labelSpan.start, record.labelSpan.end),
              viewColumn: vscode.ViewColumn.Beside,
            });

            return;
          }
        }
      },
    );

    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === document) {
        void send();
      }
    });

    panel.onDidDispose(() => listener.dispose());
  }
}

/** An open `.csf`: its parsed form, and a copy for each undo step */
class CsfDocument implements vscode.CustomDocument {
  public constructor(
    public readonly uri: vscode.Uri,
    public file: CsfFile,
    private readonly onDispose: () => void,
  ) {}

  public dispose(): void {
    this.onDispose();
  }
}

const cloneCsf = (file: CsfFile): CsfFile => ({
  ...file,
  labels: file.labels.map((label) => ({
    name: label.name,
    strings: label.strings.map((string) => ({ ...string })),
  })),
});

/** The `.csf` editor: the binary file as a table, saved whole */
export class CsfEditorProvider implements vscode.CustomEditorProvider<CsfDocument> {
  private readonly changes = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<CsfDocument>
  >();
  public readonly onDidChangeCustomDocument = this.changes.event;
  private readonly redraws = new Map<
    CsfDocument,
    Set<() => Thenable<boolean>>
  >();

  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<CsfDocument> {
    const source = context.backupId ? vscode.Uri.parse(context.backupId) : uri;

    const document: CsfDocument = new CsfDocument(
      uri,
      parseCsf(await vscode.workspace.fs.readFile(source)),
      () => this.redraws.delete(document),
    );

    return document;
  }

  private redraw(document: CsfDocument): void {
    this.redraws.get(document)?.forEach((send) => void send());
  }

  /** Applies a change to a copy, records the step, and redraws */
  private change(
    document: CsfDocument,
    label: string,
    mutate: (file: CsfFile) => void,
  ): void {
    const before = document.file;
    const after = cloneCsf(before);

    mutate(after);
    document.file = after;
    this.changes.fire({
      document,
      label,
      undo: () => {
        document.file = before;
        this.redraw(document);
      },
      redo: () => {
        document.file = after;
        this.redraw(document);
      },
    });
    this.redraw(document);
  }

  public resolveCustomEditor(
    document: CsfDocument,
    panel: vscode.WebviewPanel,
  ): void {
    const labelOf = (file: CsfFile, message: PageMessage) => {
      const label = file.labels[message.id ?? -1];

      if (
        !label ||
        (message.label !== undefined && label.name !== message.label)
      ) {
        throw new Error('The table changed; try again');
      }

      return label;
    };
    const send = connect(
      panel,
      () => {
        const seen = new Set<string>();

        return {
          rows: document.file.labels.map((label, id) => {
            const key = label.name.toLowerCase();
            const problems = [
              ...(seen.has(key)
                ? ['a duplicate label; the first one is used']
                : []),
              ...(label.strings.length ? [] : ['has no string']),
            ];

            seen.add(key);

            return {
              id,
              label: label.name,
              text: label.strings[0]?.text ?? '',
              hasText: label.strings.length > 0,
              speech: label.strings[0]?.speech,
              extra: Math.max(0, label.strings.length - 1),
              problems,
            };
          }),
          hasSpeech: true,
          canReveal: false,
          summary: `CSF version ${document.file.version}, language ${document.file.language}`,
        };
      },
      (message) => {
        switch (message.kind) {
          case 'setText': {
            const previous = labelOf(document.file, message).strings[0]?.text;
            const text = keepLineBreaks(previous ?? '', message.value ?? '');

            if (previous === text) {
              return;
            }

            return this.change(document, 'Edit text', (file) => {
              const label = labelOf(file, message);

              if (label.strings.length) {
                label.strings[0].text = text;
              } else {
                label.strings.push({ text });
              }
            });
          }
          case 'setSpeech':
            labelOf(document.file, message);
            checkEncodable((message.value ?? '').trim());

            return this.change(document, 'Edit speech', (file) => {
              const label = labelOf(file, message);
              const speech = (message.value ?? '').trim();

              if (!label.strings.length) {
                label.strings.push({ text: '' });
              }

              label.strings[0].speech = speech || undefined;
            });
          case 'setLabel': {
            const name = (message.value ?? '').trim();

            checkLabel(name);
            checkEncodable(name);
            labelOf(document.file, message);

            return this.change(document, 'Rename label', (file) => {
              labelOf(file, message).name = name;
            });
          }
          case 'add': {
            const name = (message.label ?? '').trim();

            checkLabel(name);
            checkEncodable(name);

            return this.change(document, 'Add label', (file) => {
              file.labels.push({
                name,
                strings: [{ text: message.value ?? '' }],
              });
            });
          }
          case 'remove':
            labelOf(document.file, message);

            return this.change(document, 'Remove label', (file) => {
              file.labels.splice(message.id ?? -1, 1);
            });
        }
      },
    );

    let sends = this.redraws.get(document);

    if (!sends) {
      sends = new Set();
      this.redraws.set(document, sends);
    }

    sends.add(send);
    panel.onDidDispose(() => sends?.delete(send));
  }

  public async saveCustomDocument(document: CsfDocument): Promise<void> {
    await vscode.workspace.fs.writeFile(document.uri, writeCsf(document.file));
  }

  public async saveCustomDocumentAs(
    document: CsfDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    await vscode.workspace.fs.writeFile(destination, writeCsf(document.file));
  }

  public async revertCustomDocument(document: CsfDocument): Promise<void> {
    document.file = parseCsf(await vscode.workspace.fs.readFile(document.uri));
    this.redraw(document);
  }

  public async backupCustomDocument(
    document: CsfDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(
      context.destination,
      writeCsf(document.file),
    );

    return {
      id: context.destination.toString(),
      delete: () => vscode.workspace.fs.delete(context.destination),
    };
  }
}
