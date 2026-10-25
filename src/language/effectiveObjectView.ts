import * as vscode from 'vscode';
import { composeLineage } from './model/effectiveObject';
import type { LineageStep } from './model/effectiveObject';
import { parseSageIni, stripComment, tokenize } from './model/sageIniParser';
import type { SageIniDocuments } from './sageIniDocuments';
import type { SageIniIndex } from './sageIniIndex';
import { readWorkspaceText } from './workspaceText';

/**
 * "Show Effective Definition" on a `ChildObject` or `ObjectReskin`: a
 * read-only document holding the object as the game composes it from its
 * lineage, every line marked with the definition it comes from. It follows
 * edits to the files it was composed from.
 */

const SCHEME = 'bigfs-effective';
const TEMPLATES = ['Object', 'ChildObject', 'ObjectReskin'];
const INHERITING = ['childobject', 'objectreskin'];
const MAX_DEPTH = 8;

/** The header's keyword, own name and parent name */
const headerOf = (line: string) => {
  const [keyword, name, parent] = tokenize(stripComment(line));

  return {
    keyword: keyword?.text ?? '',
    name: name?.text ?? '',
    parent: INHERITING.includes(keyword?.text.toLowerCase() ?? '')
      ? parent?.text
      : undefined,
  };
};

class EffectiveObjects implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changed.event;

  public constructor(
    private readonly documents: SageIniDocuments,
    private readonly index: SageIniIndex,
  ) {}

  /** Asks for one view again, the next time it is shown */
  public update(uri: vscode.Uri): void {
    this.changed.fire(uri);
  }

  /** Redraws every effective view open, after an INI edit */
  public refresh(): void {
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === SCHEME) {
        this.changed.fire(document.uri);
      }
    }
  }

  /** One definition of the lineage, by where it is written */
  private async step(
    uri: vscode.Uri,
    line: number,
  ): Promise<(LineageStep & { parent?: string; header: string }) | undefined> {
    const lines = (await readWorkspaceText(uri)).split(/\r?\n/);
    const parsed = parseSageIni(lines, await this.documents.getSchema());
    const block = parsed.blocks.find((each) => each.startLine === line);

    if (!block) {
      return undefined;
    }

    const header = headerOf(lines[line]);

    return {
      name: header.name,
      lines,
      block,
      statements: parsed.statements,
      parent: header.parent,
      header: lines[line].trim(),
    };
  }

  private async find(name: string) {
    await this.index.whenReady();
    for (const keyword of TEMPLATES) {
      const [place] = this.index.findDefinitions(keyword, name);

      if (place) {
        return place;
      }
    }
    return undefined;
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = new URLSearchParams(uri.query);
    const source = vscode.Uri.parse(query.get('uri') ?? '');
    const first = await this.step(source, Number(query.get('line')));

    if (!first) {
      return `; ${uri.path.slice(1)} is no longer where it was`;
    }

    const lineage = [first];
    const notes: string[] = [];

    for (let parent = first.parent, depth = 0; parent; depth++) {
      if (depth >= MAX_DEPTH) {
        notes.push(`; Stopped after ${MAX_DEPTH} parents`);
        break;
      }

      const place = await this.find(parent);
      const step = place && (await this.step(place.uri, place.line));

      if (!step) {
        notes.push(
          `; ${parent} is not defined anywhere indexed: shown without it`,
        );
        break;
      }
      if (
        lineage.some(
          (each) => each.name.toLowerCase() === step.name.toLowerCase(),
        )
      ) {
        notes.push(`; ${step.name} inherits from itself: stopped there`);
        break;
      }
      lineage.unshift(step);
      parent = step.parent;
    }
    return [...notes, composeLineage(lineage, first.header)].join('\n');
  }
}

/** The effective view of the template written at a line */
const effectiveUri = (uri: vscode.Uri, line: number, name: string) =>
  vscode.Uri.from({
    scheme: SCHEME,
    path: `/${name} (effective).ini`,
    query: new URLSearchParams({
      uri: uri.toString(),
      line: String(line),
    }).toString(),
  });

/** A lens over every ChildObject and ObjectReskin header */
class EffectiveLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;

      if (!/^\s*(ChildObject|ObjectReskin)\s/i.test(text)) {
        continue;
      }

      const header = headerOf(text);

      if (header.parent) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
            title: `Effective definition (inherits ${header.parent})`,
            command: 'bigfs.showEffectiveObject',
            arguments: [document.uri, line],
          }),
        );
      }
    }
    return lenses;
  }
}

export const registerEffectiveObjects = (
  selector: vscode.DocumentSelector,
  documents: SageIniDocuments,
  index: SageIniIndex,
): vscode.Disposable[] => {
  const provider = new EffectiveObjects(documents, index);
  // Edits outside the editor change a lineage too
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.ini');

  return [
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.languages.registerCodeLensProvider(
      selector,
      new EffectiveLensProvider(),
    ),
    watcher,
    watcher.onDidChange(() => provider.refresh()),
    watcher.onDidCreate(() => provider.refresh()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (
        event.document.uri.scheme !== SCHEME &&
        event.document.languageId === 'sage-ini'
      ) {
        provider.refresh();
      }
    }),
    vscode.commands.registerCommand(
      'bigfs.showEffectiveObject',
      async (uri?: vscode.Uri, line?: number) => {
        const editor = vscode.window.activeTextEditor;

        if (!uri || line === undefined) {
          if (!editor) {
            return undefined;
          }
          uri = editor.document.uri;

          // The template header at or above the cursor
          for (line = editor.selection.active.line; line >= 0; line--) {
            if (
              /^\s*(Object|ChildObject|ObjectReskin)\s/i.test(
                editor.document.lineAt(line).text,
              )
            ) {
              break;
            }
          }
          if (line < 0) {
            void vscode.window.showInformationMessage(
              'Put the cursor inside an Object, ChildObject or ObjectReskin',
            );
            return undefined;
          }
        }

        const text = (await vscode.workspace.openTextDocument(uri)).lineAt(
          line,
        ).text;
        const target = effectiveUri(uri, line, headerOf(text).name);

        // An open view may predate files indexed since
        provider.update(target);

        const view = await vscode.workspace.openTextDocument(target);

        await vscode.languages.setTextDocumentLanguage(view, 'sage-ini');
        await vscode.window.showTextDocument(view, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        });
        return view;
      },
    ),
  ];
};
