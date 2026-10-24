import * as vscode from 'vscode';
import { spawn } from 'child_process';
import path from 'path';
import { planLaunch } from '../common/launchPlan';

/**
 * "Launch Game with Mod": starts the game with `-mod "<folder>"`, the way
 * mod shortcuts start BFME II and ROTWK, so a change can be tried without
 * copying files into the install. Unsaved editors are saved first, since the
 * game reads the files on disk.
 */

export const EXECUTABLE_SETTING = 'bigfs.game.executable';
export const ARGUMENTS_SETTING = 'bigfs.game.arguments';

type Target = vscode.Uri | { resourceUri?: vscode.Uri } | undefined;

const askExecutable = async (): Promise<string | undefined> => {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: false,
    openLabel: 'Use This Game',
    title: 'The game to launch, e.g. lotrbfme2ep1.exe or lotrbfme2.exe',
    filters:
      process.platform === 'win32'
        ? { Programs: ['exe'] }
        : { 'All files': ['*'] },
  });

  if (!picked?.[0]) {
    return undefined;
  }
  await vscode.workspace
    .getConfiguration()
    .update(
      EXECUTABLE_SETTING,
      picked[0].fsPath,
      vscode.ConfigurationTarget.Global,
    );
  return picked[0].fsPath;
};

/** The mod folder: what was clicked, or a workspace folder */
const modFolderOf = async (target: Target): Promise<string | undefined> => {
  const uri = target instanceof vscode.Uri ? target : target?.resourceUri;

  if (uri?.scheme === 'file') {
    const stat = await vscode.workspace.fs.stat(uri);

    return stat.type & vscode.FileType.Directory
      ? uri.fsPath
      : path.dirname(uri.fsPath);
  }

  const folders = (vscode.workspace.workspaceFolders ?? []).filter(
    (folder) => folder.uri.scheme === 'file',
  );

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: 'The mod folder to launch',
  });

  return picked?.uri.fsPath;
};

const launch = async (target: Target): Promise<void> => {
  const settings = vscode.workspace.getConfiguration();
  const executable =
    settings.get<string>(EXECUTABLE_SETTING) || (await askExecutable());

  if (!executable) {
    return;
  }

  const modFolder = await modFolderOf(target);

  if (!modFolder) {
    return;
  }

  await vscode.commands.executeCommand('workbench.action.files.saveAll');

  const plan = planLaunch(
    executable,
    modFolder,
    settings.get<string[]>(ARGUMENTS_SETTING, []),
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      detached: true,
      stdio: 'ignore',
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  void vscode.window.setStatusBarMessage(
    `Started ${path.basename(executable)} with ${path.basename(modFolder)}`,
    5000,
  );
};

export const registerLaunchCommands = (
  context: vscode.ExtensionContext,
): void => {
  const button = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );

  button.text = '$(play) Run mod';
  button.tooltip = 'Launch the game with this workspace as its -mod folder';
  button.command = 'bigfs.launchGame';

  const showButton = () => {
    if (vscode.workspace.getConfiguration().get<string>(EXECUTABLE_SETTING)) {
      button.show();
    } else {
      button.hide();
    }
  };

  showButton();
  context.subscriptions.push(
    button,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(EXECUTABLE_SETTING)) {
        showButton();
      }
    }),
    vscode.commands.registerCommand(
      'bigfs.launchGame',
      async (target: Target) => {
        try {
          await launch(target);
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Could not start the game: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    ),
  );
};
