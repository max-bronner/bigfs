import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** What a definition uses and what uses it, and template inheritance */
suite('Definition hierarchy', () => {
  let folder: string;
  let document: vscode.TextDocument;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'hierarchy',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'hierarchy.ini'),
      [
        'Object HierUnit',
        '  WeaponSet',
        '    Conditions = None',
        '    Weapon = PRIMARY HierSword',
        '  End',
        'End',
        'ChildObject HierChild HierUnit',
        '  BuildCost = 10',
        'End',
        'Weapon HierSword',
        '  AttackRange = 30',
        'End',
        '',
      ].join('\r\n'),
    );
    document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(
        path.join(folder, 'hierarchy.ini'),
      ),
      'sage-ini',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  /** Retries a query until the index has read the file */
  const settle = async <T>(query: () => Thenable<T[]>): Promise<T[]> => {
    const until = Date.now() + 25_000;

    for (;;) {
      const result = await query();

      if (result?.length || Date.now() > until) {
        return result ?? [];
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  };

  test('a unit uses its weapon, and the weapon is used by the unit', async function () {
    this.timeout(40_000);

    const [unit] = await vscode.commands.executeCommand<
      vscode.CallHierarchyItem[]
    >('vscode.prepareCallHierarchy', document.uri, new vscode.Position(0, 9));

    assert.strictEqual(unit?.name, 'HierUnit');

    const outgoing = await settle(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
        'vscode.provideOutgoingCalls',
        unit,
      ),
    );

    assert.deepStrictEqual(
      outgoing.map((call) => [call.to.name, call.to.detail]),
      [['HierSword', 'Weapon']],
    );

    const incoming = await settle(() =>
      vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
        'vscode.provideIncomingCalls',
        outgoing[0].to,
      ),
    );

    assert.deepStrictEqual(
      incoming.map((call) => call.from.name),
      ['HierUnit'],
    );
  });

  test('a child names its parent, and the parent lists the child', async function () {
    this.timeout(40_000);

    const [child] = await vscode.commands.executeCommand<
      vscode.TypeHierarchyItem[]
    >('vscode.prepareTypeHierarchy', document.uri, new vscode.Position(6, 14));

    assert.strictEqual(child?.name, 'HierChild');

    const parents = await settle(() =>
      vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
        'vscode.provideSupertypes',
        child,
      ),
    );

    assert.deepStrictEqual(
      parents.map((item) => item.name),
      ['HierUnit'],
    );

    const children = await settle(() =>
      vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
        'vscode.provideSubtypes',
        parents[0],
      ),
    );

    assert.deepStrictEqual(
      children.map((item) => item.name),
      ['HierChild'],
    );
  });
});
