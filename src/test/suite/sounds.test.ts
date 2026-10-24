import * as assert from 'assert';
import * as vscode from 'vscode';
import path from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';

/** A short 8-bit PCM WAV, enough for the player to accept */
const wav = (): Buffer => {
  const samples = 800;
  const bytes = Buffer.alloc(44 + samples);

  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(36 + samples, 4);
  bytes.write('WAVEfmt ', 8, 'latin1');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36, 'latin1');
  bytes.writeUInt32LE(samples, 40);
  bytes.fill(128, 44);
  return bytes;
};

/** Sounds played from INI files: the lens, the hover links and the player */
suite('Sounds from INI files', () => {
  let folder: string;
  let document: vscode.TextDocument;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('max-bronner.bigfs')!.activate();
    folder = path.join(
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      'sounds',
    );
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'sndtesta.wav'), wav());
    await writeFile(
      path.join(folder, 'sounds.ini'),
      [
        'AudioEvent SndTestVoice',
        '  Sounds = sndtesta sndtestb:2000',
        '  Type = UI',
        'End',
        'Object SndTestUnit',
        '  VoiceSelect = SndTestVoice',
        'End',
        '',
      ].join('\r\n'),
    );
    document = await vscode.languages.setTextDocumentLanguage(
      await vscode.workspace.openTextDocument(path.join(folder, 'sounds.ini')),
      'sage-ini',
    );
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await rm(folder, { recursive: true, force: true });
  });

  test('an audio event has a Play lens', async () => {
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      document.uri,
    );

    assert.ok(lenses.some((lens) => lens.command?.title === '▶ Play'));
  });

  test('a sound plays from any folder, and a missing one does not', async function () {
    this.timeout(20_000);

    assert.strictEqual(
      await vscode.commands.executeCommand(
        'bigfs.playSound',
        'sndtesta',
        document.uri.toString(),
      ),
      'sndtesta.wav',
    );
    assert.strictEqual(
      await vscode.commands.executeCommand(
        'bigfs.playSound',
        'sndtestb',
        document.uri.toString(),
      ),
      undefined,
    );
  });

  test('a value naming an audio event lists its sounds with play links', async function () {
    this.timeout(30_000);

    const until = Date.now() + 25_000;
    let text = '';

    while (Date.now() < until && !text.includes('2 sounds')) {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        new vscode.Position(5, 20),
      );

      text = hovers
        .flatMap((hover) => hover.contents)
        .map((content) =>
          typeof content === 'string' ? content : content.value,
        )
        .join('\n');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    assert.match(text, /`SndTestVoice` — 2 sounds/);
    assert.match(text, /\[▶ sndtesta\]\(command:bigfs\.playSound\?/);
    assert.match(text, /\[▶ sndtestb\]/);
  });
});
