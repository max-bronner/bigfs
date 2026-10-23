import { FileType, Uri, workspace } from 'vscode';
import type { Disposable } from 'vscode';
import type { ArchiveModel } from '../model/archiveModel';
import { getFileNodes } from '../model/virtualNode';
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
export class EntryLocator implements Disposable {
  private names?: Promise<Map<string, VirtualNode>>;
  private readonly subscription: Disposable;

  public constructor(private readonly archiveModel: ArchiveModel) {
    this.subscription = archiveModel.onDidChangeArchive(() => {
      this.names = undefined;
    });
  }

  public dispose(): void {
    this.subscription.dispose();
  }

  /**
   * Reads the file of this name, matched without casing, looking beside
   * `nearUri` first. Nothing when no archive or folder holds one.
   */
  public async read(
    fileName: string,
    nearUri: Uri,
  ): Promise<Uint8Array | undefined> {
    const beside = await this.readBeside(fileName, nearUri);

    if (beside) {
      return beside;
    }

    const node = (await this.getNames()).get(fileName.toLowerCase());

    if (node) {
      return this.archiveModel.getFileContent(node);
    }

    const [loose] = await workspace.findFiles(`**/${fileName}`, undefined, 1);

    return loose ? workspace.fs.readFile(loose) : undefined;
  }

  /** Reads a file of this name in the same directory, whatever its casing */
  private async readBeside(
    fileName: string,
    nearUri: Uri,
  ): Promise<Uint8Array | undefined> {
    const directory = Uri.joinPath(nearUri, '..');

    try {
      const entries = await workspace.fs.readDirectory(directory);
      const match = entries.find(
        ([name, type]) =>
          type === FileType.File &&
          name.toLowerCase() === fileName.toLowerCase(),
      );

      return match
        ? await workspace.fs.readFile(Uri.joinPath(directory, match[0]))
        : undefined;
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
