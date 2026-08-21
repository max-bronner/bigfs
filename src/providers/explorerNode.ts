import type { ArchiveSource } from '../model/archiveSource';
import type { VirtualNode } from '../model/virtualNode';

/**
 * A row of the archive explorer. Above the archives sit the places they were
 * found in and the folders holding them, which are rows without an archive
 * behind them: they describe the disk, not the content of a file.
 */
export type ExplorerNode = VirtualNode | SourceNode | FolderNode;

export interface SourceNode {
  readonly kind: 'source';
  readonly source: ArchiveSource;
}

export interface FolderNode {
  readonly kind: 'folder';
  readonly sourceId: string;
  /** Relative to the source, e.g. `mods/textures` */
  readonly path: string;
  readonly name: string;
}

/** An archive, or something inside one, as opposed to a row above them */
export const isVirtualNode = (element: ExplorerNode): element is VirtualNode =>
  'archivePath' in element;

export const isSourceNode = (element: ExplorerNode): element is SourceNode =>
  !isVirtualNode(element) && element.kind === 'source';

export const isFolderNode = (element: ExplorerNode): element is FolderNode =>
  !isVirtualNode(element) && element.kind === 'folder';
