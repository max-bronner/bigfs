import * as vscode from 'vscode';
import { VirtualFileService } from './virtualFileService';
import { VirtualNode } from '../types';
import * as path from 'path';

interface ExternalFile {
  uri: vscode.Uri;
  isFile: boolean;
}

export interface FileConflict {
  source: vscode.Uri;
  targetPath: string;
  action: 'skip' | 'replace' | null;
}

export interface FolderConflict {
  conflicts: FileConflict[];
  skipAll: boolean;
  replaceAll: boolean;
}

export class DragDropService {
  constructor(private fileService: VirtualFileService) {}

  async handleExternalDrop(
    sourceUris: vscode.Uri[],
    target: VirtualNode
  ): Promise<void> {
    if (target.type !== vscode.FileType.Directory) {
      throw new Error('Target is not a Directory');
    }

    const filesToProcess: ExternalFile[] = [];
    const conflicts: FileConflict[] = [];

    sourceUris.forEach(async (uri) => {
      const stats = await vscode.workspace.fs.stat(uri);

      if (stats.type === vscode.FileType.File) {
        filesToProcess.push({ uri, isFile: true });

        const fileName = path.basename(uri.path);
        if (target.children?.has(fileName)) {
          conflicts.push({
            source: uri,
            targetPath: `${target.path}/${fileName}`,
            action: null,
          });
        }
        filesToProcess.push({ uri: uri, isFile: true });
      } else if (stats.type === vscode.FileType.Directory) {
        filesToProcess.push({ uri: uri, isFile: false });

        const archive = this.fileService.getArchiveStorage(target.archivePath);
        const archiveBaseName = `/${path.basename(target.archivePath)}/`;
        const filesInFolder = await this.getFilesInFolder(uri);
        filesInFolder.forEach(({ uri, relativePath }) => {
          const internalPath = `${target.path}/${relativePath}`;
          const hasEntry = archive?.entries.has(
            internalPath.replace(archiveBaseName, '')
          );
          if (hasEntry) {
            conflicts.push({
              source: uri,
              targetPath: internalPath,
              action: null,
            });
          }
        });
      }
    });
  }

  async getFilesInFolder(folderUri: vscode.Uri): Promise<
    {
      uri: vscode.Uri;
      relativePath: string;
    }[]
  > {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folderUri, '**/*')
    );

    const parentPath = path.dirname(folderUri.path);

    const fileUriAndPath = files.map((fileUri) => ({
      uri: fileUri,
      relativePath: path.relative(parentPath, fileUri.path).replace(/\\/g, '/'),
    }));

    return fileUriAndPath;
  }
}
