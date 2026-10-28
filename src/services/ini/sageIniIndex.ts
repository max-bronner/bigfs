import { FileType, ProgressLocation, Uri, window, workspace } from "vscode";
import type { Disposable, LogOutputChannel, TextDocument } from "vscode";
import type { ArchiveModel } from "../archives/archiveModel";
import type { VirtualNode } from "../archives/virtualNode";
import { getFileNodes } from "../archives/virtualNode";
import { getNodeUri } from "../archives/nodeAddress";
import type { SageIniSchema } from "../../formats/ini/sageIniSchema";
import { languageOfArchive } from "../../game/text/gameLanguage";
import {
  FILE_USES,
  collectEntries,
  reachedThroughMacros,
} from "../../formats/ini/sageIniEntries";
import type { EntryBodyToken } from "../../formats/ini/sageIniEntries";
import { canonicalNamespace } from "../../formats/ini/sageReferenceFields";
import { SAGE_INI_LANGUAGE } from "../../constants";
import { findString, parseStringTable } from "../../formats/str/sageStringTable";
import type { SageString } from "../../formats/str/sageStringTable";
import { decodeIniText } from "../../core/windows1252";

/**
 * Where every definition, reference and macro in every open archive lives, so
 * a name can be followed in every direction the editor asks for.
 *
 * A reference does not say which archive holds its target, and in a real
 * install it usually is not the one being edited: a mod's `Object` refers to a
 * `Weapon` in the base game's `INI.big`. So the index spans every archive the
 * model knows and a lookup never has to guess which file to open.
 *
 * Everything is recorded in the same pass over an entry, because reading it is
 * the expensive part and every question - where is this declared, what uses
 * it, is this a macro - needs exactly the same parse to answer.
 */

/** Where a name was declared, by a block at file scope */
export interface SageDefinition {
  uri: Uri;
  /** Line of the block header, which is what a jump reveals */
  line: number;
  /**
   * Line of the block's closing `End`. Carried so a jump can hand the editor
   * the whole block as its target range, which is what makes the ctrl-hover
   * preview show the definition rather than one line of it.
   */
  endLine: number;
  /** The block keyword that declared it, which is the namespace */
  keyword: string;
  /** Columns of the name on its line, which a rename replaces */
  start: number;
  end: number;
  /** As written, so a completion offers the corpus's own casing */
  name: string;
}

/**
 * A `#define` and where it was written. Macros are a flat global namespace:
 * once any file defines one, every later file sees it, which is why they are
 * indexed alongside definitions rather than per file.
 */
export interface SageMacro {
  name: string;
  /** The replacement text, which a hover shows */
  value: string;
  /** Columns of the name on its line, which a rename replaces */
  start: number;
  end: number;
  uri: Uri;
  line: number;
}

/** A string table record and the file that holds it */
export interface SageStringPlace extends SageString {
  uri: Uri;
  /** The language of the `lang/<Language>.big` it came from; none for a loose file */
  language?: string;
}

/**
 * Whether a string table is a map's own, which the engine searches only after
 * the game's main table, so its records never replace the main one's
 */
const isMapStringTable = (uri: Uri): boolean =>
  uri.path.toLowerCase().endsWith("/map.str");

/** Where a name was used, as the value of a reference field or a macro */
export interface SageReference {
  uri: Uri;
  line: number;
  /** Columns of the value token, so the peek view can highlight it */
  start: number;
  end: number;
  /** The field the value sat on, for the peek header */
  field: string;
}

export { FILE_USES };

/** A token of a macro's body and the file that holds it */
interface SageBodyToken extends EntryBodyToken {
  uri: Uri;
}

/** How long typing has to pause before an open document is read again */
const OPEN_DOCUMENT_DELAY_MS = 300;

const ENTRY_PATTERN = /\.(ini|inc|bhav|str)$/i;

/** Glob for the same files loose in the workspace, as an unpacked mod holds them */
const LOOSE_PATTERN = "**/*.{ini,inc,bhav,str,INI,INC,BHAV,STR}";

/** Whether a node is an entry this index reads */
const isSageEntry = (node: VirtualNode): boolean =>
  node.type === FileType.File && ENTRY_PATTERN.test(node.entryPath);

/** Adds an entry to a namespace keyed table, folding both keys */
const record = <T>(
  table: Map<string, Map<string, T[]>>,
  namespace: string,
  name: string,
  value: T,
): void => {
  const byName = table.get(namespace.toLowerCase()) ?? new Map<string, T[]>();
  const key = name.toLowerCase();

  byName.set(key, [...(byName.get(key) ?? []), value]);
  table.set(namespace.toLowerCase(), byName);
};

/**
 * Whether a place was contributed by what a key names: an archive's root,
 * which holds many files, or one loose file
 */
const isUnderRoot = ({ uri }: { uri: Uri }, rootKey: string): boolean => {
  const path = uri.path.toLowerCase();

  return path === rootKey || path.startsWith(`${rootKey}/`);
};

/** Drops the places an archive contributed from a flat name-to-places table */
const purgeList = <T extends { uri: Uri }>(
  table: Map<string, T[]>,
  rootKey: string,
): void => {
  for (const [key, places] of table) {
    const kept = places.filter((place) => !isUnderRoot(place, rootKey));

    if (kept.length) {
      table.set(key, kept);
    } else {
      table.delete(key);
    }
  }
};

/** Drops the entries an archive contributed from a flat single-value table */
const purgeOne = <T extends { uri: Uri }>(
  table: Map<string, T>,
  rootKey: string,
): void => {
  for (const [key, value] of table) {
    if (isUnderRoot(value, rootKey)) {
      table.delete(key);
    }
  }
};

/** Drops the places an archive contributed from a namespace-keyed table */
const purgeNamespaced = <T extends { uri: Uri }>(
  table: Map<string, Map<string, T[]>>,
  rootKey: string,
): void => {
  for (const byName of table.values()) {
    purgeList(byName, rootKey);
  }
};

export class SageIniIndex implements Disposable {
  private definitions = new Map<string, Map<string, SageDefinition[]>>();
  private references = new Map<string, Map<string, SageReference[]>>();

  /** Every `#define`, folded, since the dialect matches names without casing */
  private macros = new Map<string, SageMacro>();

  /**
   * Where every SCREAMING_SNAKE value was written, folded. Whether such a name
   * is a macro or an enum word depends on files that may not be read yet, so
   * every candidate is kept and the macro table decides at lookup time.
   */
  private constantUses = new Map<string, SageReference[]>();

  /**
   * Every token of every macro body, by lowercased text. A macro written as a
   * field's value stands for its body, so what the body spells is used there.
   */
  private bodyTokens = new Map<string, SageBodyToken[]>();

  /**
   * The files whose entries are in the tables, by lowercased address. A file
   * read twice - by overlapping scans, or from disk and from the editor -
   * replaces its first entries instead of adding to them.
   */
  private indexedFiles = new Set<string>();

  /** The version of each open document the index last read, by address */
  private openVersions = new Map<string, number>();

  private readonly pendingOpen = new Map<string, NodeJS.Timeout>();

  /** Every string table record of every language, by lowercased label, in load order */
  private strings = new Map<string, SageStringPlace[]>();

  /** The records of the chosen language, built when first asked for */
  private activeStrings?: Map<string, SageStringPlace>;
  private language?: string;

  /** Archives and loose files already read, by key, so a rescan only does the new ones */
  private indexed = new Set<string>();

  private building?: Promise<void>;
  private readonly subscriptions: Disposable[];

  public constructor(
    private readonly archiveModel: ArchiveModel,
    private readonly getSchema: () => Promise<SageIniSchema>,
    private readonly log: LogOutputChannel,
  ) {
    const watcher = workspace.createFileSystemWatcher(LOOSE_PATTERN);
    const reindexLooseFile = (uri: Uri) => {
      this.forget(uri.path.toLowerCase());

      if (this.indexed.size) {
        void this.indexLooseFile(uri).catch((error: unknown) =>
          this.log.error(`Failed to index ${uri.fsPath}`, error),
        );
      }
    };

    this.subscriptions = [
      // An archive that changed on disk has to be read again, and one that was
      // removed has to stop answering lookups
      archiveModel.onDidChangeArchive(({ rootPath }) => {
        this.forget(rootPath.toLowerCase());
      }),
      watcher,
      watcher.onDidChange(reindexLooseFile),
      watcher.onDidCreate(reindexLooseFile),
      watcher.onDidDelete((uri) => this.forget(uri.path.toLowerCase())),
      // What is typed and not yet saved is what a rename has to edit
      workspace.onDidChangeTextDocument(({ document }) =>
        this.readSoon(document),
      ),
      workspace.onDidCloseTextDocument((document) =>
        this.restoreFromDisk(document),
      ),
    ];
  }

  public dispose(): void {
    this.pendingOpen.forEach((timeout) => clearTimeout(timeout));
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /**
   * Drops everything indexed, after which the next lookup reads every file
   * again. Called when another game is picked, whose grammar reads some lines
   * differently.
   */
  public reset(): void {
    this.definitions.clear();
    this.references.clear();
    this.macros.clear();
    this.constantUses.clear();
    this.bodyTokens.clear();
    this.indexedFiles.clear();
    this.openVersions.clear();
    this.strings.clear();
    this.activeStrings = undefined;
    this.indexed.clear();
  }

  /**
   * The macro a name defines, if it is one. Checked before any namespace: a
   * macro reference is written exactly like a cross reference, and the engine
   * substitutes the macro before anything else looks at the value.
   */
  public findMacro(name: string): SageMacro | undefined {
    return this.macros.get(name.toLowerCase());
  }

  /**
   * The string table record an INI value names, such as the text a
   * `DisplayName = OBJECT:GondorFighter` shows, if it names one
   */
  public findString(value: string): SageStringPlace | undefined {
    return findString(this.activeTable(), value) as SageStringPlace | undefined;
  }

  /** How many string table records are indexed in the chosen language */
  public get stringCount(): number {
    return this.activeTable().size;
  }

  /**
   * Picks the language game text is read in. Records from a language archive
   * of another language stop answering; loose tables answer in every one.
   */
  public setLanguage(language: string | undefined): void {
    if (language !== this.language) {
      this.language = language;
      this.activeStrings = undefined;
    }
  }

  /**
   * One record per label: the first in load order that is in the chosen
   * language, a map's own table only when the main tables have none
   */
  private activeTable(): Map<string, SageStringPlace> {
    if (!this.activeStrings) {
      const table = new Map<string, SageStringPlace>();

      for (const [key, places] of this.strings) {
        const usable = places.filter(
          (place) => !place.language || place.language === this.language,
        );
        const chosen =
          usable.find((place) => !isMapStringTable(place.uri)) ?? usable[0];

        if (chosen) {
          table.set(key, chosen);
        }
      }
      this.activeStrings = table;
    }
    return this.activeStrings;
  }

  /** Every place a macro is used, which is what find references answers with */
  public findMacroUses(name: string): readonly SageReference[] {
    return this.constantUses.get(name.toLowerCase()) ?? [];
  }

  /** Every macro name, which completion offers on any field */
  public getMacroNames(): SageMacro[] {
    return [...this.macros.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Every place a name is declared in a namespace */
  public findDefinitions(
    namespace: string,
    name: string,
  ): readonly SageDefinition[] {
    return (
      this.definitions
        .get(canonicalNamespace(namespace).toLowerCase())
        ?.get(name.toLowerCase()) ?? []
    );
  }

  /** How many distinct names a namespace declares across everything indexed */
  public countDefinitions(namespace: string): number {
    return (
      this.definitions.get(canonicalNamespace(namespace).toLowerCase())?.size ??
      0
    );
  }

  /**
   * Every name declared in a namespace, in the casing it was declared with.
   * This is what completion offers on a reference field's value.
   */
  public getNames(namespace: string): string[] {
    const byName = this.definitions.get(
      canonicalNamespace(namespace).toLowerCase(),
    );

    if (!byName) {
      return [];
    }

    const names = new Set<string>();

    for (const definitions of byName.values()) {
      definitions.forEach((definition) => names.add(definition.name));
    }

    return [...names].sort();
  }

  /**
   * Every definition no reference field anywhere names, in the namespaces
   * some reference field can name at all; `include` picks which places count
   */
  public findUnreferenced(
    include: (definition: SageDefinition) => boolean,
    skip: ReadonlySet<string>,
  ): SageDefinition[] {
    const unused: SageDefinition[] = [];

    for (const [namespace, byName] of this.definitions) {
      if (skip.has(namespace) || !this.references.has(namespace)) {
        continue;
      }

      const named = this.references.get(namespace)!;

      for (const [name, definitions] of byName) {
        if (!named.get(name)?.length) {
          unused.push(...definitions.filter(include));
        }
      }
    }
    return unused;
  }

  /** Every place a name is used as a reference value */
  public findReferences(
    namespace: string,
    name: string,
  ): readonly SageReference[] {
    const key = canonicalNamespace(namespace).toLowerCase();
    const folded = name.toLowerCase();
    const written = this.references.get(key);
    const direct = written?.get(folded) ?? [];
    const holders = this.bodyTokens.get(folded);

    if (!holders?.length || !written) {
      return direct;
    }

    // A macro written as a value of a field naming this namespace stands for
    // its body, so the body's spelling of the name is a use of it too
    const viaMacros = reachedThroughMacros(
      holders,
      this.bodyTokens,
      (macro) => (written.get(macro)?.length ?? 0) > 0,
    ).map(
      (holder): SageReference => ({
        uri: holder.uri,
        line: holder.line,
        start: holder.start,
        end: holder.end,
        field: `#define ${this.macros.get(holder.macro)?.name ?? holder.macro}`,
      }),
    );

    return [...direct, ...viaMacros];
  }

  /**
   * Resolves once every archive known at the time of the call has been read.
   * Reading a full install takes seconds, so the first caller to arrive puts a
   * progress notification up rather than leaving the editor looking idle.
   */
  public whenReady(): Promise<void> {
    this.building ??= this.buildWithProgress();

    return this.building;
  }

  private async buildWithProgress(): Promise<void> {
    try {
      await window.withProgress(
        {
          location: ProgressLocation.Window,
          title: "bigFS: indexing INI definitions",
        },
        () => this.build(),
      );
    } catch (error) {
      // A failed index leaves navigation empty rather than breaking the editor
      this.log.error("Failed to index INI definitions", error);
    } finally {
      this.building = undefined;
    }
  }

  private forget(rootKey: string): void {
    if (this.indexed.delete(rootKey)) {
      this.purge(rootKey);
    }
  }

  /** Drops everything a root or a single file contributed */
  private purge(rootKey: string): void {
    for (const file of this.indexedFiles) {
      if (file === rootKey || file.startsWith(`${rootKey}/`)) {
        this.indexedFiles.delete(file);
      }
    }

    purgeNamespaced(this.definitions, rootKey);
    purgeNamespaced(this.references, rootKey);
    purgeOne(this.macros, rootKey);
    purgeList(this.constantUses, rootKey);
    purgeList(this.bodyTokens, rootKey);
    purgeList(this.strings, rootKey);
    this.activeStrings = undefined;
  }

  /**
   * Whether a document is one this index reads from the editor's text. Only
   * an INI or fragment: string tables are read from disk alone.
   */
  private isOpenIni(document: TextDocument): boolean {
    return (
      document.languageId === SAGE_INI_LANGUAGE &&
      /\.(ini|inc|bhav)$/i.test(document.uri.path)
    );
  }

  /** Reads an open document's text once typing pauses, if the index is built */
  private readSoon(document: TextDocument): void {
    if (!this.indexed.size || !this.isOpenIni(document)) {
      return;
    }

    const key = document.uri.toString();

    clearTimeout(this.pendingOpen.get(key));
    this.pendingOpen.set(
      key,
      setTimeout(() => {
        this.pendingOpen.delete(key);
        void this.readOpenDocument(document);
      }, OPEN_DOCUMENT_DELAY_MS),
    );
  }

  /** Replaces what a document contributed with what the editor holds now */
  private async readOpenDocument(document: TextDocument): Promise<void> {
    const schema = await this.getSchema();

    // Checked and applied with no await between, so two reads of the same
    // document cannot both purge and then both add
    if (
      document.isClosed ||
      this.openVersions.get(document.uri.toString()) === document.version
    ) {
      return;
    }

    this.openVersions.set(document.uri.toString(), document.version);
    this.purge(document.uri.path.toLowerCase());
    this.indexText(document.uri, document.uri.path, document.getText(), schema);
  }

  /**
   * Brings the index level with every open document's text, which a rename or
   * a find-references calls first so the places it edits are the ones on
   * screen and not the ones last saved.
   */
  public async syncOpenDocuments(): Promise<void> {
    for (const document of workspace.textDocuments) {
      if (this.isOpenIni(document)) {
        clearTimeout(this.pendingOpen.get(document.uri.toString()));
        this.pendingOpen.delete(document.uri.toString());
        await this.readOpenDocument(document);
      }
    }
  }

  /** A closed document's unsaved edits are gone, so the saved file is read again */
  private restoreFromDisk(document: TextDocument): void {
    const key = document.uri.toString();

    clearTimeout(this.pendingOpen.get(key));
    this.pendingOpen.delete(key);

    if (this.openVersions.delete(key)) {
      void this.indexLooseFile(document.uri, undefined, true).catch(
        (error: unknown) =>
          this.log.error(`Failed to index ${document.uri.fsPath}`, error),
      );
    }
  }

  private async build(): Promise<void> {
    const schema = await this.getSchema();

    for (const root of this.archiveModel.getArchiveRoots()) {
      const rootKey = root.archive.rootKey;

      if (this.indexed.has(rootKey)) {
        continue;
      }

      try {
        await this.indexArchive(root, schema);
        this.indexed.add(rootKey);
      } catch (error) {
        // One unreadable archive must not stop the rest being indexed
        this.log.error(`Failed to index ${root.archive.archivePath}`, error);
      }
    }

    // Loose files are read after the archives, so a definition in an unpacked
    // mod comes after the one it overrides, as it does in the engine
    for (const uri of await workspace.findFiles(
      LOOSE_PATTERN,
      "**/node_modules/**",
    )) {
      if (this.indexed.has(uri.path.toLowerCase())) {
        continue;
      }

      try {
        await this.indexLooseFile(uri, schema);
      } catch (error) {
        this.log.error(`Failed to index ${uri.fsPath}`, error);
      }
    }

    // What is open and unsaved is newer than anything read from disk
    await this.syncOpenDocuments();
  }

  /** Reads one INI file from disk into the index */
  private async indexLooseFile(
    uri: Uri,
    schema?: SageIniSchema,
    replace = false,
  ): Promise<void> {
    const content = await workspace.fs.readFile(uri);

    if (replace) {
      this.purge(uri.path.toLowerCase());
    }

    this.indexContent(
      uri,
      uri.path,
      content,
      schema ?? (await this.getSchema()),
    );
    this.indexed.add(uri.path.toLowerCase());
  }

  private async indexArchive(
    root: VirtualNode,
    schema: SageIniSchema,
  ): Promise<void> {
    await this.archiveModel.loadArchiveOf(root);

    const entries = getFileNodes(root).filter(isSageEntry);

    if (!entries.length) {
      return;
    }

    await this.archiveModel.readFiles(
      entries.map((node) => ({ node })),
      async ({ node }, content) => {
        this.indexContent(
          getNodeUri(node),
          node.entryPath,
          content,
          schema,
          languageOfArchive(root.archive.archivePath),
        );
      },
    );
  }

  /** Records the records of one string table, behind the main table's */
  private indexStrings(uri: Uri, text: string, language?: string): void {
    for (const [key, record] of parseStringTable(text)) {
      this.strings.set(key, [
        ...(this.strings.get(key) ?? []),
        { ...record, uri, language },
      ]);
    }
    this.activeStrings = undefined;
  }

  /** Records the definitions, macros and references of one file */
  private indexContent(
    uri: Uri,
    entryPath: string,
    content: Uint8Array,
    schema: SageIniSchema,
    language?: string,
  ): void {
    // The WHATWG `latin1` decoder is Windows-1252, which is what the text in
    // the string tables means: 0x92 is an apostrophe there
    this.indexText(uri, entryPath, decodeIniText(content), schema, language);
  }

  private indexText(
    uri: Uri,
    entryPath: string,
    text: string,
    schema: SageIniSchema,
    language?: string,
  ): void {
    if (entryPath.toLowerCase().endsWith(".str")) {
      this.indexStrings(uri, text, language);
      return;
    }

    const fileKey = uri.path.toLowerCase();

    if (this.indexedFiles.has(fileKey)) {
      this.purge(fileKey);
    }

    this.indexedFiles.add(fileKey);

    const entries = collectEntries(text, entryPath, schema);

    entries.macros.forEach((macro) => {
      this.macros.set(macro.name.toLowerCase(), { ...macro, uri });
    });

    entries.bodyTokens.forEach((token) => {
      const list = this.bodyTokens.get(token.text) ?? [];

      list.push({ ...token, uri });
      this.bodyTokens.set(token.text, list);
    });

    entries.definitions.forEach(({ namespace, ...definition }) =>
      record(this.definitions, namespace, definition.name, {
        uri,
        ...definition,
      }),
    );

    entries.constantUses.forEach(({ key, ...use }) =>
      this.constantUses.set(key, [
        ...(this.constantUses.get(key) ?? []),
        { uri, ...use },
      ]),
    );

    entries.references.forEach(({ namespace, name, ...place }) =>
      record(this.references, namespace, name, { uri, ...place }),
    );
  }
}
