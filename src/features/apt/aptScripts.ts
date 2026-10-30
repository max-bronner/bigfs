import * as vscode from 'vscode';
import {
  checkScript,
  decompileBlock,
  findBlockPointers,
} from '../../formats/apt/aptScript';
import type { AptDocument } from './aptDocument';

/**
 * Action blocks as documents: each opens in an ordinary editor tab as
 * script text, with highlighting and its compile errors underlined as it is
 * typed, and saving compiles it back into the movie through the APT
 * editor, as one undoable edit there. A block that only shows as a listing
 * opens read-only.
 *
 * A uri names the movie and the block it was opened on. Saving moves the
 * block (the new code goes to the end of the movie) and undo in the editor
 * moves it back, so each uri keeps every block it was saved to and means
 * the newest one the movie still runs.
 */

/** Uri scheme the action-block tabs are served under */
export const SCRIPT_SCHEME = 'bigfs-apt-script';

/** Callbacks `AptScripts` reaches the APT editor's open movies through */
export interface ScriptHost {
  /** The open movie a uri string names */
  document(movie: string): AptDocument | undefined;
  /** Compiles a script over a block; returns where the new block starts */
  save(document: AptDocument, block: number, text: string): Promise<number>;
}

const encoder = new TextEncoder();

/** File system provider serving a movie's action blocks as editable script tabs */
export class AptScripts
  implements vscode.FileSystemProvider, vscode.Disposable
{
  private readonly changes = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  /** Fires when a script tab's content changed, so a clean tab reads it again */
  public readonly onDidChangeFile = this.changes.event;

  /** Every block each opened uri was saved to, oldest first */
  private readonly blocks = new Map<string, number[]>();
  private readonly diagnostics =
    vscode.languages.createDiagnosticCollection('apt-script');
  private readonly subscriptions: vscode.Disposable[];

  public constructor(private readonly host: ScriptHost) {
    const check = (document: vscode.TextDocument) => {
      if (document.uri.scheme === SCRIPT_SCHEME) {
        this.check(document);
      }
    };

    this.subscriptions = [
      this.changes,
      this.diagnostics,
      vscode.workspace.registerFileSystemProvider(SCRIPT_SCHEME, this, {
        isCaseSensitive: true,
      }),
      vscode.workspace.onDidOpenTextDocument(check),
      vscode.workspace.onDidChangeTextDocument(({ document }) =>
        check(document),
      ),
      vscode.workspace.onDidCloseTextDocument((document) =>
        this.diagnostics.delete(document.uri),
      ),
    ];
  }

  /** Unregisters the scheme and clears the script diagnostics */
  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /** Builds the uri a block of a movie opens at; `label` names the tab */
  public static getScriptUri(
    document: AptDocument,
    block: number,
    label: string,
  ): vscode.Uri {
    const tab = label.replace(/[^\w #.@-]+/g, ' ').trim() || `block ${block}`;

    return vscode.Uri.from({
      scheme: SCRIPT_SCHEME,
      path: `/${document.name}/${tab}.aptscript`,
      query: new URLSearchParams({
        movie: document.uri.toString(),
        block: String(block),
      }).toString(),
    });
  }

  /** Opens a block in a tab; returns its uri */
  public async open(
    document: AptDocument,
    block: number,
    label: string,
  ): Promise<vscode.Uri> {
    const uri = AptScripts.getScriptUri(document, block, label);

    this.blocks.set(uri.toString(), [block]);
    await vscode.window.showTextDocument(
      await vscode.languages.setTextDocumentLanguage(
        await vscode.workspace.openTextDocument(uri),
        'apt-script',
      ),
      { preview: false },
    );
    return uri;
  }

  /** Tells open tabs of a movie that it changed, so clean ones read it again */
  public notifyChanged(document: AptDocument): void {
    const events = [...this.blocks.keys()]
      .map((key) => vscode.Uri.parse(key))
      .filter((uri) => this.parseTarget(uri).movie === document.uri.toString())
      .map((uri) => ({ type: vscode.FileChangeType.Changed, uri }));

    if (events.length) {
      this.changes.fire(events);
    }
  }

  private parseTarget(uri: vscode.Uri): { movie: string; blocks: number[] } {
    const query = new URLSearchParams(uri.query);

    return {
      movie: query.get('movie') ?? '',
      blocks: this.blocks.get(uri.toString()) ?? [Number(query.get('block'))],
    };
  }

  /**
   * Finds the open movie and the newest block a uri still means.
   * @throws `FileSystemError.FileNotFound` when the movie is not open or the block is gone
   */
  private resolve(uri: vscode.Uri): { document: AptDocument; block: number } {
    const { movie, blocks } = this.parseTarget(uri);
    const document = this.host.document(movie);
    const block =
      document &&
      [...blocks]
        .reverse()
        .find(
          (each) =>
            findBlockPointers(
              document.image.bytes,
              document.constFile.movieOffset,
              each,
            ).length,
        );

    if (!document || block === undefined || !Number.isInteger(block)) {
      throw vscode.FileSystemError.FileNotFound(
        `${uri.path.slice(1)}: open its movie in the APT editor first`,
      );
    }
    return { document, block };
  }

  private decompileScript(uri: vscode.Uri) {
    const { document, block } = this.resolve(uri);

    return decompileBlock(
      document.image.bytes,
      block,
      document.constFile.items,
    );
  }

  private check(text: vscode.TextDocument): void {
    try {
      const { document } = this.resolve(text.uri);
      const problem = checkScript(text.getText(), document.constFile.items);

      if (!problem) {
        this.diagnostics.delete(text.uri);
        return;
      }

      const line = Math.max(0, (problem.line ?? 1) - 1);
      const column = Math.max(0, (problem.column ?? 1) - 1);
      const end = text.lineAt(Math.min(line, text.lineCount - 1)).range.end;

      this.diagnostics.set(text.uri, [
        new vscode.Diagnostic(
          new vscode.Range(
            line,
            column,
            end.line,
            Math.max(end.character, column + 1),
          ),
          problem.message,
          vscode.DiagnosticSeverity.Error,
        ),
      ]);
    } catch {
      this.diagnostics.delete(text.uri);
    }
  }

  /** Describes a script tab; a block that only decodes as a listing is read-only */
  public stat(uri: vscode.Uri): vscode.FileStat {
    const { document } = this.resolve(uri);

    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: document.version,
      size: encoder.encode(this.decompileScript(uri).text).length,
      permissions:
        this.decompileScript(uri).mode === 'listing'
          ? vscode.FilePermission.Readonly
          : undefined,
    };
  }

  /** Decompiles the block a uri means into script text */
  public readFile(uri: vscode.Uri): Uint8Array {
    return encoder.encode(this.decompileScript(uri).text);
  }

  /**
   * Compiles a saved tab back into its movie as one undoable edit.
   * @throws `FileSystemError` when the block is a listing or the script does not compile
   */
  public async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { document, block } = this.resolve(uri);

    if (this.decompileScript(uri).mode === 'listing') {
      throw vscode.FileSystemError.NoPermissions(
        'This block only shows as a listing and cannot be compiled back',
      );
    }

    const text = new TextDecoder().decode(content);
    const problem = checkScript(text, document.constFile.items);

    if (problem) {
      throw vscode.FileSystemError.Unavailable(
        `${problem.line ? `line ${problem.line}: ` : ''}${problem.message}`,
      );
    }
    const saved = await this.host.save(document, block, text);

    this.blocks.set(uri.toString(), [...this.parseTarget(uri).blocks, saved]);
    this.changes.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  /** Watches nothing: a tab learns of changes through `changed` */
  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  /** Lists nothing, as scripts are opened by uri only */
  public readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  /** Refuses, as scripts live in their movie */
  public createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Scripts live in their movie');
  }

  /** Refuses; a script is removed from the APT editor */
  public delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      'Remove a script from the APT editor',
    );
  }

  /** Refuses, as scripts live in their movie */
  public rename(): void {
    throw vscode.FileSystemError.NoPermissions('Scripts live in their movie');
  }
}
