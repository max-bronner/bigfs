import * as vscode from 'vscode';
import { createAptMovie } from '../../formats/apt/aptCreate';
import { APT_VIEW_TYPE } from './viewTypes';
import { toUri } from '../../services/archives/commandTarget';
import type { CommandTarget } from '../../services/archives/commandTarget';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import type { AptEdit } from '../../formats/apt/writer/aptEdit';
import { registerCommand } from '../../platform/commands';
import { describeError } from '../../core/errors';
import type { AptDocument } from './aptDocument';
import type { ScriptSite } from './aptDocumentEdits';
import type { AptEditorProvider } from './aptEditorProvider';
import { deleteMovie, renameMovie } from './aptMovieFiles';
import type { MovieHost } from './aptMovieFiles';
import { checkAptWorkspace } from './aptWorkspaceCheck';

/**
 * The APT commands. "New APT Movie" writes an empty movie's `.apt`, `.const`
 * and `.dat` into a folder, loose or inside an archive, and opens it in the
 * APT editor; the rest check, rename and delete movies, or reach into an open
 * editor the way its page does.
 */

type Target = CommandTarget;

const resolveTargetFolder = async (target: Target): Promise<vscode.Uri | undefined> => {
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

/** Options for a new movie, when a caller supplies them instead of the prompts */
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
const createMovie = async (
  target: Target,
  given?: NewMovieOptions,
): Promise<vscode.Uri | undefined> => {
  const folder = await resolveTargetFolder(target);

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

const getOpenDocument = (
  editor: AptEditorProvider,
  uri: vscode.Uri,
): AptDocument => {
  const document = editor.findDocument(uri.toString());

  if (!document) {
    throw new Error(`${uri.toString()} is not open in the APT editor`);
  }
  return document;
};

/** Registers the APT commands, the ones into an open movie through `editor` */
export const registerAptCommands = (
  context: vscode.ExtensionContext,
  editor: AptEditorProvider,
  archiveModel: ArchiveModel,
): void => {
  const movieHost: MovieHost = {
    archiveModel,
    async editOpen(uri, edit) {
      const document = editor.findDocument(uri.toString());

      if (!document) {
        return false;
      }
      await editor.edit(document, edit);
      return true;
    },
  };

  context.subscriptions.push(
    registerCommand(
      'bigfs.newAptMovie',
      async (target: Target, options?: NewMovieOptions) => {
        try {
          return await createMovie(target, options);
        } catch (error) {
          void vscode.window.showErrorMessage(
            describeError(error),
          );
          return undefined;
        }
      },
    ),
    registerCommand('bigfs.checkAptMovies', () =>
      checkAptWorkspace(archiveModel, editor.problems, (key) =>
        editor.findDocument(key),
      ),
    ),
    registerCommand(
      'bigfs.renameAptMovie',
      async (target?: unknown, name?: string) => {
        try {
          const renamed = await renameMovie(movieHost, target, name);

          // Reopened under its new name when it was asked for from the editor
          if (renamed && !name) {
            await vscode.commands.executeCommand(
              'vscode.openWith',
              renamed,
              APT_VIEW_TYPE,
            );
          }
          return renamed;
        } catch (error) {
          void vscode.window.showErrorMessage(
            describeError(error),
          );
          return undefined;
        }
      },
    ),
    registerCommand(
      'bigfs.deleteAptMovie',
      (target?: unknown, confirmed?: boolean) =>
        deleteMovie(movieHost, target, confirmed === true),
    ),
    // The page's ways into script tabs, for automation and tests
    registerCommand(
      'bigfs.aptOpenScript',
      async (uri: vscode.Uri, block: number, label = `block ${block}`) =>
        editor.openScript(getOpenDocument(editor, uri), block, label),
    ),
    registerCommand(
      'bigfs.aptAddScript',
      async (uri: vscode.Uri, site: ScriptSite, label = 'new script') => {
        const document = getOpenDocument(editor, uri);

        return editor.openScript(
          document,
          await editor.addScript(document, site),
          label,
        );
      },
    ),
    // The same edit path the page uses, for automation and tests
    registerCommand(
      'bigfs.aptApplyEdit',
      async (uri: vscode.Uri, edit?: AptEdit) => {
        const document = getOpenDocument(editor, uri);

        if (!edit) {
          return {
            pageReady: editor.isPageReady(document),
            ...editor.getShownImports(document),
          };
        }

        const result = await editor.edit(document, edit);

        await editor.redraw(document);
        return {
          ...result,
          pageReady: editor.isPageReady(document),
        };
      },
    ),
  );
};
