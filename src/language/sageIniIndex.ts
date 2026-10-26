import { FileType, ProgressLocation, Uri, window, workspace } from 'vscode';
import type { Disposable, LogOutputChannel } from 'vscode';
import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import { getFileNodes } from '../model/virtualNode';
import { getNodeUri } from '../model/nodeAddress';
import { FRAGMENT_CONTEXT, ROOT_CONTEXT } from './model/sageIniSchema';
import type { SageIniSchema } from './model/sageIniSchema';
import { isFragmentPath, parseSageIni } from './model/sageIniParser';
import { findString, parseStringTable } from './model/sageStringTable';
import type { SageString } from './model/sageStringTable';
import { decodeWindows1252 } from '../common/windows1252';

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
}

/**
 * Whether a string table is a map's own, which the engine searches only after
 * the game's main table, so its records never replace the main one's
 */
const isMapStringTable = (uri: Uri): boolean =>
  uri.path.toLowerCase().endsWith('/map.str');

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

const ENTRY_PATTERN = /\.(ini|inc|bhav|str)$/i;

/** Glob for the same files loose in the workspace, as an unpacked mod holds them */
const LOOSE_PATTERN = '**/*.{ini,inc,bhav,str,INI,INC,BHAV,STR}';
/** The shape every macro name takes, which is also how enum words are written */
const CONSTANT_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

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

  /** Every string table record, by lowercased label */
  private strings = new Map<string, SageStringPlace>();

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
    ];
  }

  public dispose(): void {
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
    this.strings.clear();
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
    return findString(this.strings, value) as SageStringPlace | undefined;
  }

  /** How many string table records are indexed */
  public get stringCount(): number {
    return this.strings.size;
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
      this.definitions.get(namespace.toLowerCase())?.get(name.toLowerCase()) ??
      []
    );
  }

  /** How many distinct names a namespace declares across everything indexed */
  public countDefinitions(namespace: string): number {
    return this.definitions.get(namespace.toLowerCase())?.size ?? 0;
  }

  /**
   * Every name declared in a namespace, in the casing it was declared with.
   * This is what completion offers on a reference field's value.
   */
  public getNames(namespace: string): string[] {
    const byName = this.definitions.get(namespace.toLowerCase());

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
    return (
      this.references.get(namespace.toLowerCase())?.get(name.toLowerCase()) ??
      []
    );
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
          title: 'bigFS: indexing INI definitions',
        },
        () => this.build(),
      );
    } catch (error) {
      // A failed index leaves navigation empty rather than breaking the editor
      this.log.error('Failed to index INI definitions', error);
    } finally {
      this.building = undefined;
    }
  }

  private forget(rootKey: string): void {
    if (!this.indexed.delete(rootKey)) {
      return;
    }

    purgeNamespaced(this.definitions, rootKey);
    purgeNamespaced(this.references, rootKey);
    purgeOne(this.macros, rootKey);
    purgeList(this.constantUses, rootKey);
    purgeOne(this.strings, rootKey);
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
      '**/node_modules/**',
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
  }

  /** Reads one INI file from disk into the index */
  private async indexLooseFile(
    uri: Uri,
    schema?: SageIniSchema,
  ): Promise<void> {
    const content = await workspace.fs.readFile(uri);

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
        this.indexContent(getNodeUri(node), node.entryPath, content, schema);
      },
    );
  }

  /** Records the records of one string table, behind the main table's */
  private indexStrings(uri: Uri, text: string): void {
    const isMapTable = isMapStringTable(uri);

    for (const [key, record] of parseStringTable(text)) {
      const existing = this.strings.get(key);

      if (!existing || (isMapStringTable(existing.uri) && !isMapTable)) {
        this.strings.set(key, { ...record, uri });
      }
    }
  }

  /** Records the definitions, macros and references of one file */
  private indexContent(
    uri: Uri,
    entryPath: string,
    content: Uint8Array,
    schema: SageIniSchema,
  ): void {
    // The WHATWG `latin1` decoder is Windows-1252, which is what the text in
    // the string tables means: 0x92 is an apostrophe there
    const text = decodeWindows1252(content);

    if (entryPath.toLowerCase().endsWith('.str')) {
      this.indexStrings(uri, text);
      return;
    }

    const lines = text.split(/\r?\n/);
    const parsed = parseSageIni(lines, schema, {
      isFragment: isFragmentPath(entryPath),
    });

    parsed.macros.forEach((macro) => {
      this.macros.set(macro.name.toLowerCase(), {
        name: macro.name,
        value: macro.value,
        uri,
        line: macro.line,
        start: macro.start,
        end: macro.end,
      });
    });

    parsed.statements.forEach((statement) => {
      const { block, context, keyword, line, values } = statement;

      // A block at file scope declares a name others can reference
      const isFileScope =
        context === ROOT_CONTEXT ||
        (context === FRAGMENT_CONTEXT && schema.isEngineBlock(keyword.text));

      if (block && isFileScope && values.length) {
        record(this.definitions, keyword.text, values[0].text, {
          uri,
          line,
          endLine: block.endLine,
          keyword: keyword.text,
          name: values[0].text,
          start: values[0].start,
          end: values[0].end,
        });

        return;
      }

      if (block) {
        return;
      }

      // A SCREAMING_SNAKE value may turn out to be a macro once every file
      // has been read, so its use is kept either way
      values.forEach((value) => {
        if (!CONSTANT_PATTERN.test(value.text)) {
          return;
        }

        const key = value.text.toLowerCase();

        this.constantUses.set(key, [
          ...(this.constantUses.get(key) ?? []),
          {
            uri,
            line,
            start: value.start,
            end: value.end,
            field: keyword.text,
          },
        ]);
      });

      // A reference field's values name definitions elsewhere. A
      // polymorphic field is recorded under each namespace it could mean,
      // since which one holds the name is not known until it is looked up.
      const namespaces = schema.getReferenceNamespaces(keyword.text, context);

      if (!namespaces.length) {
        return;
      }

      values.forEach((value) =>
        namespaces.forEach((namespace) =>
          record(this.references, namespace, value.text, {
            uri,
            line,
            start: value.start,
            end: value.end,
            field: keyword.text,
          }),
        ),
      );
    });
  }
}
