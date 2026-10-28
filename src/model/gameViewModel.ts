import { EventEmitter, FileType, Uri } from 'vscode';
import type { Disposable } from 'vscode';
import { createDebouncer } from '../core/debounce';
import type { ArchiveModel } from './archiveModel';
import { getFileNodes } from './virtualNode';
import type { VirtualNode } from './virtualNode';
import { buildGameTree, indexByName, orderInstallFiles } from './gameView';
import type { GameNode, InstallFiles } from './gameView';
import { GAME_FOLDERS, listLooseFiles } from './installScan';
import * as path from 'path';

/**
 * What a file in the game view is: an entry of an archive, or a loose file
 * on disk that beats every archive of its install. `base` marks a file of
 * the base game layers, which a comparison with the base game leaves out.
 */
export type GameFileRef =
  | { kind: 'entry'; node: VirtualNode; base?: boolean }
  | { kind: 'loose'; uri: Uri; base?: boolean };

/** A row of the game view */
export type GameViewNode = GameNode<GameFileRef>;

/**
 * Milliseconds the view waits after the last change before it builds again.
 * Opening a workspace reports its archives one after the other, and each
 * rebuild reads them all.
 */
export const REBUILD_DELAY = 250;

/**
 * Builds and keeps the game view over every source of the archive model:
 * each source an install, the sources layered as the model orders them
 * (a mod, ROTWK, BFME II, the base game folder last) with the first winning,
 * and inside each install loose files before archives and archives in the
 * engine's order. Reading it reads every archive's index table, so it is
 * built only when the view asks and dropped when an archive changes.
 */
export class GameViewModel implements Disposable {
  private tree?: Promise<GameViewNode>;
  private names?: Promise<Map<string, GameViewNode>>;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  /** Whether the view built is out of date and its listeners have yet to hear of it */
  private stale = false;
  private readonly announce = createDebouncer(() => {
    if (this.stale) {
      this.stale = false;
      this.onDidChangeEmitter.fire();
    }
  }, REBUILD_DELAY);
  private readonly subscriptions: Disposable[];

  /** Fires when the view has to be built again */
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor(private readonly archiveModel: ArchiveModel) {
    this.subscriptions = [
      this.onDidChangeEmitter,
      archiveModel.onDidChangeArchive((change) => {
        // Reading an archive for the first time changes nothing the view holds
        if (!change.loaded) {
          this.forget();
        }
      }),
      archiveModel.onDidScan(() => this.invalidate()),
      { dispose: () => this.announce.cancel() },
    ];
  }

  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /** Drops the built view, so the next request reads everything again */
  public invalidate(): void {
    this.announce.cancel();
    this.stale = false;
    this.names = undefined;

    if (this.tree) {
      this.tree = undefined;
      this.onDidChangeEmitter.fire();
    }
  }

  /**
   * Drops the built view at once, so nothing reads a stale one, but tells the
   * listeners after the burst of changes is over: each of them builds it again
   */
  private forget(): void {
    this.names = undefined;

    if (this.tree) {
      this.tree = undefined;
      this.stale = true;
      this.announce.schedule();
    }
  }

  /** The root of the game view, built on first use */
  public getRoot(): Promise<GameViewNode> {
    this.tree ??= this.build();

    return this.tree;
  }

  /**
   * Every file name of the view, lowercased, to the file the game loads for
   * it: of several paths that end in one name, the one that ranks highest
   */
  public getNames(): Promise<Map<string, GameViewNode>> {
    this.names ??= this.getRoot().then(indexByName);

    return this.names;
  }

  private async build(): Promise<GameViewNode> {
    await this.archiveModel.whenReady();

    const installs: InstallFiles<GameFileRef>[] = [];
    const topFolders = new Set(GAME_FOLDERS);

    // The sources come in the order the game layers them
    for (const source of this.archiveModel.getSources()) {
      const archives: InstallFiles<GameFileRef>['archives'] = [];

      for (const archive of this.archiveModel.getArchivesOf(source.id)) {
        try {
          await this.archiveModel.loadArchiveOf(archive.root);
        } catch {
          continue; // an archive that does not read gives the game nothing
        }

        archives.push({
          pathInInstall: archive.pathInSource,
          files: getFileNodes(archive.root).map((node) => {
            topFolders.add(node.entryPath.split('/')[0].toLowerCase());

            return {
              entryPath: node.entryPath,
              ref: { kind: 'entry' as const, node, base: source.base },
              origin: archive.pathInSource,
            };
          }),
        });
      }

      installs.push({ loose: [], archives });
    }

    // Loose files are what the engine finds on disk under the game's folders,
    // whether or not an archive holds anything there: a mod of INI files alone
    // has no archive to name its folders
    for (const [index, source] of this.archiveModel.getSources().entries()) {
      if (source.baseUri.scheme !== 'file') {
        continue;
      }

      installs[index].loose = (
        await listLooseFiles(source.baseUri.fsPath, topFolders)
      ).map((entryPath) => ({
        entryPath,
        ref: {
          kind: 'loose' as const,
          uri: Uri.file(
            path.join(source.baseUri.fsPath, ...entryPath.split('/')),
          ),
          base: source.base,
        },
        origin: `${source.label} (loose)`,
      }));
    }

    return buildGameTree(orderInstallFiles(installs));
  }
}

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
