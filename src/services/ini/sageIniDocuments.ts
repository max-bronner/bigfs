import { EventEmitter, Uri, workspace } from 'vscode';
import type { Disposable, TextDocument } from 'vscode';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';
import type { SageGame, SageIniSchema } from '../../formats/ini/sageIniSchema';
import { isFragmentPath, parseSageIni } from '../../formats/ini/sageIniParser';
import type { SageDocument } from '../../formats/ini/sageIniParser';

/**
 * Reads the schema once and parses each open document once per edit, so every
 * provider works from the same answer instead of redoing the same parse on
 * every keystroke.
 *
 * This is the one thing everything in `providers/` depends on. A new provider
 * needs nothing more than a `SageIniDocuments` to read a file the same way the
 * rest of the language support does.
 */

/** Where the generated schema sits inside the packaged extension */
const SCHEMA_PATH = ['assets', 'sageIniSchema.json'];

/** How many parses are kept, roughly one per document open at a time */
const PARSE_CACHE_LIMIT = 8;

/** Setting naming the game whose grammar applies */
const GAME_SETTING = 'bigfs.ini.game';

export class SageIniDocuments implements Disposable {
  private schema?: Promise<SageIniSchema>;
  private parses = new Map<string, { version: number; parsed: SageDocument }>();
  private readonly subscriptions: Disposable[];

  private readonly onDidChangeSchemaEmitter = new EventEmitter<void>();

  /** Fires when another game is picked, after which every parse is stale */
  public readonly onDidChangeSchema = this.onDidChangeSchemaEmitter.event;

  public constructor(private readonly extensionUri: Uri) {
    this.subscriptions = [
      // A closed document's parse is never asked for again
      workspace.onDidCloseTextDocument((document) =>
        this.parses.delete(document.uri.toString()),
      ),
      workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(GAME_SETTING)) {
          this.schema = undefined;
          this.parses.clear();
          this.onDidChangeSchemaEmitter.fire();
        }
      }),
      this.onDidChangeSchemaEmitter,
    ];
  }

  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /** Reads the data file once, however many providers ask for it */
  public getSchema(): Promise<SageIniSchema> {
    this.schema ??= this.loadSchema();

    return this.schema;
  }

  /**
   * Parses a document, reusing the last parse when the document has not
   * changed since. Several providers run over the same document on one
   * keystroke, and a full-file parse is not free.
   */
  public async parse(document: TextDocument): Promise<SageDocument> {
    const key = document.uri.toString();
    const cached = this.parses.get(key);

    if (cached?.version === document.version) {
      return cached.parsed;
    }

    const parsed = parseSageIni(
      document.getText().split(/\r?\n/),
      await this.getSchema(),
      { isFragment: isFragmentPath(document.uri.path) },
    );

    if (this.parses.size >= PARSE_CACHE_LIMIT) {
      this.parses.delete(this.parses.keys().next().value as string);
    }

    this.parses.set(key, { version: document.version, parsed });

    return parsed;
  }

  private async loadSchema(): Promise<SageIniSchema> {
    const uri = Uri.joinPath(this.extensionUri, ...SCHEMA_PATH);
    const content = await workspace.fs.readFile(uri);

    const game = workspace
      .getConfiguration()
      .get<SageGame>(GAME_SETTING, 'rotwk');

    return createSageIniSchema(
      JSON.parse(new TextDecoder().decode(content)),
      game,
    );
  }
}
