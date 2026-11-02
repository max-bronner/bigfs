import * as assert from 'assert';
import { getChangedPaths } from '../../services/archives/getChangedPaths';

suite('changed entry paths', () => {
  test('a write names its path, a removal its path, a move or copy both ends', () => {
    assert.deepStrictEqual(
      getChangedPaths([
        {
          kind: 'put',
          path: 'data/ini/a.ini',
          source: { kind: 'data', content: new Uint8Array() },
        },
        { kind: 'remove', path: 'data/ini/b.ini' },
        { kind: 'move', from: 'data/old', to: 'data/new' },
        { kind: 'copy', from: 'data/x.ini', to: 'data/y.ini' },
      ]),
      [
        'data/ini/a.ini',
        'data/ini/b.ini',
        'data/old',
        'data/new',
        'data/x.ini',
        'data/y.ini',
      ],
    );
  });

  test('a new directory touches no entry', () => {
    assert.deepStrictEqual(
      getChangedPaths([{ kind: 'addDirectory', path: 'data/new' }]),
      [],
    );
  });
});
