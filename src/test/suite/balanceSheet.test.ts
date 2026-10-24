import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';

interface SheetHandle {
  rows: {
    name: string;
    selectable: boolean;
    cells: Record<
      string,
      {
        value: string;
        uri?: string;
        line?: number;
        start?: number;
        end?: number;
        from?: string;
      }
    >;
  }[];
  whenLoaded(): Promise<void>;
  receive(message: Record<string, unknown>): Promise<void>;
}

/** The balance sheet: values read across files, inherited, and edited */
suite('Balance sheet', () => {
  let folder: string;
  let file: string;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'balance',
    );
    file = path.join(folder, 'balance.ini');
    await mkdir(folder, { recursive: true });
    await writeFile(
      file,
      [
        'Object BalSoldier',
        '  Side = Men',
        '  KindOf = SELECTABLE INFANTRY',
        '  BuildCost = 300',
        '  WeaponSet',
        '    Conditions = None',
        '    Weapon = PRIMARY BalSword',
        '  End',
        '  Body = ActiveBody ModuleTag_Body',
        '    MaxHealth = 200',
        '  End',
        'End',
        'ChildObject BalCaptain BalSoldier',
        '  BuildCost = 500',
        'End',
        'Weapon BalSword',
        '  AttackRange = 30',
        '  DamageNugget',
        '    Damage = 45',
        '  End',
        'End',
        '',
      ].join('\r\n'),
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('reads, inherits and edits a value in place', async function () {
    this.timeout(60_000);

    const sheet = (await vscode.commands.executeCommand<SheetHandle>(
      'bigfs.openBalanceSheet',
    ))!;
    const until = Date.now() + 40_000;
    let captain: SheetHandle['rows'][number] | undefined;

    while (Date.now() < until) {
      await sheet.whenLoaded();
      captain = sheet.rows.find((row) => row.name === 'BalCaptain');
      if (captain?.cells.damage) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await sheet.receive({ kind: 'refresh' });
    }

    assert.ok(captain, 'the child was not read');

    const soldier = sheet.rows.find((row) => row.name === 'BalSoldier')!;

    assert.strictEqual(soldier.cells.health.value, '200');
    assert.strictEqual(captain.cells.cost.value, '500');
    assert.strictEqual(captain.cells.health.from, 'BalSoldier');
    assert.ok(captain.selectable, 'a child inherits being selectable');
    assert.strictEqual(captain.cells.damage.value, '45');

    const health = soldier.cells.health;

    await sheet.receive({
      kind: 'edit',
      uri: health.uri,
      line: health.line,
      start: health.start,
      end: health.end,
      old: '200',
      value: '250',
    });

    assert.match(await readFile(file, 'latin1'), /MaxHealth = 250\r\n/);
    assert.strictEqual(
      sheet.rows.find((row) => row.name === 'BalCaptain')!.cells.health.value,
      '250',
    );
  });
});
