import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/**
 * A new unit from an existing one: the object, a button that builds it in
 * the set that builds the original, and its text, each in the file the
 * original's lives in. Everything is synthetic.
 */

const UNITS = [
  'Object WizardArcher',
  '  DisplayName = OBJECT:WizardArcher',
  '  Side = Testland',
  'End',
  '',
  'CommandButton Command_ConstructWizardArcher',
  '  Command = UNIT_BUILD',
  '  Object = WizardArcher',
  '  TextLabel = CONTROLBAR:ConstructWizardArcher',
  'End',
  '',
  'CommandSet WizardBarracks',
  '  1 = Command_ConstructWizardArcher',
  'End',
  '',
].join('\n');

const STRINGS = [
  'OBJECT:WizardArcher',
  '"Archer"',
  'END',
  '',
  'CONTROLBAR:ConstructWizardArcher',
  '"Recruit Archer"',
  'END',
  '',
].join('\n');

const LOADED = 'data/ini/object';

suite('New unit wizard', () => {
  let folder: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'newunit',
    );
    // Under Data/INI/Object, the folder the game loads objects from
    await mkdir(path.join(folder, LOADED), { recursive: true });
    await mkdir(path.join(folder, 'stray'), { recursive: true });
    await writeFile(path.join(folder, LOADED, 'units.ini'), UNITS);
    await writeFile(
      path.join(folder, 'stray', 'units.ini'),
      UNITS.replace(/Wizard/g, 'Stray'),
    );
    await writeFile(path.join(folder, 'strings.str'), STRINGS);
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('writes the object, its button, its slot and its text', async function () {
    this.timeout(60_000);

    const timeoutAt = Date.now() + 40_000;
    let result: { left: string[] } | undefined;

    // The index reads the new files through its watcher
    while (!result && Date.now() < timeoutAt) {
      result = await vscode.commands.executeCommand('bigfs.newObject', {
        source: 'WizardArcher',
        name: 'WizardRanger',
        mode: 'inherit',
        text: 'Ranger',
        commandSet: 'WizardBarracks',
      });
      if (!result) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    assert.deepStrictEqual(result?.left, []);

    const text = async (name: string) =>
      (await vscode.workspace.openTextDocument(path.join(folder, name)))
        .getText()
        .replace(/\r\n/g, '\n');
    const units = await text(`${LOADED}/units.ini`);
    const strings = await text('strings.str');

    assert.match(
      units,
      /ChildObject WizardRanger WizardArcher\n {2}DisplayName = OBJECT:WizardRanger\n/,
    );
    assert.match(
      units,
      /CommandButton Command_ConstructWizardRanger\n {2}Command = UNIT_BUILD\n {2}Object = WizardRanger\n {2}TextLabel = CONTROLBAR:ConstructWizardRanger\nEnd/,
    );
    assert.match(units, / {2}2 = Command_ConstructWizardRanger\nEnd/);
    assert.match(strings, /OBJECT:WizardRanger\n"Ranger"\nEND/);
    assert.match(
      strings,
      /CONTROLBAR:ConstructWizardRanger\n"Recruit Archer"\nEND/,
    );
  });

  test('an object beside a file the game never loads is written to a loaded file', async function () {
    this.timeout(60_000);

    const timeoutAt = Date.now() + 40_000;
    let result: { left: string[] } | undefined;

    while (!result && Date.now() < timeoutAt) {
      result = await vscode.commands.executeCommand('bigfs.newObject', {
        source: 'StrayArcher',
        name: 'StrayRanger',
        mode: 'copy',
        text: 'Ranger',
      });
      if (!result) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    assert.ok(result);

    const created = (
      await vscode.workspace.openTextDocument(
        path.join(folder, '..', LOADED, 'StrayRanger.ini'),
      )
    ).getText();

    assert.match(created, /Object StrayRanger/);
    await rm(path.join(folder, '..', 'data'), { recursive: true, force: true });
  });
});
