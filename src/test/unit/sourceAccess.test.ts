import * as assert from 'assert';
import {
  ReadOnlySourceError,
  assertWritableSource,
  isReadOnlySource,
} from '../../model/sourceAccess';

const baseSource = { label: 'Base game: bfme2', external: true };
const workspaceSource = { label: 'my-mod', external: false };

suite('source access', () => {
  test('a base game outside the workspace is read-only', () => {
    assert.strictEqual(isReadOnlySource(baseSource), true);
  });

  test('a folder of the workspace stays writable', () => {
    assert.strictEqual(isReadOnlySource(workspaceSource), false);
  });

  test('a write, delete or rename into the base game is rejected before it reaches an archive', () => {
    // Writes, deletes and renames all pass through this check in ArchiveModel.apply
    assert.throws(
      () => assertWritableSource(baseSource),
      (error: unknown) =>
        error instanceof ReadOnlySourceError &&
        error.message.includes('Base game: bfme2 is read-only'),
    );
  });

  test('a workspace source accepts the same writes', () => {
    assert.doesNotThrow(() => assertWritableSource(workspaceSource));
  });
});
