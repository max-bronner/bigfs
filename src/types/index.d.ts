import { FileType } from 'vscode';

export interface VirtualNode {
  name: string;
  type: FileType;
  path: string;
  archivePath: string;
  children?: Map<string, VirtualNode>;
}

export interface BigFileEntry {
  name: string;
  offset: number;
  size: number;
  pendingData?: Uint8Array;
}

export interface ParsedArchive {
  magic: string;
  entries: Map<string, BigFileEntry>;
}

/** Entry for ArchiveLayout with its location */
export interface PlacedEntry {
  entry: BigFileEntry;
  offset: number;
  size: number;
}

/** Layout for writing archive file */
export interface ArchiveLayout {
  placedEntries: PlacedEntry[];
  indexTableEndOffset: number;
  totalSize: number;
}
