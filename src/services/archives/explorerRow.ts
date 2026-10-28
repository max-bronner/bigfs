import type { ArchiveSource } from '../model/archiveSource';
import type { VirtualNode } from '../model/virtualNode';
import type { GameViewNode } from '../model/gameViewModel';

/**
 * A row of the archive explorer. The rows above the archives have no archive
 * behind them: they describe the disk, not the content of a file
 */
export type ExplorerNode = VirtualNode | SourceNode | FolderNode | GameRow;

/**
 * Explorer row of the game view: a path as the game sees it, with the copy
 * the game loads and the copies it ignores
 */
export interface GameRow {
  readonly kind: 'game';
  readonly node: GameViewNode;
}

/**
 * Explorer row for a source, shown only when there is more than one: a single
 * source would add a level without telling the user anything
 */
export interface SourceNode {
  readonly kind: 'source';
  readonly source: ArchiveSource;
}

/**
 * Explorer row for a folder on disk that holds archives further down. Nothing
 * is read for it; it exists so the archives keep the shape of the folders they
 * were found in
 */
export interface FolderNode {
  readonly kind: 'folder';
  readonly sourceId: string;
  /** Relative to the source, e.g. `mods/textures` */
  readonly path: string;
  readonly name: string;
}

/**
 * Whether a row is an archive or something inside one, as opposed to a row
 * above them. A `VirtualNode` is the member without a `kind`, so the test is
 * for a field it does carry
 */
export const isVirtualNode = (element: ExplorerNode): element is VirtualNode =>
  'entryPath' in element;

/** Whether a row stands for a source rather than anything on disk below it */
export const isSourceNode = (element: ExplorerNode): element is SourceNode =>
  !isVirtualNode(element) && element.kind === 'source';

/** Whether a row stands for a folder on disk rather than an archive in it */
export const isFolderNode = (element: ExplorerNode): element is FolderNode =>
  !isVirtualNode(element) && element.kind === 'folder';

/** Whether a row belongs to the game view */
export const isGameRow = (element: ExplorerNode): element is GameRow =>
  !isVirtualNode(element) && element.kind === 'game';
