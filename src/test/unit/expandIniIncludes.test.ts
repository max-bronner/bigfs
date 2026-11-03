import * as assert from 'assert';
import { expandIniIncludes } from '../../formats/ini/expandIniIncludes';

const files: Record<string, string[]> = {
  'a.inc': ['  SubClass', '#include "Deep\\b.inc"', '  End'],
  'b.inc': ['    IconImage = Deep'],
  'self.inc': ['#include "self.inc"', 'tail'],
};
const read = async (path: string) => files[path.replace(/^.*[\\/]/, '').toLowerCase()];

suite('INI include expansion', () => {
  test('an include is replaced by its lines, nested ones too, a missing one stays as written', async () => {
    assert.deepStrictEqual(
      await expandIniIncludes(['Block', '#include "A.inc"', '#include "gone.inc"', 'End'], read),
      ['Block', '  SubClass', '    IconImage = Deep', '  End', '#include "gone.inc"', 'End'],
    );
  });

  test('a file that includes itself stops at a bounded depth', async () => {
    const lines = await expandIniIncludes(['#include "self.inc"'], read);

    assert.ok(lines.length < 20);
    assert.strictEqual(lines.filter((line) => line === 'tail').length, 4);
  });
});
