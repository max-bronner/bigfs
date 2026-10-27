import * as assert from 'assert';
import {
  AUTO_MINIMUM_MODELS,
  decideAssetCheck,
} from '../../language/model/assetCheckPolicy';

suite('Asset check policy', () => {
  test('auto switches itself off, with a reason, without a base game folder', () => {
    assert.strictEqual(
      decideAssetCheck('auto', false, AUTO_MINIMUM_MODELS * 10),
      'no-base-game',
    );
  });

  test('auto checks once a configured base game has loaded', () => {
    assert.strictEqual(
      decideAssetCheck('auto', true, AUTO_MINIMUM_MODELS),
      'check',
    );
    assert.strictEqual(
      decideAssetCheck('auto', true, AUTO_MINIMUM_MODELS - 1),
      'off',
    );
  });

  test('on and off are taken as the user set them', () => {
    assert.strictEqual(decideAssetCheck('on', false, 0), 'check');
    assert.strictEqual(decideAssetCheck('off', true, 9999), 'off');
  });
});
