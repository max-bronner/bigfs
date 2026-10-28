import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseCsf } from '../../formats/csf/csf';

/** The `.str` language and the conversion command, end to end */
suite('String tables', () => {
  let strPath: string;
  let csfPath: string;

  suiteSetup(async () => {
    const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;

    strPath = path.join(folder, 'strings-test.str');
    csfPath = path.join(folder, 'strings-test.csf');
    await fs.writeFile(
      strPath,
      Buffer.from(
        'A:One\r\n"Caf\xe9"\r\nEND\r\nA:One\r\n"Again"\r\nEND\r\n',
        'latin1',
      ),
    );
  });

  suiteTeardown(async () => {
    await fs.rm(strPath, { force: true });
    await fs.rm(csfPath, { force: true });
  });

  test('a .str opens in its language, read as Windows-1252, with problems and an outline', async () => {
    const document = await vscode.workspace.openTextDocument(strPath);

    assert.strictEqual(document.languageId, 'sage-str');
    assert.ok(document.getText().includes('Café'));

    await new Promise((resolve) => setTimeout(resolve, 300));

    const problems = vscode.languages.getDiagnostics(document.uri);

    assert.ok(problems.some((problem) => /Duplicate/.test(problem.message)));

    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >('vscode.executeDocumentSymbolProvider', document.uri);

    assert.deepStrictEqual(
      symbols.map((symbol) => symbol.name),
      ['A:One', 'A:One'],
    );
  });

  test('converting a .str writes a .csf with every record', async () => {
    await vscode.commands.executeCommand(
      'bigfs.convertStringTable',
      vscode.Uri.file(strPath),
    );

    const file = parseCsf(await fs.readFile(csfPath));

    assert.deepStrictEqual(
      file.labels.map((label) => [label.name, label.strings[0].text]),
      [
        ['A:One', 'Café'],
        ['A:One', 'Again'],
      ],
    );
  });
});
