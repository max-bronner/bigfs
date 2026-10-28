import * as assert from 'assert';
import Module from 'module';
import type { VirtualNode } from '../../model/virtualNode';

// virtualNode only needs `FileType` from vscode, which a plain mocha run does
// not have; the stub is in place for the one require and then removed.
type Loader = (request: string, ...rest: unknown[]) => unknown;

const internals = Module as unknown as { _load: Loader };
const original = internals._load;

internals._load = (request, ...rest) =>
  request === 'vscode'
    ? { FileType: { File: 1, Directory: 2 } }
    : original.call(Module, request, ...rest);

let nodes: typeof import('../../model/virtualNode');

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodes = require('../../model/virtualNode');
} finally {
  internals._load = original;
}

const archive = {} as VirtualNode['archive'];
const otherArchive = {} as VirtualNode['archive'];

const nodeAt = (
  entryPath: string,
  inArchive: VirtualNode['archive'] = archive,
): VirtualNode => ({
  name: entryPath.slice(entryPath.lastIndexOf('/') + 1),
  type: 2,
  entryPath,
  archive: inArchive,
});

suite('Virtual node containment', () => {
  test('a node is inside the directories above it', () => {
    assert.ok(
      nodes.isInside(nodeAt('data/ini/object.ini'), nodeAt('data/ini')),
    );
    assert.ok(nodes.isInside(nodeAt('data/ini/object.ini'), nodeAt('data')));
  });

  test('a sibling whose name starts with the same prefix is not inside', () => {
    assert.ok(!nodes.isInside(nodeAt('data/ini2'), nodeAt('data/ini')));
    assert.ok(!nodes.isInside(nodeAt('data/ini2/a.ini'), nodeAt('data/ini')));
    assert.ok(!nodes.isInside(nodeAt('data/ini'), nodeAt('data/ini2')));
  });

  test('a node is not inside itself or below itself', () => {
    assert.ok(!nodes.isInside(nodeAt('data/ini'), nodeAt('data/ini')));
    assert.ok(!nodes.isInside(nodeAt('data'), nodeAt('data/ini')));
  });

  test('the same path in another archive is not inside', () => {
    assert.ok(
      !nodes.isInside(
        nodeAt('data/ini/object.ini', otherArchive),
        nodeAt('data/ini'),
      ),
    );
  });

  test('the archive root holds every other node of its archive', () => {
    assert.ok(nodes.isInside(nodeAt('data'), nodeAt('')));
    assert.ok(nodes.isInside(nodeAt('data/ini/object.ini'), nodeAt('')));
    assert.ok(!nodes.isInside(nodeAt(''), nodeAt('')));
    assert.ok(!nodes.isInside(nodeAt('data', otherArchive), nodeAt('')));
  });

  test('a selection holding a root and its descendants collapses to the root', () => {
    const root = nodeAt('');
    const folder = nodeAt('data');
    const sibling = nodeAt('data2');

    assert.deepStrictEqual(nodes.getTopLevelNodes([folder, root]), [root]);
    assert.deepStrictEqual(nodes.getTopLevelNodes([folder, sibling]), [
      folder,
      sibling,
    ]);
  });
});
