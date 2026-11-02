import type { Uri } from 'vscode';
import type {
  EntryBodyToken,
  FileEntries,
} from '../../formats/ini/sageIniEntries';
import type { SageString } from '../../formats/str/sageStringTable';

/** Declaration of a name by a block at file scope, and where it sits */
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

/** Use of a name as the value of a reference field or a macro, and where it sits */
export interface SageReference {
  uri: Uri;
  line: number;
  /** Columns of the value token, so the peek view can highlight it */
  start: number;
  end: number;
  /** The field the value sat on, for the peek header */
  field: string;
}

/** A token of a macro's body and the file that holds it */
export interface SageBodyToken extends EntryBodyToken {
  uri: Uri;
}

/** The keys of every table a file wrote to, which is all a purge has to visit */
interface FileContribution {
  /** Lowercased namespace to the lowercased names it declared */
  definitions: Map<string, Set<string>>;
  references: Map<string, Set<string>>;
  macros: Set<string>;
  constantUses: Set<string>;
  bodyTokens: Set<string>;
  strings: Set<string>;
}

/**
 * The index's tables and the file each entry came from. A file read again
 * replaces what it wrote before, and a purge touches only the keys the files
 * it drops wrote, so re-reading one open document does not scan the tables of
 * a whole install.
 */
export interface SageIniTables {
  /** Namespace, then name, both lowercased */
  readonly definitions: Map<string, Map<string, SageDefinition[]>>;
  readonly references: Map<string, Map<string, SageReference[]>>;
  /** Every `#define`, folded, since the dialect matches names without casing */
  readonly macros: Map<string, SageMacro>;
  /**
   * Where every SCREAMING_SNAKE value was written, folded. Whether such a name
   * is a macro or an enum word depends on files that may not be read yet, so
   * every candidate is kept and the macro table decides at lookup time.
   */
  readonly constantUses: Map<string, SageReference[]>;
  /**
   * Every token of every macro body, by lowercased text. A macro written as a
   * field's value stands for its body, so what the body spells is used there.
   */
  readonly bodyTokens: Map<string, SageBodyToken[]>;
  /** Every string table record of every language, by lowercased label, in load order */
  readonly strings: Map<string, SageStringPlace[]>;
  /** Records what a file declares, uses and defines, in place of what it wrote before */
  replaceFile(uri: Uri, entries: FileEntries): void;
  /** Records a string table's records, behind those of the tables read before it */
  replaceStrings(
    uri: Uri,
    records: ReadonlyMap<string, SageString>,
    language?: string,
  ): void;
  /** Drops what a file wrote, or every file below a path, which names an archive */
  purge(rootKey: string): void;
  clear(): void;
}

/** Appends to the list under a key, starting one when there is none */
const pushTo = <T>(table: Map<string, T[]>, key: string, value: T): void => {
  const list = table.get(key);

  if (list) {
    list.push(value);
  } else {
    table.set(key, [value]);
  }
};

/** Adds an entry to a namespace keyed table and notes the keys in the file's contribution */
const record = <T>(
  table: Map<string, Map<string, T[]>>,
  written: Map<string, Set<string>>,
  namespace: string,
  name: string,
  value: T,
): void => {
  const namespaceKey = namespace.toLowerCase();
  const nameKey = name.toLowerCase();
  const byName = table.get(namespaceKey) ?? new Map<string, T[]>();
  const names = written.get(namespaceKey) ?? new Set<string>();

  pushTo(byName, nameKey, value);
  table.set(namespaceKey, byName);
  names.add(nameKey);
  written.set(namespaceKey, names);
};

const createContribution = (): FileContribution => ({
  definitions: new Map(),
  references: new Map(),
  macros: new Set(),
  constantUses: new Set(),
  bodyTokens: new Set(),
  strings: new Set(),
});

/** Drops the places of the given files from the lists under the given keys */
const dropFromLists = <T extends { uri: Uri }>(
  table: Map<string, T[]>,
  keys: Iterable<string>,
  isDropped: (place: T) => boolean,
): void => {
  for (const key of keys) {
    const places = table.get(key);

    if (!places) {
      continue;
    }

    const kept = places.filter((place) => !isDropped(place));

    if (kept.length) {
      table.set(key, kept);
    } else {
      table.delete(key);
    }
  }
};

/** Drops the places of the given files from a namespace keyed table */
const dropFromNamespaces = <T extends { uri: Uri }>(
  table: Map<string, Map<string, T[]>>,
  written: Iterable<Map<string, Set<string>>>,
  isDropped: (place: T) => boolean,
): void => {
  const namesByNamespace = new Map<string, Set<string>>();

  for (const namespaces of written) {
    for (const [namespace, names] of namespaces) {
      const merged = namesByNamespace.get(namespace) ?? new Set<string>();

      names.forEach((name) => merged.add(name));
      namesByNamespace.set(namespace, merged);
    }
  }

  for (const [namespace, names] of namesByNamespace) {
    const byName = table.get(namespace);

    if (byName) {
      dropFromLists(byName, names, isDropped);
    }
  }
};

/** Creates the tables empty */
export const createSageIniTables = (): SageIniTables => {
  const definitions = new Map<string, Map<string, SageDefinition[]>>();
  const references = new Map<string, Map<string, SageReference[]>>();
  const macros = new Map<string, SageMacro>();
  const constantUses = new Map<string, SageReference[]>();
  const bodyTokens = new Map<string, SageBodyToken[]>();
  const strings = new Map<string, SageStringPlace[]>();

  /** What each file wrote, by lowercased address */
  const contributions = new Map<string, FileContribution>();

  const purgeFiles = (fileKeys: ReadonlySet<string>): void => {
    const dropped = [...fileKeys].map((key) => contributions.get(key)!);
    const isDropped = ({ uri }: { uri: Uri }): boolean =>
      fileKeys.has(uri.path.toLowerCase());

    dropFromNamespaces(
      definitions,
      dropped.map((each) => each.definitions),
      isDropped,
    );
    dropFromNamespaces(
      references,
      dropped.map((each) => each.references),
      isDropped,
    );
    dropFromLists(
      constantUses,
      dropped.flatMap((each) => [...each.constantUses]),
      isDropped,
    );
    dropFromLists(
      bodyTokens,
      dropped.flatMap((each) => [...each.bodyTokens]),
      isDropped,
    );
    dropFromLists(
      strings,
      dropped.flatMap((each) => [...each.strings]),
      isDropped,
    );

    for (const key of dropped.flatMap((each) => [...each.macros])) {
      const macro = macros.get(key);

      if (macro && isDropped(macro)) {
        macros.delete(key);
      }
    }

    fileKeys.forEach((key) => contributions.delete(key));
  };

  const purge = (rootKey: string): void => {
    const fileKeys = new Set<string>();

    for (const key of contributions.keys()) {
      if (key === rootKey || key.startsWith(`${rootKey}/`)) {
        fileKeys.add(key);
      }
    }

    if (fileKeys.size) {
      purgeFiles(fileKeys);
    }
  };

  return {
    definitions,
    references,
    macros,
    constantUses,
    bodyTokens,
    strings,

    purge,

    clear() {
      [definitions, references, macros, constantUses, bodyTokens, strings].forEach(
        (table) => table.clear(),
      );
      contributions.clear();
    },

    replaceFile(uri, entries) {
      const fileKey = uri.path.toLowerCase();
      const written = createContribution();

      purge(fileKey);

      for (const macro of entries.macros) {
        const key = macro.name.toLowerCase();

        macros.set(key, { ...macro, uri });
        written.macros.add(key);
      }

      for (const token of entries.bodyTokens) {
        pushTo(bodyTokens, token.text, { ...token, uri });
        written.bodyTokens.add(token.text);
      }

      for (const { namespace, ...definition } of entries.definitions) {
        record(definitions, written.definitions, namespace, definition.name, {
          uri,
          ...definition,
        });
      }

      for (const { key, ...use } of entries.constantUses) {
        pushTo(constantUses, key, { uri, ...use });
        written.constantUses.add(key);
      }

      for (const { namespace, name, ...place } of entries.references) {
        record(references, written.references, namespace, name, {
          uri,
          ...place,
        });
      }

      contributions.set(fileKey, written);
    },

    replaceStrings(uri, records, language) {
      const fileKey = uri.path.toLowerCase();
      const written = createContribution();

      purge(fileKey);

      for (const [key, each] of records) {
        pushTo(strings, key, { ...each, uri, language });
        written.strings.add(key);
      }

      contributions.set(fileKey, written);
    },
  };
};
