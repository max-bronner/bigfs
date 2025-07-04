export interface BigFileEntry {
  name: string;
  offset: number;
  size: number;
}

export interface BigFileArchive {
  magic: string;
  fileSize: number;
  numEntries: number;
  indexOffset: number;
  entries: BigFileEntry[];
}

