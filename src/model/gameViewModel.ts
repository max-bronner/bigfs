import { EventEmitter, FileType, RelativePattern, workspace } from 'vscode';
import type { Disposable, Uri } from 'vscode';
import type { ArchiveModel } from './archiveModel';
import { getFileNodes } from './virtualNode';
import type { VirtualNode } from './virtualNode';
import { archiveOrderKey, buildGameTree } from './gameView';
import type { GameFile, GameNode } from './gameView';

/**
 * What a file in the game view is: an entry of an archive, or a loose file
 * on disk that beats every archive of its install
 */
export type GameFileRef =
  { kind: 'entry'; node: VirtualNode } | { kind: 'loose'; uri: Uri };

/** A row of the game view */
export type GameViewNode = GameNode<GameFileRef>;

/**
 * Builds and keeps the game view over every source of the archive model:
 * each source an install, the sources layered in workspace folder order with
 * the first winning, and inside each install loose files before archives and
 * archives in the engine's order. Reading it reads every archive's index
 * table, so it is built only when the view asks and dropped when an archive
 * changes.
 */
export class GameViewModel implements Disposable {
  private tree?: Promise<GameViewNode>;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private readonly subscriptions: Disposable[];

  /** Fires when the view has to be built again */
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor(private readonly archiveModel: ArchiveModel) {
    this.subscriptions = [
      this.onDidChangeEmitter,
      archiveModel.onDidChangeArchive(() => this.invalidate()),
    ];
  }

  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /** Drops the built view, so the next request reads everything again */
  public invalidate(): void {
    if (this.tree) {
      this.tree = undefined;
      this.onDidChangeEmitter.fire();
    }
  }

  /** The root of the game view, built on first use */
  public getRoot(): Promise<GameViewNode> {
    this.tree ??= this.build();

    return this.tree;
  }

  private async build(): Promise<GameViewNode> {
    await this.archiveModel.whenReady();

    const candidates: GameFile<GameFileRef>[] = [];

    for (const source of this.archiveModel.getSources()) {
      const archives = [...this.archiveModel.getArchivesOf(source.id)].sort(
        (a, b) =>
          archiveOrderKey(a.pathInSource) < archiveOrderKey(b.pathInSource)
            ? -1
            : 1,
      );
      const topFolders = new Set<string>();
      const archived: GameFile<GameFileRef>[] = [];

      for (const archive of archives) {
        try {
          await this.archiveModel.loadArchiveOf(archive.root);
        } catch {
          continue; // an archive that does not read gives the game nothing
        }

        for (const node of getFileNodes(archive.root)) {
          topFolders.add(node.entryPath.split('/')[0].toLowerCase());
          archived.push({
            entryPath: node.entryPath,
            ref: { kind: 'entry', node },
            origin: archive.pathInSource,
          });
        }
      }

      // Loose files are what the engine finds on disk under the same folders
      // the archives hold, such as data/ or art/
      const folders = [...topFolders].filter(isGlobSafe);

      if (folders.length) {
        const pattern = new RelativePattern(
          source.baseUri,
          `{${folders.join(',')}}/**`,
        );

        for (const uri of await workspace.findFiles(pattern)) {
          const entryPath = uri.path
            .slice(source.baseUri.path.length)
            .replace(/^\/+/, '');

          if (!entryPath.toLowerCase().endsWith('.big')) {
            candidates.push({
              entryPath,
              ref: { kind: 'loose', uri },
              origin: `${source.label} (loose)`,
            });
          }
        }
      }

      candidates.push(...archived);
    }

    return buildGameTree(candidates);
  }
}

/** Whether a folder name can go into a glob without escaping */
const isGlobSafe = (folder: string): boolean => /^[\w .-]+$/.test(folder);

/**
 * Turns a game view directory into a directory node over the winning entries
 * below it, for commands that read files: extract and override work on it as
 * on any directory. Loose files are left out, being on disk already. Nothing
 * when no archive holds anything below it.
 */
export const toEntryDirectory = (
  directory: GameViewNode,
): VirtualNode | undefined => {
  const build = (node: GameViewNode): VirtualNode | undefined => {
    if (!node.children) {
      return node.winner?.ref.kind === 'entry'
        ? node.winner.ref.node
        : undefined;
    }

    const children = new Map<string, VirtualNode>();

    for (const [key, child] of node.children) {
      const built = build(child);

      if (built) {
        children.set(key, built);
      }
    }

    const [first] = children.values();

    return first
      ? {
          name: node.name,
          type: FileType.Directory,
          entryPath: node.path,
          archive: first.archive,
          children,
        }
      : undefined;
  };

  return build(directory);
};
