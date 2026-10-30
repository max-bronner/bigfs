import * as vscode from 'vscode';
import {
  CsfFile,
  describeCsfNameProblem,
  keepLineBreaks,
  parseCsf,
  writeCsf,
} from '../../formats/csf/csf';
import {
  parseStringRecords,
  quoteStringText,
} from '../../formats/str/sageStringRecords';
import { renderWebviewPage } from '../../platform/webview/webviewPage';
import { getPageBundleOptions, getPageBundleFolder } from '../../platform/webview/pageBundle';
import type {
  FromStringsPage,
  StringRow,
  StringsToPage,
} from '../../webview/strings/protocol';
import {
  SnapshotDocument,
  SnapshotFormat,
  addSnapshotView,
  backupSnapshot,
  createSnapshotDocument,
  readSnapshotSource,
  recordSnapshotEdit,
  redrawSnapshotViews,
  revertSnapshot,
  saveSnapshot,
} from '../../platform/webview/snapshotEditor';
import { describeError } from '../../core/errors';

/**
 * Table editors for string tables: `.str` as an alternative view of the text
 * file (edits go through the text document, so its undo, save and encoding
 * apply and untouched records keep their bytes), and `.csf` as its default
 * editor.
 */

/** View type of the `.str` table, an alternative view of the text file */
export const STR_TABLE_VIEW_TYPE = 'bigfs.strTable';
/** View type of the `.csf` editor, the default for those files */
export const CSF_VIEW_TYPE = 'bigfs.csfEditor';

/** Message from the string table page, with the fields any of its kinds may carry */
interface PageMessage {
  kind: FromStringsPage['kind'];
  id?: number;
  label?: string;
  value?: string;
}

/** Renders the string table page around its script bundle, shared by both editors */
export const renderHtml = (
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string => {
  return renderWebviewPage({
    ...getPageBundleOptions(extensionUri, webview, 'strings'),
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
  });
};

/** Wires a page to a source of rows and a handler for its messages */
const connect = (
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  table: () => {
    rows: StringRow[];
    hasSpeech: boolean;
    canReveal: boolean;
    summary: string;
  },
  handle: (message: PageMessage) => Promise<void> | void,
): (() => Thenable<boolean>) => {
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [getPageBundleFolder(extensionUri)],
  };
  panel.webview.html = renderHtml(panel.webview, extensionUri);

  const send = () => {
    const message: StringsToPage = { kind: 'table', ...table() };

    return panel.webview.postMessage(message);
  };

  panel.webview.onDidReceiveMessage(async (message: PageMessage) => {
    try {
      await handle(message);
    } catch (error) {
      const notice: StringsToPage = {
        kind: 'notice',
        message: describeError(error),
      };

      await panel.webview.postMessage(notice);
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
  const problem = describeCsfNameProblem(name);

  if (problem) {
    throw new Error(problem);
  }
};

/** Custom text editor showing a `.str` file as a table, editing through the text document */
export class StrTableEditorProvider implements vscode.CustomTextEditorProvider {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  /** Shows the records as rows and turns the page's edits into text edits */
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
    /** Finds the record a message means, refusing it if the file moved under it */
    const findRecord = (message: PageMessage) => {
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
      this.extensionUri,
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
            const record = findRecord(message);
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
            const record = findRecord(message);
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
            const record = findRecord(message);

            return apply((edit) =>
              edit.delete(
                document.uri,
                range(record.span.start, record.span.end),
              ),
            );
          }
          case 'reveal': {
            const record = findRecord(message);

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
type CsfDocument = SnapshotDocument<CsfFile>;

const CSF_FORMAT: SnapshotFormat<CsfFile> = {
  read: parseCsf,
  write: writeCsf,
};

const cloneCsf = (file: CsfFile): CsfFile => ({
  ...file,
  labels: file.labels.map((label) => ({
    name: label.name,
    strings: label.strings.map((string) => ({ ...string })),
  })),
});

/** Custom editor for `.csf` files: the binary file as a table, saved whole */
export class CsfEditorProvider implements vscode.CustomEditorProvider<CsfDocument> {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  private readonly changes = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<CsfDocument>
  >();
  public readonly onDidChangeCustomDocument = this.changes.event;

  /** Parses a `.csf` into an editable snapshot */
  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<CsfDocument> {
    const file = parseCsf(await readSnapshotSource(uri, context.backupId));

    return createSnapshotDocument(uri, file, false);
  }

  /** Applies a change to a copy, records the step, and redraws */
  private change(
    document: CsfDocument,
    label: string,
    mutate: (file: CsfFile) => void,
  ): void {
    const after = cloneCsf(document.snapshot);

    mutate(after);
    recordSnapshotEdit(this.changes, document, label, after);
    redrawSnapshotViews(document);
  }

  /** Shows the labels as rows and applies the page's edits as undoable steps */
  public resolveCustomEditor(
    document: CsfDocument,
    panel: vscode.WebviewPanel,
  ): void {
    const findLabel = (file: CsfFile, message: PageMessage) => {
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
      this.extensionUri,
      () => {
        const seen = new Set<string>();

        return {
          rows: document.snapshot.labels.map((label, id) => {
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
          summary: `CSF version ${document.snapshot.version}, language ${document.snapshot.language}`,
        };
      },
      (message) => {
        switch (message.kind) {
          case 'setText': {
            const previous = findLabel(document.snapshot, message).strings[0]?.text;
            const text = keepLineBreaks(previous ?? '', message.value ?? '');

            if (previous === text) {
              return;
            }

            return this.change(document, 'Edit text', (file) => {
              const label = findLabel(file, message);

              if (label.strings.length) {
                label.strings[0].text = text;
              } else {
                label.strings.push({ text });
              }
            });
          }
          case 'setSpeech':
            findLabel(document.snapshot, message);
            checkEncodable((message.value ?? '').trim());

            return this.change(document, 'Edit speech', (file) => {
              const label = findLabel(file, message);
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
            findLabel(document.snapshot, message);

            return this.change(document, 'Rename label', (file) => {
              findLabel(file, message).name = name;
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
            findLabel(document.snapshot, message);

            return this.change(document, 'Remove label', (file) => {
              file.labels.splice(message.id ?? -1, 1);
            });
        }
      },
    );

    addSnapshotView(document, panel, send);
  }

  /** Writes the table back whole */
  public saveCustomDocument(document: CsfDocument): Promise<void> {
    return saveSnapshot(document, CSF_FORMAT);
  }

  /** Writes the table to another file */
  public saveCustomDocumentAs(
    document: CsfDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    return saveSnapshot(document, CSF_FORMAT, destination);
  }

  /** Rereads the table from disk, dropping unsaved edits */
  public revertCustomDocument(document: CsfDocument): Promise<void> {
    return revertSnapshot(document, CSF_FORMAT);
  }

  /** Backs up the unsaved table so it survives a reload */
  public backupCustomDocument(
    document: CsfDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    return backupSnapshot(document, CSF_FORMAT, context);
  }
}
