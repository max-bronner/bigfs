import * as vscode from 'vscode';
import { parseConst } from '../formats/apt/aptMovie';
import {
  movieToText,
  parseMovieText,
  printMovieText,
} from '../formats/apt/movieText';
import type { MovieText, TextProblem } from '../formats/apt/movieText';
import {
  blockScripts,
  saveMovieText,
  TextSaveError,
} from '../formats/apt/movieTextEdits';
import type { TextSave } from '../formats/apt/movieTextEdits';
import { toUri } from '../services/archives/commandTarget';
import type { AptDocument } from './aptEditorProvider';

/**
 * The text view of an APT movie: the whole movie, `.apt` and `.const`, as
 * one editable text document (`docs/apt-text-format.md`). It is a virtual
 * file under its own scheme whose query names the movie, so it works the
 * same for a loose movie and for one inside an archive, and is read-only
 * where the movie is.
 *
 * While the movie is open in the visual editor the text shows that editor's
 * state, unsaved edits included, and saving the text applies to it as one
 * undoable edit and saves it. Otherwise the text is read from the files and
 * saving writes them. A text that does not parse or cannot be saved is
 * refused with its problems underlined, and the movie is left as it was.
 */

export const TEXT_SCHEME = 'bigfs-apt-text';

/** What the text view needs from the APT editor */
export interface TextViewHost {
  /** The movie open in the visual editor, by uri string */
  document(movie: string): AptDocument | undefined;
  /** Reads a movie that is not open */
  load(movie: vscode.Uri): Promise<AptDocument>;
  /** Puts a saved text into a movie open in the visual editor, as one undoable edit, and saves it */
  commit(document: AptDocument, save: TextSave): Promise<void>;
  /** Whether a movie may not be written: a base game source */
  isReadOnly(movie: vscode.Uri): boolean;
}

const encoder = new TextEncoder();

/** The text view's uri for a movie */
export const textUriOf = (movie: vscode.Uri): vscode.Uri => {
  const name = movie.path
    .slice(movie.path.lastIndexOf('/') + 1)
    .replace(/\.apt$/i, '');

  return vscode.Uri.from({
    scheme: TEXT_SCHEME,
    path: `/${name}.apttext`,
    query: new URLSearchParams({ movie: movie.toString() }).toString(),
  });
};

/** The movie a text view's uri names */
export const movieUriOf = (uri: vscode.Uri): vscode.Uri =>
  vscode.Uri.parse(new URLSearchParams(uri.query).get('movie') ?? '');

const toDiagnostic = (
  document: vscode.TextDocument | undefined,
  problem: TextProblem,
): vscode.Diagnostic => {
  const line = Math.min(
    problem.line,
    Math.max(0, (document?.lineCount ?? 1) - 1),
  );
  const end =
    problem.endColumn > problem.column
      ? problem.endColumn
      : (document?.lineAt(line).text.length ?? problem.column + 1);

  return new vscode.Diagnostic(
    new vscode.Range(
      line,
      problem.column,
      line,
      Math.max(end, problem.column + 1),
    ),
    problem.message,
    vscode.DiagnosticSeverity.Error,
  );
};

/** A movie as text, and the stamp of the state it was made from */
interface Rendered {
  stamp: string;
  text: string;
  model: MovieText;
}

export class AptTextView
  implements vscode.FileSystemProvider, vscode.Disposable
{
  private readonly changes = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  public readonly onDidChangeFile = this.changes.event;

  private readonly diagnostics =
    vscode.languages.createDiagnosticCollection('apt-text');
  private readonly rendered = new Map<string, Rendered>();
  /** Text views read so far, by uri string, so a change to their movie reaches them */
  private readonly views = new Set<string>();
  /** Movies not open in the visual editor, read once per change on disk */
  private readonly loaded = new Map<
    string,
    { mtime: number; document: AptDocument }
  >();
  private readonly subscriptions: vscode.Disposable[];

  public constructor(private readonly host: TextViewHost) {
    const check = (document: vscode.TextDocument) => {
      if (document.uri.scheme === TEXT_SCHEME) {
        this.diagnostics.set(
          document.uri,
          parseMovieText(document.getText()).problems.map((problem) =>
            toDiagnostic(document, problem),
          ),
        );
      }
    };

    this.subscriptions = [
      this.changes,
      this.diagnostics,
      vscode.workspace.registerFileSystemProvider(TEXT_SCHEME, this, {
        isCaseSensitive: true,
      }),
      vscode.workspace.onDidOpenTextDocument(check),
      vscode.workspace.onDidChangeTextDocument(({ document }) =>
        check(document),
      ),
      vscode.workspace.onDidCloseTextDocument((document) =>
        this.diagnostics.delete(document.uri),
      ),
      vscode.commands.registerCommand('bigfs.openAptText', (target?: unknown) =>
        this.open(target),
      ),
      vscode.commands.registerCommand(
        'bigfs.reopenAptVisual',
        (target?: unknown) => this.reopenVisual(target),
      ),
    ];
  }

  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /** Opens the text view of a movie, given or in the active editor; returns its uri */
  public async open(target?: unknown): Promise<vscode.Uri | undefined> {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const movie =
      toUri(target) ??
      (input instanceof vscode.TabInputCustom ? input.uri : undefined) ??
      vscode.window.activeTextEditor?.document.uri;

    if (!movie || !/\.apt$/i.test(movie.path)) {
      void vscode.window.showErrorMessage(
        'Open an .apt movie to see it as text',
      );
      return undefined;
    }

    const uri = textUriOf(movie);
    // A switch from the visual editor replaces it, unless it holds unsaved edits the text then shows
    const visual = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          tab.input instanceof vscode.TabInputCustom &&
          tab.input.viewType === 'bigfs.aptEditor' &&
          tab.input.uri.toString() === movie.toString() &&
          tab.isActive &&
          !tab.isDirty,
      );

    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(uri),
      { preview: false },
    );
    await vscode.window.tabGroups.close(visual);
    return uri;
  }

  /** Opens the visual editor on the movie of the active text view, and closes the text if it is saved */
  private async reopenVisual(target?: unknown): Promise<void> {
    const uri = toUri(target) ?? vscode.window.activeTextEditor?.document.uri;

    if (!uri || uri.scheme !== TEXT_SCHEME) {
      return;
    }

    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === uri.toString() &&
          !tab.isDirty,
      );

    await vscode.commands.executeCommand(
      'vscode.openWith',
      movieUriOf(uri),
      'bigfs.aptEditor',
    );
    await vscode.window.tabGroups.close(tabs);
  }

  /** Tells open text views of a movie that it changed, so clean ones read it again */
  public changed(movie: vscode.Uri): void {
    const key = movie.toString();
    const events = [...this.views]
      .map((view) => vscode.Uri.parse(view))
      .filter((view) => movieUriOf(view).toString() === key)
      .map((uri) => ({ type: vscode.FileChangeType.Changed, uri }));

    this.loaded.delete(key);
    if (events.length) {
      this.changes.fire(events);
    }
  }

  /** The movie a view names: the open one, or one read from its files */
  private async movie(
    uri: vscode.Uri,
  ): Promise<{ document: AptDocument; stamp: string }> {
    const movie = movieUriOf(uri);
    const key = movie.toString();
    const open = this.host.document(key);

    if (open) {
      return { document: open, stamp: `open ${open.version}` };
    }

    let mtime: number;

    try {
      mtime = (await vscode.workspace.fs.stat(movie)).mtime;
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    let entry = this.loaded.get(key);

    if (!entry || entry.mtime !== mtime) {
      try {
        entry = { mtime, document: await this.host.load(movie) };
      } catch (error) {
        throw vscode.FileSystemError.Unavailable(
          error instanceof Error ? error.message : String(error),
        );
      }
      this.loaded.set(key, entry);
    }
    return { document: entry.document, stamp: `disk ${mtime}` };
  }

  private async render(
    uri: vscode.Uri,
  ): Promise<Rendered & { document: AptDocument }> {
    const { document, stamp } = await this.movie(uri);
    const key = uri.toString();
    const cached = this.rendered.get(key);

    this.views.add(key);
    if (cached?.stamp === stamp) {
      return { ...cached, document };
    }

    const { apt, constBytes } = document.snapshot();
    let model: MovieText;

    try {
      model = movieToText(
        apt,
        constBytes,
        blockScripts(apt, parseConst(constBytes).items),
      );
    } catch (error) {
      throw vscode.FileSystemError.Unavailable(
        `${document.name}.apt cannot be read as text: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const rendered = {
      stamp,
      model,
      text: printMovieText(model, document.name),
    };

    this.rendered.set(key, rendered);
    return { ...rendered, document };
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { text, stamp } = await this.render(uri);

    return {
      type: vscode.FileType.File,
      ctime: 0,
      // Changes with every state the text is made from, which is how a stale save is caught
      mtime: [...stamp].reduce(
        (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
        7,
      ),
      size: encoder.encode(text).length,
      permissions: this.host.isReadOnly(movieUriOf(uri))
        ? vscode.FilePermission.Readonly
        : undefined,
    };
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return encoder.encode((await this.render(uri)).text);
  }

  public async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const movie = movieUriOf(uri);

    if (this.host.isReadOnly(movie)) {
      throw vscode.FileSystemError.NoPermissions(
        'This movie is in a base game source, which is read-only',
      );
    }

    const text = new TextDecoder().decode(content);
    const parsed = parseMovieText(text);
    const textDocument = vscode.workspace.textDocuments.find(
      (each) => each.uri.toString() === uri.toString(),
    );
    const refuse = (problems: TextProblem[]) => {
      this.diagnostics.set(
        uri,
        problems.map((problem) => toDiagnostic(textDocument, problem)),
      );

      const [first] = problems;

      return vscode.FileSystemError.Unavailable(
        `The movie was not changed. Line ${first.line + 1}: ${first.message}`,
      );
    };

    if (parsed.problems.length) {
      throw refuse(parsed.problems);
    }

    const { document, model } = await this.render(uri);
    const { apt, constBytes } = document.snapshot();
    let saved: TextSave;

    try {
      saved = saveMovieText(apt, constBytes, model, parsed.movie);
    } catch (error) {
      if (error instanceof TextSaveError) {
        throw refuse([
          { line: error.line, column: 0, endColumn: 0, message: error.message },
        ]);
      }
      throw vscode.FileSystemError.Unavailable(
        `The movie was not changed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.diagnostics.delete(uri);

    if (
      !saved.edits.length &&
      !saved.scripts.length &&
      !saved.constChanges.length &&
      !saved.constAdded.length
    ) {
      return;
    }

    const open = this.host.document(movie.toString());

    if (open) {
      await this.host.commit(open, saved);
    } else {
      document.restore({
        apt: saved.apt,
        constBytes: saved.constBytes,
        files: document.files,
      });
      await document.save();
    }
    this.changed(movie);
  }

  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  public createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions(
      'A movie text lives beside its movie',
    );
  }

  public delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      'Delete the movie from the explorer',
    );
  }

  public rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      'Rename the movie from the explorer',
    );
  }
}
