import * as vscode from 'vscode';
import { createAptMovie } from '../formats/apt/aptCreate';
import { APT_VIEW_TYPE } from '../providers/aptEditorProvider';

/**
 * "New APT Movie": writes an empty movie's `.apt`, `.const` and `.dat` into
 * a folder, loose or inside an archive, and opens it in the APT editor.
 */

type Target = vscode.Uri | { resourceUri?: vscode.Uri } | undefined;

const folderOf = async (target: Target): Promise<vscode.Uri | undefined> => {
  const uri = target instanceof vscode.Uri ? target : target?.resourceUri;

  if (!uri) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: 'Create Movie Here',
    });

    return picked?.[0];
  }

  const stat = await vscode.workspace.fs.stat(uri);

  return stat.type & vscode.FileType.Directory
    ? uri
    : vscode.Uri.joinPath(uri, '..');
};

const exists = async (uri: vscode.Uri) =>
  vscode.workspace.fs.stat(uri).then(
    () => true,
    () => false,
  );

const newMovie = async (target: Target): Promise<void> => {
  const folder = await folderOf(target);

  if (!folder) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Movie name; root movies import its exports by this name',
    placeHolder: 'MyExports',
    validateInput: (value) =>
      /^[A-Za-z0-9_]+$/.test(value)
        ? undefined
        : 'Letters, digits and underscores only',
  });

  if (!name) {
    return;
  }

  const size = await vscode.window.showInputBox({
    prompt: 'Screen size',
    value: '1024x768',
    validateInput: (value) =>
      /^\d+x\d+$/.test(value) ? undefined : 'Width x height, e.g. 1024x768',
  });

  if (!size) {
    return;
  }

  const exportList = await vscode.window.showInputBox({
    prompt:
      'Exports to create, comma separated; each starts as an empty sprite',
    placeHolder: 'MyButton, MyPanel',
    value: '',
  });

  if (exportList === undefined) {
    return;
  }

  const [width, height] = size.split('x').map(Number);
  const files = createAptMovie({
    width,
    height,
    exports: exportList
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  });
  const aptUri = vscode.Uri.joinPath(folder, `${name}.apt`);

  if (await exists(aptUri)) {
    throw new Error(`${name}.apt already exists there`);
  }

  await vscode.workspace.fs.writeFile(aptUri, files.apt);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(folder, `${name}.const`),
    files.constFile,
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(folder, `${name}.dat`),
    files.dat,
  );
  await vscode.commands.executeCommand(
    'vscode.openWith',
    aptUri,
    APT_VIEW_TYPE,
  );
};

export const registerAptCommands = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'bigfs.newAptMovie',
      async (target: Target) => {
        try {
          await newMovie(target);
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    ),
  );
};
