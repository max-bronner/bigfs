import * as vscode from 'vscode';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { getArchiveOrderKey } from '../../game/install/gameView';
import { getNodeUri } from '../../services/archives/nodeAddress';
import { findChild } from '../../services/archives/virtualNode';

/**
 * Finds the movie an APT import names the way the game finds any file, so
 * an import resolves to the copy the game would load (mint's
 * `MovieLibrary`, "multi-root, first-root-wins"):
 *
 * - Installs are the workspace's archive sources, in workspace folder
 *   order, the first winning: put ROTWK or the mod before BFME II.
 * - Inside one install, a loose `<name>.apt` at its root beats its archives,
 *   and the archives are taken in the engine's order, the first holding the
 *   movie winning.
 *
 * The movie's `.const`, `.dat`, geometry and textures are then read beside
 * the `.apt` that was found, the way one `apt/<name>.big` carries them all.
 */

/** Movie an import resolved to, as `AptLibrary.locate` finds it */
export interface MovieLocation {
  /** The `.apt` the game would load */
  uri: vscode.Uri;
  /** Where it is, as the editor shows it */
  origin: string;
}

/** Reduces a movie name to the key the game compares imports by: no casing, no `.apt` */
export const toMovieKey = (name: string): string =>
  name.toLowerCase().replace(/\.apt$/, '');

/** Cache of where each imported movie resolves, cleared whenever the archives or movie files change */
export class AptLibrary implements vscode.Disposable {
  private readonly locations = new Map<
    string,
    Promise<MovieLocation | undefined>
  >();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  /** Fires when a movie may now resolve elsewhere, or its files changed */
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public constructor(private readonly archiveModel: ArchiveModel) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{apt,APT,const,CONST,dat,DAT,ru,RU,tga,TGA}',
    );
    const forget = () => this.forget();

    this.subscriptions = [
      this.onDidChangeEmitter,
      archiveModel.onDidChangeArchive(forget),
      archiveModel.onDidScan(forget),
      watcher,
      watcher.onDidCreate(forget),
      watcher.onDidChange(forget),
      watcher.onDidDelete(forget),
    ];
  }

  /** Stops watching the archives and movie files */
  public dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  /** Drops every location found, so the next lookup searches again */
  public forget(): void {
    this.locations.clear();
    this.onDidChangeEmitter.fire();
  }

  /** Finds where the game would load the movie of this name from, if anywhere */
  public locate(name: string): Promise<MovieLocation | undefined> {
    const key = toMovieKey(name);
    let location = this.locations.get(key);

    if (!location) {
      location = this.search(`${key}.apt`);
      this.locations.set(key, location);
    }
    return location;
  }

  private async search(fileName: string): Promise<MovieLocation | undefined> {
    await this.archiveModel.whenReady();

    for (const source of this.archiveModel.getSources()) {
      const loose = await findLoose(source.baseUri, fileName);

      if (loose) {
        return { uri: loose, origin: `${source.label} (loose)` };
      }

      const archives = [...this.archiveModel.getArchivesOf(source.id)].sort(
        (a, b) =>
          getArchiveOrderKey(a.pathInSource) < getArchiveOrderKey(b.pathInSource)
            ? -1
            : 1,
      );

      for (const archive of archives) {
        try {
          await this.archiveModel.loadArchiveOf(archive.root);
        } catch {
          continue; // an archive that does not read holds nothing for the game
        }

        const node = findChild(archive.root, fileName);

        if (node) {
          return { uri: getNodeUri(node), origin: archive.pathInSource };
        }
      }
    }
    return undefined;
  }
}

/** Finds a file directly in a folder, whatever its casing */
const findLoose = async (
  folder: vscode.Uri,
  fileName: string,
): Promise<vscode.Uri | undefined> => {
  try {
    const match = (await vscode.workspace.fs.readDirectory(folder)).find(
      ([name, type]) =>
        type === vscode.FileType.File &&
        name.toLowerCase() === fileName.toLowerCase(),
    );

    return match ? vscode.Uri.joinPath(folder, match[0]) : undefined;
  } catch {
    return undefined;
  }
};
