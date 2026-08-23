import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import { findChild, getFileNodes } from '../model/virtualNode';
import { getParentPath } from '../common/paths';
import type { ToolBox } from '../tools/toolRegistry';

/**
 * Formats open an entry. A format resolves the entries it needs through its
 * context, runs tools over their bytes and produces something renderable; it
 * never sees a uri, folds a case or opens a file itself.
 */

/** One entry of an archive, as a format addresses it */
export interface EntryRef {
  readonly name: string;
  /** Archive relative, no leading slash: `data/ini/object.ini` */
  readonly path: string;
  /** The tree node behind the entry, which a format hands back to `FormatContext.read` */
  readonly node: VirtualNode;
}

/**
 * Everything a format is given to open an entry: the entry itself, the ways to
 * reach the entries around it, and the tools. A format is handed one of these
 * and nothing else — no uri, no archive, no file handle — which is what keeps
 * case folding and file access out of it.
 *
 * It carries a reader rather than pre-resolved buffers because a format cannot
 * always declare what it needs in advance: an `.apt` finds its `.const` and
 * `.dat` by name, then asks for textures it only discovers while parsing.
 */
export interface FormatContext {
  /** The entry the format was asked to open */
  readonly entry: EntryRef;

  /**
   * The entry beside this one with a different extension: unit.apt finds
   * unit.const. The extension carries its dot, and the case does not have to
   * match.
   */
  sibling(extension: string): EntryRef | undefined;

  /** Every file at or below a directory path, which is archive relative */
  list(directoryPath: string): readonly EntryRef[];

  /** Reads one entry, and throws when it is no longer in the archive */
  read(entry: EntryRef): Promise<Uint8Array>;

  /** One open archive handle for the whole batch, keyed by entry path */
  readAll(entries: readonly EntryRef[]): Promise<Map<string, Uint8Array>>;

  /** The same tools a command or another format would use */
  readonly tools: ToolBox;
}

/**
 * A contribution that opens one kind of entry. An implementor supplies an id,
 * `matches` and `parse`, and reads everything it needs through the context it
 * is handed; `T` is whatever `parse` produces, which the registry only ever
 * holds as `unknown`.
 */
export interface ArchiveFormat<T> {
  /** Stable across releases: it identifies the format in settings and logs */
  readonly id: string;
  /** Whether this format claims the entry. Every format is asked in turn until one does */
  matches(entry: EntryRef): boolean;
  /** Parses the entry, reading whatever else it needs through the context */
  parse(context: FormatContext): Promise<T>;
}

/**
 * The formats a session knows about, and the only route to one. `extension.ts`
 * holds a single instance for the life of the session; it starts empty, and
 * nothing looks a format up any other way.
 */
export interface FormatRegistry {
  /** Adds formats. Ids must be unique across all of them: registering one twice throws */
  register(...formats: ArchiveFormat<unknown>[]): void;
  /** The first registered format that claims the entry, so registration order breaks ties */
  find(node: VirtualNode): ArchiveFormat<unknown> | undefined;
  /** Every registered format, in registration order */
  all(): readonly ArchiveFormat<unknown>[];
  /** Builds the context a format parses through. Absent for a node outside an archive */
  createContext(node: VirtualNode): FormatContext | undefined;
}

/** The extension including its dot, or empty when the name has none */
const getExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');

  return dot < 0 ? '' : name.slice(dot);
};

/**
 * Creates the format registry `extension.ts` holds for the life of the
 * session. Formats reach entries through `archiveModel` and share the one
 * `tools` box, so a format and a command run the same tool instance.
 */
export const createFormatRegistry = (
  archiveModel: ArchiveModel,
  tools: ToolBox,
): FormatRegistry => {
  const formats = new Map<string, ArchiveFormat<unknown>>();

  const toRef = (node: VirtualNode): EntryRef => ({
    name: node.name,
    path: node.entryPath,
    node,
  });

  const createContext = (node: VirtualNode): FormatContext | undefined => {
    const entry = toRef(node);
    const archive = node.archive;

    if (!archive) {
      return undefined;
    }

    const listIn = (directoryPath: string): EntryRef[] => {
      const directory = findChild(archive.root, directoryPath);

      return directory ? getFileNodes(directory).map(toRef) : [];
    };

    return {
      entry,

      sibling(extension) {
        const base = entry.name.slice(
          0,
          entry.name.length - getExtension(entry.name).length,
        );

        return listIn(getParentPath(entry.path)).find(
          (candidate) =>
            candidate.name.toLowerCase() ===
            `${base}${extension}`.toLowerCase(),
        );
      },

      list: listIn,

      async read(target) {
        const content = await archiveModel.getFileContent(target.node);

        if (!content) {
          throw new Error(`Entry missing from archive: ${target.path}`);
        }

        return content;
      },

      async readAll(targets) {
        const contents = new Map<string, Uint8Array>();

        await archiveModel.readFiles(
          targets.map((target) => ({ node: target.node, path: target.path })),
          async (item, content) => {
            contents.set(item.path, content);
          },
        );

        return contents;
      },

      tools,
    };
  };

  return {
    register(...added) {
      for (const format of added) {
        if (formats.has(format.id)) {
          throw new Error(`A format is already registered as '${format.id}'`);
        }

        formats.set(format.id, format);
      }
    },

    find(node) {
      const entry = toRef(node);

      return Array.from(formats.values()).find((format) =>
        format.matches(entry),
      );
    },

    all: () => Array.from(formats.values()),

    createContext,
  };
};
