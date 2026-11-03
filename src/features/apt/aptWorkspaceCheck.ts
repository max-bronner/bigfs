import * as vscode from 'vscode';
import { checkMovie } from '../../formats/apt/aptIntegrity';
import type { Problem } from '../../formats/apt/aptIntegrity';
import type { ArchiveModel } from '../../services/archives/archiveModel';
import { describeError } from '../../core/errors';
import { createMovieAccess, findWorkspaceMovies } from './aptAccess';
import type { AptDocument } from './aptDocument';

/** Shows what the integrity check found on a movie's `.apt` */
export const showProblems = (
  problems: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  found: Problem[],
): void => {
  problems.set(
    uri,
    found.map((problem) => {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        problem.message,
        problem.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : problem.severity === 'warning'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information,
      );

      diagnostic.source = 'APT';
      return diagnostic;
    }),
  );
};

/**
 * Checks a movie and the files beside it, as edited, and shows what was
 * found on its `.apt`; imports that do not resolve are warnings with it
 */
export const checkAptDocument = async (
  problems: vscode.DiagnosticCollection,
  document: AptDocument,
  unresolved: string[],
): Promise<Problem[]> => {
  const found = [
    ...(await checkMovie(
      createMovieAccess(
        document.uri,
        document.name,
        document.image.bytes,
        document.editedFiles,
      ),
    )),
    ...unresolved.map(
      (entry): Problem => ({
        severity: 'warning',
        message: `The import ${entry} resolves in no install`,
      }),
    ),
  ];

  showProblems(problems, document.uri, found);
  return found;
};

/**
 * Checks every movie of the workspace, loose or in an archive, and says what
 * was found. An open movie is checked as edited.
 */
export const checkAptWorkspace = async (
  archiveModel: ArchiveModel,
  problems: vscode.DiagnosticCollection,
  findDocument: (key: string) => AptDocument | undefined,
): Promise<void> => {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Checking APT movies',
      cancellable: true,
    },
    async (progress, token) => {
      const movies = await findWorkspaceMovies(archiveModel);

      let errors = 0;
      let warnings = 0;

      for (const [index, uri] of movies.entries()) {
        if (token.isCancellationRequested) {
          break;
        }
        progress.report({
          message: `${index + 1} of ${movies.length}`,
          increment: 100 / movies.length,
        });

        const name = uri.path
          .slice(uri.path.lastIndexOf('/') + 1)
          .replace(/\.apt$/i, '');
        const open = findDocument(uri.toString());
        let found: Problem[];

        try {
          found = await checkMovie(
            open
              ? createMovieAccess(
                  uri,
                  open.name,
                  open.image.bytes,
                  open.editedFiles,
                )
              : createMovieAccess(
                  uri,
                  name,
                  await vscode.workspace.fs.readFile(uri),
                ),
          );
        } catch (error) {
          found = [
            {
              severity: 'error',
              message: `Cannot read the movie: ${describeError(error)}`,
            },
          ];
        }
        errors += found.filter((each) => each.severity === 'error').length;
        warnings += found.filter(
          (each) => each.severity === 'warning',
        ).length;
        showProblems(problems, uri, found);
      }

      void vscode.window.showInformationMessage(
        `Checked ${movies.length} APT movie${movies.length === 1 ? '' : 's'}: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`,
      );
      if (errors || warnings) {
        await vscode.commands.executeCommand(
          'workbench.actions.view.problems',
        );
      }
    },
  );
};
