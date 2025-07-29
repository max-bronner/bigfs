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
  fileBuffer: Uint8Array;
}

export interface BigFileArchive {
  magic: string;
  fileSize: number;
  numEntries: number;
  indexOffset: number;
  entries: BigFileEntry[];
}
