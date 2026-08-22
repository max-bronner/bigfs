import type { ArchiveModel } from '../model/archiveModel';
import type { VirtualNode } from '../model/virtualNode';
import { findChild, getFileNodes } from '../model/virtualNode';
import { getParentPath } from '../common/paths';
import type { ToolBox } from '../tools/toolRegistry';

/**
 * Formats: they open an entry.
 *
 * A format binds an archive to the editor. It resolves the entries it needs,
 * runs tools over their bytes and produces something renderable. It never
 * sees a URI, never folds a case and never opens a file itself, which is why
 * a format is short and a tool is reusable.
 */

/** The entry a format works on, without exposing the tree it came from */
export interface EntryRef {
  readonly name: string;
  readonly path: string;
  readonly node: VirtualNode;
}

export interface FormatContext {
  readonly entry: EntryRef;

  /**
   * The entry beside this one with a different extension: unit.apt finds
   * unit.const. The case does not have to match.
   */
  sibling(extension: string): EntryRef | undefined;

  /** The file entries of a directory, for a format that scans */
  list(directoryPath: string): readonly EntryRef[];

  /** Bytes of an entry, read behind one open archive handle */
  read(entry: EntryRef): Promise<Uint8Array>;
  readAll(entries: readonly EntryRef[]): Promise<Map<string, Uint8Array>>;

  /** The same tools a command or another format would use */
  readonly tools: ToolBox;
}

export interface ArchiveFormat<T> {
  /** Stable across releases: it identifies the format in settings and logs */
  readonly id: string;
  matches(entry: EntryRef): boolean;
  parse(context: FormatContext): Promise<T>;
}

export interface FormatRegistry {
  register(...formats: ArchiveFormat<unknown>[]): void;
  /** The format that claims an entry, if any has been registered for it */
  find(node: VirtualNode): ArchiveFormat<unknown> | undefined;
  all(): readonly ArchiveFormat<unknown>[];
  /** Builds what a format is handed when it runs */
  createContext(node: VirtualNode): FormatContext | undefined;
}

const getExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');

  return dot < 0 ? '' : name.slice(dot);
};

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
