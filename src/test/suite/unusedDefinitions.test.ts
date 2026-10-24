import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** Definitions in the workspace no INI file names */
suite('Unused definitions', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'unused',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'weapons.ini'),
      'Weapon UnusedTestUsedWeapon\r\n  AttackRange = 30\r\nEnd\r\nWeapon UnusedTestSpareWeapon\r\n  AttackRange = 40\r\nEnd\r\n',
    );
    await writeFile(
      path.join(folder, 'units.ini'),
      'Object UnusedTestUnit\r\n  WeaponSet\r\n    Conditions = None\r\n    Weapon = PRIMARY UnusedTestUsedWeapon\r\n  End\r\nEnd\r\n',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('bigfs.clearUnusedDefinitions');
    await rm(folder, { recursive: true, force: true });
  });

  test('lists the weapon nothing fires, not the one a unit fires nor the unit', async function () {
    this.timeout(40_000);

    const weapons = vscode.Uri.file(path.join(folder, 'weapons.ini'));
    const until = Date.now() + 30_000;
    let messages: string[] = [];

    while (Date.now() < until) {
      await vscode.commands.executeCommand('bigfs.findUnusedDefinitions');
      messages = vscode.languages
        .getDiagnostics(weapons)
        .map((diagnostic) => diagnostic.message);
      if (messages.length === 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    assert.deepStrictEqual(messages, [
      "Weapon 'UnusedTestSpareWeapon' is not referenced by any INI file",
    ]);
    assert.deepStrictEqual(
      vscode.languages
        .getDiagnostics(vscode.Uri.file(path.join(folder, 'units.ini')))
        .filter((diagnostic) => diagnostic.source === 'bigFS unused'),
      [],
    );
  });
});
