import * as os from 'os';
import * as vscode from 'vscode';
import { SCHEME } from '../constants';
import { BASE_SETTING, UNDERLYING_SETTING } from '../services/archives/baseGameFolders';
import { findInstalls, systemHost } from '../node/installDiscovery';
import type { FoundInstall } from '../node/installDiscovery';

/** Remembers that the quick pick was shown, so it is offered once */
const OFFERED_KEY = `${SCHEME}.installsOffered`;

interface InstallItem extends vscode.QuickPickItem {
  install: FoundInstall;
}

/** Looks for installs on this machine; a lookup that fails finds none */
const detect = async (): Promise<FoundInstall[]> => {
  try {
    return await findInstalls(
      systemHost({
        platform: process.platform,
        env: process.env,
        home: os.homedir(),
      }),
    );
  } catch {
    return [];
  }
};

/**
 * Shows the installs found in a quick pick and writes the one the user picks
 * to `bigfs.baseGameFolder`; ROTWK also names the BFME II install found, which
 * is the game beneath it. Nothing is written without a pick.
 */
const pick = async (installs: FoundInstall[]): Promise<void> => {
  const items: InstallItem[] = installs.map((install) => ({
    label: install.game.title,
    description: install.folder,
    detail:
      install.game.id === 'rotwk' &&
      installs.some(({ game }) => game.id === 'bfme2')
        ? 'Also sets the BFME II install found as the game beneath it'
        : undefined,
    install,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Game installs found: use one as the base game',
    placeHolder:
      'The folder becomes bigfs.baseGameFolder; it is never written to',
    ignoreFocusOut: true,
  });

  if (!picked) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Global;

  await configuration.update(BASE_SETTING, picked.install.folder, target);

  const underlying =
    picked.install.game.id === 'rotwk'
      ? installs.find(({ game }) => game.id === 'bfme2')
      : undefined;

  if (underlying) {
    await configuration.update(UNDERLYING_SETTING, underlying.folder, target);
  }
};

/**
 * Registers **BIG: Find Game Installs** and offers the installs once, after
 * the first scan, when neither base game folder setting is set
 */
export const registerInstallDetectCommands = (
  context: vscode.ExtensionContext,
  whenReady: Promise<void>,
): void => {
  const isUnset = (): boolean => {
    const configuration = vscode.workspace.getConfiguration();

    return (
      !configuration.get<string>(BASE_SETTING)?.trim() &&
      !configuration.get<string>(UNDERLYING_SETTING)?.trim()
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(`${SCHEME}.findGameInstalls`, async () => {
      const installs = await detect();

      if (!installs.length) {
        void vscode.window.showInformationMessage(
          'No game install was found. Set bigfs.baseGameFolder to its folder.',
        );
        return;
      }

      await pick(installs);
    }),
  );

  void whenReady
    .then(async () => {
      if (!isUnset() || context.globalState.get<boolean>(OFFERED_KEY)) {
        return;
      }

      const installs = await detect();

      if (!installs.length) {
        return; // nothing to offer, so the next start looks again
      }

      await context.globalState.update(OFFERED_KEY, true);
      await pick(installs);
    })
    .catch(() => undefined);
};
