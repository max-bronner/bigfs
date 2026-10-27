import * as vscode from 'vscode';
import { createAptMovie } from '../formats/apt/aptCreate';
import { APT_VIEW_TYPE } from '../providers/aptEditorProvider';
import { toUri } from '../common/commandTarget';
import type { CommandTarget } from '../common/commandTarget';

/**
 * "New APT Movie": writes an empty movie's `.apt`, `.const` and `.dat` into
 * a folder, loose or inside an archive, and opens it in the APT editor.
 */

type Target = CommandTarget;

const folderOf = async (target: Target): Promise<vscode.Uri | undefined> => {
  const uri = toUri(target);

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

/** What a new movie is, when a caller supplies it instead of the prompts */
export interface NewMovieOptions {
  name: string;
  width?: number;
  height?: number;
  exports?: string[];
}

const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

const askOptions = async (): Promise<NewMovieOptions | undefined> => {
  const name = await vscode.window.showInputBox({
    prompt: 'Movie name; root movies import its exports by this name',
    placeHolder: 'MyExports',
    validateInput: (value) =>
      NAME_PATTERN.test(value)
        ? undefined
        : 'Letters, digits and underscores only',
  });

  if (!name) {
    return undefined;
  }

  const size = await vscode.window.showInputBox({
    prompt: 'Screen size',
    value: '1024x768',
    validateInput: (value) =>
      /^\d+x\d+$/.test(value) ? undefined : 'Width x height, e.g. 1024x768',
  });

  if (!size) {
    return undefined;
  }

  const exportList = await vscode.window.showInputBox({
    prompt:
      'Exports to create, comma separated; each starts as an empty sprite',
    placeHolder: 'MyButton, MyPanel',
    value: '',
  });

  if (exportList === undefined) {
    return undefined;
  }

  const [width, height] = size.split('x').map(Number);

  return {
    name,
    width,
    height,
    exports: exportList
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
};

/** Writes the movie's three files and opens it; returns the `.apt` */
const newMovie = async (
  target: Target,
  given?: NewMovieOptions,
): Promise<vscode.Uri | undefined> => {
  const folder = await folderOf(target);

  if (!folder) {
    return undefined;
  }

  const options = given ?? (await askOptions());

  if (!options) {
    return undefined;
  }
  if (!NAME_PATTERN.test(options.name)) {
    throw new Error(`"${options.name}" is not a usable movie name`);
  }

  const files = createAptMovie({
    width: options.width ?? 1024,
    height: options.height ?? 768,
    exports: options.exports ?? [],
  });
  const aptUri = vscode.Uri.joinPath(folder, `${options.name}.apt`);

  if (await exists(aptUri)) {
    throw new Error(`${options.name}.apt already exists there`);
  }

  await vscode.workspace.fs.writeFile(aptUri, files.apt);
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(folder, `${options.name}.const`),
    files.constFile,
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(folder, `${options.name}.dat`),
    files.dat,
  );
  await vscode.commands.executeCommand(
    'vscode.openWith',
    aptUri,
    APT_VIEW_TYPE,
  );
  return aptUri;
};

export const registerAptCommands = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'bigfs.newAptMovie',
      async (target: Target, options?: NewMovieOptions) => {
        try {
          return await newMovie(target, options);
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error),
          );
          return undefined;
        }
      },
    ),
  );
};
