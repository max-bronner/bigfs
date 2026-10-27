import * as assert from 'assert';
import * as vscode from 'vscode';
import { toUri } from '../../common/commandTarget';
import { getNodeUri } from '../../model/nodeAddress';
import type { Archive } from '../../model/archive';
import type { VirtualNode } from '../../model/virtualNode';
import type { GameRow } from '../../providers/explorerNode';
import type { GameViewNode } from '../../model/gameViewModel';

const node = (entryPath: string): VirtualNode =>
  ({
    name: entryPath.split('/').pop()!,
    type: vscode.FileType.File,
    entryPath,
    archive: { rootPath: 'src-1/Art.big' } as unknown as Archive,
  }) as VirtualNode;

const gameRow = (winner: GameViewNode['winner']): GameRow => ({
  kind: 'game',
  node: { name: 'a.tga', path: 'a.tga', winner } as GameViewNode,
});

suite('Command target', () => {
  test('a uri is its own target', () => {
    const uri = vscode.Uri.file('/a/b.tga');

    assert.strictEqual(toUri(uri), uri);
  });

  test('a tree item resolves to its resourceUri', () => {
    const item = new vscode.TreeItem('b.tga');

    item.resourceUri = vscode.Uri.file('/a/b.tga');
    assert.strictEqual(toUri(item), item.resourceUri);
  });

  test('a virtual node resolves to its bigfs uri', () => {
    const file = node('textures/a.tga');

    assert.strictEqual(
      toUri(file)!.toString(),
      'bigfs:/src-1/Art.big/textures/a.tga',
    );
    assert.strictEqual(toUri(file)!.toString(), getNodeUri(file).toString());
  });

  test('a game row resolves to the copy the game loads', () => {
    const file = node('textures/a.tga');
    const loose = vscode.Uri.file('/game/a.tga');

    assert.strictEqual(
      toUri(
        gameRow({
          origin: 'Art.big',
          entryPath: 'a.tga',
          ref: { kind: 'entry', node: file },
        }),
      )!.toString(),
      getNodeUri(file).toString(),
    );
    assert.strictEqual(
      toUri(
        gameRow({
          origin: 'disk',
          entryPath: 'a.tga',
          ref: { kind: 'loose', uri: loose },
        }),
      ),
      loose,
    );
  });

  test('nothing resolves to nothing', () => {
    assert.strictEqual(toUri(undefined), undefined);
    assert.strictEqual(
      toUri({ kind: 'game', node: { name: 'dir', path: 'dir' } }),
      undefined,
    );
  });
});
