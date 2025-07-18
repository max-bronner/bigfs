import { workspace, EventEmitter, FileType, Uri } from 'vscode';
import { BIG_PATTERN } from '../constants';

  constructor() {
    this.scanWorkspace();
  }

  public async scanWorkspace(): Promise<void> {
    if (!workspace.workspaceFolders) {
      return;
    }

    const archiveUri = await workspace.findFiles(BIG_PATTERN, null, 100);

    archiveUri.forEach((uri) => {
      // Todo: add parsing of files
    });
  }
}
