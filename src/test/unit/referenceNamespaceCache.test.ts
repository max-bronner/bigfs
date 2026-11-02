import * as assert from 'assert';
import { createReferenceNamespaceCache } from '../../formats/ini/createReferenceNamespaceCache';

suite('reference namespace cache', () => {
  test('answers a repeated field in the same block without asking again', () => {
    const asked: string[] = [];
    const cached = createReferenceNamespaceCache((field, context, token) => {
      asked.push(`${context}/${field}/${token}`);

      return [field.toUpperCase()];
    });

    assert.deepStrictEqual(cached('weapon', 'Object', 0), ['WEAPON']);
    assert.deepStrictEqual(cached('weapon', 'Object', 0), ['WEAPON']);
    assert.deepStrictEqual(asked, ['Object/weapon/0']);
  });

  test('keeps the answers of another block, token or missing context apart', () => {
    const cached = createReferenceNamespaceCache((field, context, token) => [
      `${context ?? 'none'}:${field}:${token ?? 'any'}`,
    ]);

    assert.deepStrictEqual(cached('a', 'x', 0), ['x:a:0']);
    assert.deepStrictEqual(cached('a', 'y', 0), ['y:a:0']);
    assert.deepStrictEqual(cached('a', 'x', 1), ['x:a:1']);
    assert.deepStrictEqual(cached('a'), ['none:a:any']);
    assert.deepStrictEqual(cached('a', 'x', 0), ['x:a:0']);
  });

  test('an empty answer is remembered too', () => {
    let calls = 0;
    const cached = createReferenceNamespaceCache(() => {
      calls += 1;

      return [];
    });

    cached('f', 'c', 0);
    cached('f', 'c', 0);

    assert.strictEqual(calls, 1);
  });
});
