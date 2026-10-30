import * as vscode from 'vscode';
import type { ToolBox } from '../../core/toolRegistry';
import type { EntryLocator } from '../../services/entryLocator';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { AptEdit, EditResult } from '../../formats/apt/writer/aptEdit';
import { isEditable } from '../../services/ini/archiveText';
import type { ToPage } from '../../webview/apt/protocol';
import { AptDocument } from './aptDocument';
import { addScript, editDocument, editScript } from './aptDocumentEdits';
import type { RecordChange, ScriptSite } from './aptDocumentEdits';
import { AptLibrary } from './aptLibrary';
import { dispatchPageMessage } from './aptMessages';
import { createAptMovieImports } from './aptMovieImports';
import type { AptGameServices, AptMovieImports } from './aptMovieImports';
import { renderAptPage } from './aptPage';
import { AptScripts } from './aptScripts';
import { AptTextView } from './aptTextView';
import { checkAptDocument } from './aptWorkspaceCheck';
import { APT_VIEW_TYPE } from './viewTypes';

/**
 * Custom editor provider behind `bigfs.aptEditor`: a list of every
 * character, a stage that draws the selected one (shapes with their
 * textures, sprites at any frame, text fields, buttons in their up state),
 * and its fields and scripts. It holds the open movies and their pages; the
 * work is done by the `apt*` modules beside it.
 */
export class AptEditorProvider
  implements vscode.CustomEditorProvider<AptDocument>, vscode.Disposable
{
  private readonly onDidChangeEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<AptDocument>
  >();

  /** Fires for every edit, which is what makes the editor dirty and undoable */
  public readonly onDidChangeCustomDocument = this.onDidChangeEmitter.event;

  /** Diagnostics the integrity check reports on each movie's `.apt` */
  public readonly problems = vscode.languages.createDiagnosticCollection('apt');

  /** Redraw of each open document's page */
  private readonly redraws = new Map<AptDocument, () => Promise<void>>();

  /** Open documents by uri, for edits that do not come from the page */
  private readonly open = new Map<string, AptDocument>();

  /** Whether each open document's page has loaded and asked for its data */
  private readonly pagesReady = new Set<AptDocument>();

  /** Import state each page was last sent: unresolved imports, and where each movie came from */
  private readonly imported = new Map<
    AptDocument,
    { unresolved: string[]; origins: Record<string, string> }
  >();

  /** Folder the page bundle is built into */
  private readonly scripts: vscode.Uri;

  /** Finds the movies imports name, the way the game does */
  private readonly library: AptLibrary;

  private readonly imports: AptMovieImports;

  /** Action blocks opened as tabs */
  private readonly scriptTabs: AptScripts;

  /** Movies opened as text */
  private readonly textView: AptTextView;

  private readonly disposables: vscode.Disposable[];

  public constructor(
    private readonly tools: ToolBox,
    private readonly locator: EntryLocator,
    archiveModel: ArchiveModel,
    extensionUri: vscode.Uri,
    private readonly game: AptGameServices,
  ) {
    this.scripts = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
    this.library = new AptLibrary(archiveModel);
    this.imports = createAptMovieImports({
      library: this.library,
      game,
      findDocument: (key) => this.open.get(key),
      load: (uri) => AptDocument.open(uri, locator, tools),
    });
    this.library.onDidChange(() => {
      this.imports.forget();
      this.redrawAll();
    });
    this.scriptTabs = new AptScripts({
      document: (movie) => this.open.get(movie),
      save: (document, block, text) =>
        editScript(this.record, document, block, text),
    });
    this.textView = new AptTextView({
      document: (movie) => this.open.get(movie),
      load: (movie) => AptDocument.open(movie, locator, tools),
      commit: async (document, saved) => {
        await this.record(document, 'text', async () =>
          document.restore({
            apt: saved.apt,
            constBytes: saved.constBytes,
            files: document.files,
          }),
        );
        // Saving the text saves the movie, so the editor is not left dirty
        if (!(await vscode.workspace.save(document.uri))) {
          await document.save();
        }
      },
      isReadOnly: (movie) => !isEditable(archiveModel, movie),
    });
    this.disposables = [
      this.scriptTabs,
      this.textView,
      this.problems,
      this.library,
    ];
  }

  /** Creates the provider and registers it under `APT_VIEW_TYPE` */
  public static register(
    tools: ToolBox,
    locator: EntryLocator,
    archiveModel: ArchiveModel,
    extensionUri: vscode.Uri,
    game: AptGameServices,
  ): AptEditorProvider {
    const provider = new AptEditorProvider(
      tools,
      locator,
      archiveModel,
      extensionUri,
      game,
    );

    provider.disposables.push(
      vscode.window.registerCustomEditorProvider(APT_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
    );
    return provider;
  }

  /** Disposes the registration, the script tabs, the text view and the problems shown */
  public dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** Finds an open movie by its `.apt` uri, as edited */
  public findDocument(key: string): AptDocument | undefined {
    return this.open.get(key);
  }

  /** Whether a document's page has loaded and asked for its data */
  public isPageReady(document: AptDocument): boolean {
    return this.pagesReady.has(document);
  }

  /** Gets the import state a document's page was last sent, for automation and tests */
  public getShownImports(
    document: AptDocument,
  ): { unresolved: string[]; origins: Record<string, string> } | undefined {
    return this.imported.get(document);
  }

  /** Draws a document's page again, when one is open */
  public async redraw(document: AptDocument): Promise<void> {
    await this.redraws.get(document)?.();
  }

  /** Applies an edit as one undoable step, as the page's edits are */
  public edit(document: AptDocument, edit: AptEdit): Promise<EditResult> {
    return editDocument(this.record, document, edit);
  }

  /** Attaches a new, empty script as one undoable step; returns its block */
  public addScript(document: AptDocument, site: ScriptSite): Promise<number> {
    return addScript(this.record, document, site);
  }

  /** Opens an action block in its own editor tab */
  public openScript(
    document: AptDocument,
    block: number,
    label: string,
  ): Promise<vscode.Uri> {
    return this.scriptTabs.open(document, block, label);
  }

  /** Opens a movie, restoring a hot-exit backup when there is one */
  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<AptDocument> {
    const document = await AptDocument.open(uri, this.locator, this.tools);

    if (context.backupId) {
      document.restoreBackup(
        await vscode.workspace.fs.readFile(vscode.Uri.parse(context.backupId)),
      );
    }

    return document;
  }

  /** Saves the movie and the files its edits added */
  public async saveCustomDocument(document: AptDocument): Promise<void> {
    await document.save();
  }

  /** Saves the movie and its `.const` beside `destination` */
  public async saveCustomDocumentAs(
    document: AptDocument,
    destination: vscode.Uri,
  ): Promise<void> {
    await document.save(destination);
  }

  /** Reads the movie from disk again, keeping the document its pages hold */
  public async revertCustomDocument(document: AptDocument): Promise<void> {
    const fresh = await AptDocument.open(
      document.uri,
      this.locator,
      this.tools,
    );

    document.restore(fresh.snapshot());
    await this.redraws.get(document)?.();
  }

  /** Writes a hot-exit backup of the movie as edited */
  public async backupCustomDocument(
    document: AptDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(context.destination, document.backup());

    return {
      id: context.destination.toString(),
      delete: () => vscode.workspace.fs.delete(context.destination),
    };
  }

  /** Runs a change, records how to undo it, and redraws */
  private readonly record: RecordChange = async (document, label, change) => {
    const before = document.snapshot();
    let result;

    try {
      result = await change();
    } catch (error) {
      document.restore(before);
      throw error;
    }

    const after = document.snapshot();
    // Another open movie can import this one, so every page draws again,
    // and a script tab of this one reads its block again
    const redraw = async () => {
      await this.redrawAll();
      this.scriptTabs.notifyChanged(document);
      this.textView.changed(document.uri);
    };

    this.onDidChangeEmitter.fire({
      document,
      label,
      undo: async () => {
        document.restore(before);
        await redraw();
      },
      redo: async () => {
        document.restore(after);
        await redraw();
      },
    });
    await redraw();

    return result;
  };

  /** Redraws every open page */
  private redrawAll(): Promise<void> {
    return Promise.all(
      [...this.redraws.values()].map((redraw) => redraw().catch(() => {})),
    ).then(() => undefined);
  }

  /** Fills a panel with the editor page and wires it to the document */
  public async resolveCustomEditor(
    document: AptDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.scripts],
    };
    panel.webview.html = renderAptPage(
      panel.webview,
      panel.webview.asWebviewUri(vscode.Uri.joinPath(this.scripts, 'apt.js')),
    );

    const sentTextures = new Set<string>();
    const sentMovies = new Map<string, string>();
    const post = (message: ToPage) => panel.webview.postMessage(message);

    this.redraws.set(document, async () => {
      const message = await this.imports.buildMovieMessage(
        document,
        sentTextures,
        sentMovies,
      );

      this.imported.set(document, {
        unresolved: message.unresolved,
        origins: message.origins,
      });
      await post(message);
      await post({
        kind: 'integrity',
        problems: await checkAptDocument(
          this.problems,
          document,
          message.unresolved,
        ),
      });
    });
    this.open.set(document.uri.toString(), document);

    const subscription = panel.webview.onDidReceiveMessage((message) =>
      dispatchPageMessage(message, {
        document,
        post,
        sentTextures,
        sentMovies,
        record: this.record,
        ready: async () => {
          this.pagesReady.add(document);
          await this.redraws.get(document)?.();
        },
        imports: this.imports,
        library: this.library,
        game: this.game,
        locator: this.locator,
        scriptTabs: this.scriptTabs,
        textView: this.textView,
      }),
    );

    panel.onDidDispose(() => {
      subscription.dispose();
      this.redraws.delete(document);
      this.open.delete(document.uri.toString());
      // A text view showed this editor's unsaved state; it reads the files again
      this.textView.changed(document.uri);
      this.pagesReady.delete(document);
      this.imported.delete(document);
    });
  }
}
