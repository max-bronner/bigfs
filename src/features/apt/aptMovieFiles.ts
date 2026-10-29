import * as vscode from 'vscode';
import { parseAptMovie, parseConst } from '../../formats/apt/aptMovie';
import { applyAptEdit } from '../../formats/apt/writer/applyAptEdit';
import { AptImage } from '../../formats/apt/writer/aptImage';
import type { AptEdit } from '../../formats/apt/writer/aptEdit';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { findBeside, listBeside, workspaceMovies } from './aptAccess';
import { movieKey } from './aptLibrary';
import { toUri } from '../../services/archives/commandTarget';

/**
 * A movie as a whole: its `.apt`, `.const` and `.dat`, its `_geometry`
 * folder and its `art/textures/apt_<movie>_*` textures, renamed or deleted
 * together, loose or inside an archive. Renaming also updates every import
 * of the old name in the workspace's other movies, so they keep resolving.
 */

/** What the commands need from the APT editor */
export interface MovieHost {
  archiveModel: ArchiveModel;
  /** Applies an edit to a movie open in the editor, as one undoable edit */
  editOpen(uri: vscode.Uri, edit: AptEdit): Promise<boolean>;
}

/** One file of a movie: where it is, and where it goes for a new name */
interface MovieFile {
  uri: vscode.Uri;
  relative: (name: string) => string;
}

const nameOf = (uri: vscode.Uri) =>
  uri.path.slice(uri.path.lastIndexOf('/') + 1).replace(/\.apt$/i, '');

/** Every file of the movie whose `.apt` this is */
export const movieFiles = async (aptUri: vscode.Uri): Promise<MovieFile[]> => {
  const name = nameOf(aptUri);
  const files: MovieFile[] = [{ uri: aptUri, relative: (to) => `${to}.apt` }];

  for (const extension of ['const', 'dat']) {
    const uri = await findBeside(
      aptUri,
      `${name}.${extension}`,
      vscode.FileType.File,
    );

    if (uri) {
      files.push({ uri, relative: (to) => `${to}.${extension}` });
    }
  }

  const geometry = await findBeside(
    aptUri,
    `${name}_geometry`,
    vscode.FileType.Directory,
  );

  if (geometry) {
    for (const [file, type] of await listBeside(aptUri, `${name}_geometry`)) {
      if (type & vscode.FileType.File) {
        files.push({
          uri: vscode.Uri.joinPath(geometry, file),
          relative: (to) => `${to}_geometry/${file}`,
        });
      }
    }
  }

  const textures = await findBeside(
    aptUri,
    'art/textures',
    vscode.FileType.Directory,
  );
  const prefix = `apt_${name.toLowerCase()}_`;

  if (textures) {
    for (const [file, type] of await listBeside(aptUri, 'art/textures')) {
      if (
        type & vscode.FileType.File &&
        file.toLowerCase().startsWith(prefix)
      ) {
        files.push({
          uri: vscode.Uri.joinPath(textures, file),
          relative: (to) =>
            `art/textures/apt_${to.toLowerCase()}_${file.slice(prefix.length)}`,
        });
      }
    }
  }
  return files;
};

/** The workspace's other movies that import this one, with which imports */
const importersOf = async (host: MovieHost, aptUri: vscode.Uri) => {
  const key = movieKey(nameOf(aptUri));
  const found: { uri: vscode.Uri; imports: number[] }[] = [];

  for (const uri of await workspaceMovies(host.archiveModel)) {
    if (uri.toString() === aptUri.toString()) {
      continue;
    }
    try {
      const constUri = await findBeside(
        uri,
        `${nameOf(uri)}.const`,
        vscode.FileType.File,
      );

      if (!constUri) {
        continue;
      }

      const movie = parseAptMovie(
        await vscode.workspace.fs.readFile(uri),
        parseConst(await vscode.workspace.fs.readFile(constUri)).movieOffset,
      );
      const imports = movie.imports.flatMap((entry, index) =>
        movieKey(entry.movie) === key ? [index] : [],
      );

      if (imports.length) {
        found.push({ uri, imports });
      }
    } catch {
      continue; // a movie that does not read imports nothing
    }
  }
  return found;
};

/** Closes the movie's editor tabs; false when one with unsaved changes stays */
const closeTabs = async (aptUri: vscode.Uri): Promise<boolean> => {
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputCustom &&
        tab.input.uri.toString() === aptUri.toString(),
    );

  if (tabs.some((tab) => tab.isDirty)) {
    void vscode.window.showWarningMessage(
      `${nameOf(aptUri)} has unsaved changes: save or revert it first`,
    );
    return false;
  }
  await vscode.window.tabGroups.close(tabs);
  return true;
};

/** The movie a command was given, or the one in the active editor */
const targetOf = (target: unknown): vscode.Uri | undefined => {
  const given = toUri(target);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;

  return (
    given ?? (input instanceof vscode.TabInputCustom ? input.uri : undefined)
  );
};

/** Renames a movie and every file of it, and the imports that name it */
export const renameMovie = async (
  host: MovieHost,
  target: unknown,
  newName?: string,
): Promise<vscode.Uri | undefined> => {
  const aptUri = targetOf(target);

  if (!aptUri || !/\.apt$/i.test(aptUri.path)) {
    return undefined;
  }

  const name = nameOf(aptUri);
  const to =
    newName ??
    (await vscode.window.showInputBox({
      title: `Rename the movie ${name}`,
      value: name,
      validateInput: (value) =>
        /^[A-Za-z0-9_]+$/.test(value)
          ? undefined
          : 'Letters, digits and underscores, as the game names movies',
    }));

  if (!to || to === name || !/^[A-Za-z0-9_]+$/.test(to)) {
    return undefined;
  }
  if (await findBeside(aptUri, `${to}.apt`, vscode.FileType.File)) {
    throw new Error(`${to}.apt is already beside ${name}.apt`);
  }
  if (!(await closeTabs(aptUri))) {
    return undefined;
  }

  const folder = vscode.Uri.joinPath(aptUri, '..');
  const files = await movieFiles(aptUri);
  const importers = await importersOf(host, aptUri);

  for (const file of files) {
    const destination = vscode.Uri.joinPath(folder, file.relative(to));

    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(destination, '..'),
    );
    await vscode.workspace.fs.rename(file.uri, destination, {
      overwrite: false,
    });
  }

  const oldGeometry = await findBeside(
    aptUri,
    `${name}_geometry`,
    vscode.FileType.Directory,
  );

  if (oldGeometry) {
    await Promise.resolve(
      vscode.workspace.fs.delete(oldGeometry, { recursive: true }),
    ).catch(() => undefined);
  }

  // Imports elsewhere follow the new name: as an edit where the movie is open
  for (const importer of importers) {
    const edits: AptEdit[] = importer.imports.map((index) => ({
      kind: 'import',
      index,
      movie: to,
    }));
    let applied = true;

    for (const edit of edits) {
      applied = (await host.editOpen(importer.uri, edit)) && applied;
    }
    if (!applied) {
      const constUri = (await findBeside(
        importer.uri,
        `${nameOf(importer.uri)}.const`,
        vscode.FileType.File,
      ))!;
      const image = new AptImage(
        await vscode.workspace.fs.readFile(importer.uri),
      );
      const movieOffset = parseConst(
        await vscode.workspace.fs.readFile(constUri),
      ).movieOffset;

      edits.forEach((edit) => applyAptEdit(image, movieOffset, edit));
      await vscode.workspace.fs.writeFile(importer.uri, image.bytes);
    }
  }

  void vscode.window.showInformationMessage(
    `Renamed ${name} to ${to}: ${files.length} file${files.length === 1 ? '' : 's'}` +
      (importers.length
        ? `, and the imports of ${importers.map((each) => nameOf(each.uri)).join(', ')}`
        : ''),
  );
  return vscode.Uri.joinPath(folder, `${to}.apt`);
};

/** Deletes a movie and every file of it, once the user agrees */
export const deleteMovie = async (
  host: MovieHost,
  target: unknown,
  confirmed = false,
): Promise<boolean> => {
  const aptUri = targetOf(target);

  if (!aptUri || !/\.apt$/i.test(aptUri.path)) {
    return false;
  }

  const name = nameOf(aptUri);
  const files = await movieFiles(aptUri);
  const importers = await importersOf(host, aptUri);

  if (!confirmed) {
    const answer = await vscode.window.showWarningMessage(
      `Delete the movie ${name} and its ${files.length} file${files.length === 1 ? '' : 's'}?`,
      {
        modal: true,
        detail: importers.length
          ? `${importers.map((each) => nameOf(each.uri)).join(', ')} import${importers.length === 1 ? 's' : ''} it and will no longer resolve.`
          : 'No other movie in the workspace imports it.',
      },
      'Delete',
    );

    if (answer !== 'Delete') {
      return false;
    }
  }
  if (!(await closeTabs(aptUri))) {
    return false;
  }
  for (const file of files) {
    await vscode.workspace.fs.delete(file.uri);
  }

  const geometry = await findBeside(
    aptUri,
    `${name}_geometry`,
    vscode.FileType.Directory,
  );

  if (geometry) {
    await Promise.resolve(
      vscode.workspace.fs.delete(geometry, { recursive: true }),
    ).catch(() => undefined);
  }
  return true;
};
