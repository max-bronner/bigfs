import { FileType } from 'vscode';

/**
 * A file or directory inside an archive
 */
export interface VirtualNode {
  name: string;
  type: FileType;
  path: string;
  archivePath: string;
  children?: Map<string, VirtualNode>;
}
