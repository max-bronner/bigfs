import { workspace, EventEmitter, FileType, Uri } from 'vscode';
import { BIG_PATTERN } from '../constants';
import type { BigFileArchive } from './bigParser';
import { BigFileEntry, parseBigArchive, writeBigArchive } from './bigParser';
import path from 'path';

export interface VirtualNode {
  name: string;
  type: FileType;
  path: string;
  archivePath: string;
  children?: Map<string, VirtualNode>;
  fileBuffer?: Uint8Array;
}

export class FileService {
  private _onDidChangeArchives = new EventEmitter<Uri>();
  public readonly onDidChangeArchives = this._onDidChangeArchives.event;

  private archives = new Map<string, BigFileArchive>();
  private virtualFileTree = new Map<string, VirtualNode>();

  constructor() {
    this.scanWorkspace();
  }

  private parseUri(uri: Uri): { archiveName: string; path: string } {
    const [archiveName, ...pathParts] = uri.path
      .split('/')
      .filter((part) => part.length);

    const path = pathParts.join('/');
    return { archiveName, path };
  }

  private async parseArchiveFile(uri: Uri): Promise<BigFileArchive> {
    try {
      const byteArray = await workspace.fs.readFile(uri);
      const buffer = Buffer.from(byteArray);
      return parseBigArchive(buffer);
    } catch (error) {
      throw Error(`Failed to parse archive ${uri.fsPath}:`);
    }
  }

  private parseFilePath(filePath: string): string[] {
    const parsedPath = path.parse(filePath);
    const filePathParts = parsedPath.dir
      .split('/')
      .filter((part) => part.length > 0);

    filePathParts.push(parsedPath.base);

    return filePathParts;
  }

  private addNodeToVirtualFileTree(
    parentNode: VirtualNode,
    childName: string,
    isFile: boolean
  ) {
    if (!parentNode.children?.has(childName)) {
      const type = isFile ? FileType.File : FileType.Directory;
      const childNode: VirtualNode = {
        name: childName,
        type,
        path: `${parentNode.path}/${childName}`,
        archivePath: parentNode.archivePath,
      };

      if (!isFile) {
        childNode.children = new Map<string, VirtualNode>();
      }

      parentNode.children?.set(childName, childNode);
    }
  }

  private addFileToVirtualFileTree(
    archiveFile: BigFileEntry,
    archiveNode: VirtualNode
  ) {
    const filePathParts = this.parseFilePath(archiveFile.name);
    let parentNode = archiveNode;

    filePathParts.forEach((nodeName, index) => {
      const isFile = index === filePathParts.length - 1;
      this.addNodeToVirtualFileTree(parentNode, nodeName, isFile);

      parentNode = parentNode.children?.get(nodeName) as VirtualNode;
    });

    parentNode.fileBuffer = archiveFile.fileBuffer;
  }

  private async addArchiveToVirtualFileTree(uri: Uri): Promise<void> {
    const data = await this.parseArchiveFile(uri);

    const archiveName = path.basename(uri.path);
    const archivePath = uri.fsPath;

    this.archives.set(archivePath, data);

    const rootNode: VirtualNode = {
      name: archiveName,
      type: FileType.Directory,
      path: `/${archiveName}`,
      archivePath,
      children: new Map<string, VirtualNode>(),
    };

    this.virtualFileTree.set(archiveName, rootNode);

    data.entries.forEach((archiveFile) => {
      this.addFileToVirtualFileTree(archiveFile, rootNode);
    });

    this._onDidChangeArchives.fire(uri);
  }

  public async scanWorkspace(): Promise<void> {
    if (!workspace.workspaceFolders) {
      return;
    }

    this.archives.clear();
    this.virtualFileTree.clear();

    const archiveUris = await workspace.findFiles(BIG_PATTERN, null, 100);

    await Promise.all(
      archiveUris.map((uri) => this.addArchiveToVirtualFileTree(uri))
    );
  }

  public getNode(uri: Uri): VirtualNode | undefined {
    const [archiveName, ...filePathParts] = uri.path
      .split('/')
      .filter((part) => part.length > 0);
    let parentNode = this.virtualFileTree.get(archiveName);

    for (const nodeName of filePathParts) {
      if (!parentNode || !parentNode.children?.has(nodeName)) {
        return undefined;
      }
      parentNode = parentNode.children?.get(nodeName);
    }

    return parentNode;
  }

  public getFile(uri: Uri): Uint8Array | undefined {
    const fileNode = this.getNode(uri);

    if (!fileNode) {
      throw new Error('File not found or is not a file');
    }

    return fileNode.fileBuffer;
  }

  public getArchives(): Map<string, VirtualNode> {
    return this.virtualFileTree;
  }

  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    const node = this.getNode(uri);
    if (!node || node.type !== FileType.File) {
      throw new Error('File not found or is not a file');
    }

    node.fileBuffer = content;
    const archive = this.archives.get(node.archivePath);

    if (!archive) {
      throw new Error(`Archive not found`);
    }

    const { archiveName, path } = this.parseUri(uri);

    const entry = archive.entries.find((entry) => entry.name === path);
    if (!entry) {
      throw new Error(`Entry not found in archive`);
    }
    entry.fileBuffer = content;
    const rootNode = this.virtualFileTree.get(archiveName);
    if (!rootNode) {
      throw new Error(`Archive not found`);
    }

    await this.saveArchive(rootNode);
  }

  private async saveArchive(rootNode: VirtualNode): Promise<void> {
    const archive = this.archives.get(rootNode.archivePath);

    if (!archive) {
      throw new Error(`Archive not found`);
    }

    try {
      const newArchiveBuffer = writeBigArchive(archive);

      const archiveUri = Uri.file(rootNode.archivePath);
      await workspace.fs.writeFile(archiveUri, newArchiveBuffer);
    } catch (error) {
      console.error(`Failed to save archive:`, error);
      throw error;
    }
  }
}
