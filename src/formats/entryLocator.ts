import { FileType, Uri, workspace } from 'vscode';
import type { Disposable } from 'vscode';
import type { ArchiveModel } from '../model/archiveModel';
import { getFileNodes } from '../model/virtualNode';
import { getNodeUri } from '../model/nodeAddress';
import type { VirtualNode } from '../model/virtualNode';

/**
 * Finds a file by name wherever the game would: beside the file asking for
 * it, in any archive of the workspace, or loose anywhere in the workspace.
 * A model names its skeleton and textures by file name only, and those
 * usually sit in another archive than the model itself.
 *
 * The name to node table over every archive is built on first use and
 * dropped when an archive changes, so a lookup after the first costs a map
 * read.
 */
/** Loose files that can satisfy an asset reference */
const LOOSE_ASSETS =
  '**/*.{w3d,W3D,dds,DDS,tga,TGA,jpg,JPG,png,PNG,wav,WAV,mp3,MP3}';

export class EntryLocator implements Disposable {
  private names?: Promise<Map<string, VirtualNode>>;
  /** Archive and loose asset names together, until either changes */
  private allNames?: Promise<Set<string>>;
  private readonly subscriptions: Disposable[];

  public constructor(private readonly archiveModel: ArchiveModel) {
    const watcher = workspace.createFileSystemWatcher(LOOSE_ASSETS);
    const forgetLoose = () => {
      this.allNames = undefined;
    };

    this.subscriptions = [
      archiveModel.onDidChangeArchive(() => {
        this.names = undefined;
        this.allNames = undefined;
      }),
      watcher,
      watcher.onDidCreate(forgetLoose),
      watcher.onDidDelete(forgetLoose),
    ];
  }

  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /**
   * Lowercased names of every asset file the archives and the workspace
   * folders hold, for checking references without reading anything
   */
  public fileNames(): Promise<Set<string>> {
    this.allNames ??= (async () => {
      const uris = await workspace.findFiles(
        LOOSE_ASSETS,
        '**/node_modules/**',
        200_000,
      );
      const archived = await this.getNames();

      return new Set([
        ...archived.keys(),
        ...uris.map((uri) =>
          uri.path.slice(uri.path.lastIndexOf('/') + 1).toLowerCase(),
        ),
      ]);
    })();

    return this.allNames;
  }

  /**
   * Looks on disk again for names the table says are missing, and drops
   * the table when any is there after all. A file written into a folder
   * created a moment before can reach disk before the watcher watches the
   * folder, and then no event ever says it arrived. True when the table
   * was stale.
   */
  public async recheck(fileNames: string[]): Promise<boolean> {
    const names = [...new Set(fileNames)].slice(0, 20);

    if (!names.length) {
      return false;
    }

    const [found] = await workspace.findFiles(
      names.length === 1 ? `**/${names[0]}` : `**/{${names.join(',')}}`,
      '**/node_modules/**',
      1,
    );

    if (found) {
      this.allNames = undefined;
    }
    return !!found;
  }

  /**
   * Reads the file of this name, matched without casing, looking beside
   * `nearUri` first. Nothing when no archive or folder holds one.
   */
  public async read(
    fileName: string,
    nearUri: Uri,
  ): Promise<Uint8Array | undefined> {
    const found = await this.locate(fileName, nearUri);

    if (!found) {
      return undefined;
    }
    return 'node' in found
      ? this.archiveModel.getFileContent(found.node)
      : workspace.fs.readFile(found.uri);
  }

  /** Where the file `read` would read lives, to open it */
  public async findUri(
    fileName: string,
    nearUri: Uri,
  ): Promise<Uri | undefined> {
    const found = await this.locate(fileName, nearUri);

    return found && ('node' in found ? getNodeUri(found.node) : found.uri);
  }

  private async locate(
    fileName: string,
    nearUri: Uri,
  ): Promise<{ uri: Uri } | { node: VirtualNode } | undefined> {
    const beside = await this.findBeside(fileName, nearUri);

    if (beside) {
      return { uri: beside };
    }

    const node = (await this.getNames()).get(fileName.toLowerCase());

    if (node) {
      return { node };
    }

    const [loose] = await workspace.findFiles(`**/${fileName}`, undefined, 1);

    return loose && { uri: loose };
  }

  /**
   * Names of every file in the archives and loose in the workspace whose
   * lowercased name passes `matches`, lowercased, without repeats
   */
  public async findNames(
    matches: (lowerName: string) => boolean,
    loosePattern: string,
  ): Promise<string[]> {
    const names = new Set(
      [...(await this.getNames()).keys()].filter((name) => matches(name)),
    );

    for (const uri of await workspace.findFiles(
      loosePattern,
      undefined,
      5000,
    )) {
      const name = uri.path.slice(uri.path.lastIndexOf('/') + 1).toLowerCase();

      if (matches(name)) {
        names.add(name);
      }
    }

    return [...names].sort();
  }

  /** A file of this name in the same directory, whatever its casing */
  private async findBeside(
    fileName: string,
    nearUri: Uri,
  ): Promise<Uri | undefined> {
    const directory = Uri.joinPath(nearUri, '..');

    try {
      const match = (await workspace.fs.readDirectory(directory)).find(
        ([name, type]) =>
          type === FileType.File &&
          name.toLowerCase() === fileName.toLowerCase(),
      );

      return match && Uri.joinPath(directory, match[0]);
    } catch {
      return undefined;
    }
  }

  /** Every file of every archive by lowercased name; the first archive listed wins */
  private getNames(): Promise<Map<string, VirtualNode>> {
    this.names ??= (async () => {
      const names = new Map<string, VirtualNode>();

      for (const root of this.archiveModel.getArchiveRoots()) {
        // An archive that does not read holds nothing to find
        try {
          await this.archiveModel.loadArchiveOf(root);
        } catch {
          continue;
        }

        for (const node of getFileNodes(root)) {
          const key = node.name.toLowerCase();

          if (!names.has(key)) {
            names.set(key, node);
          }
        }
      }

      return names;
    })();

    return this.names;
  }
}
