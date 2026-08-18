import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension('max-bronner.bigfs');

		assert.ok(extension, 'extension not found');

		await extension.activate();

		assert.strictEqual(extension.isActive, true);

		const commands = await vscode.commands.getCommands(true);

		assert.ok(commands.includes('bigfs.refreshArchives'));
	});
});
