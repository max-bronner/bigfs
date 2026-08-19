import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  test('activates and registers every contributed command', async () => {
    const extension = vscode.extensions.getExtension('max-bronner.bigfs');

    assert.ok(extension, 'extension not found');

    await extension.activate();

    assert.strictEqual(extension.isActive, true);

    const contributed: { command: string }[] =
      extension.packageJSON.contributes.commands;

    assert.ok(contributed.length, 'no commands contributed');

    const registered = await vscode.commands.getCommands(true);

    for (const { command } of contributed) {
      assert.ok(registered.includes(command), `${command} is not registered`);
    }
  });
});
