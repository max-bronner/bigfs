import * as assert from 'assert';
import {
  findParticleDefinitions,
  readParticleDef,
} from '../../formats/particles/particleIni';
import { applyLineEdits, computeKeyEdits } from '../../formats/particles/particleKeys';
import type { KeyKind, KeyValue } from '../../formats/particles/particleKeys';

const BLOCK = `FXParticleSystem Sparks
  System
    Lifetime = 10 10
  End
  Alpha = DefaultAlpha
    Alpha1 = 0.00 0.00 0
    Alpha2 = 1.00 1.00 5
    Alpha3 = 0.00 0.00 10
  End
End`;

const FLAT = `ParticleSystem Smoke
  Lifetime = 20 30
End`;

const rewrite = (text: string, kind: KeyKind, keys: KeyValue[]) => {
  const [definition] = findParticleDefinitions(text);
  const result = applyLineEdits(text, computeKeyEdits(text, definition, kind, keys));

  return {
    text: result,
    def: readParticleDef(findParticleDefinitions(result)[0]),
  };
};

suite('Particle keys', () => {
  test('removing a middle key renumbers the rest in place', () => {
    const { text, def } = rewrite(BLOCK, 'Alpha', [
      { min: 0, max: 0, frame: 0 },
      { min: 0.25, max: 0.5, frame: 10 },
    ]);

    assert.ok(
      text.includes(
        '  Alpha = DefaultAlpha\n    Alpha1 = 0.00 0.00 0\n    Alpha2 = 0.25 0.50 10\n  End',
      ),
    );
    assert.deepStrictEqual(def.alphas[1], {
      value: { low: 0.25, high: 0.5 },
      frame: 10,
    });
  });

  test('a block system without colour keys gets a Color module', () => {
    const { text, def } = rewrite(BLOCK, 'Color', [
      { rgb: [255, 128, 0], frame: 0 },
      { rgb: [0, 0, 0], frame: 10 },
    ]);

    assert.ok(
      text.endsWith(
        '  Color = DefaultColor\n    Color1 = R:255 G:128 B:0 0\n    Color2 = R:0 G:0 B:0 10\n  End\nEnd',
      ),
    );
    assert.strictEqual(def.colors[1].frame, 10);
  });

  test('a flat system gets keys at its own level', () => {
    const { text, def } = rewrite(FLAT, 'Alpha', [
      { min: 1, max: 1, frame: 0 },
    ]);

    assert.strictEqual(
      text,
      'ParticleSystem Smoke\n  Lifetime = 20 30\n  Alpha1 = 1.00 1.00 0\nEnd',
    );
    assert.deepStrictEqual(def.alphas[0].value, { low: 1, high: 1 });
  });
});
