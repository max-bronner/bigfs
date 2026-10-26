import * as assert from 'assert';
import {
  findParticleDefinitions,
  numericFields,
} from '../../formats/particles/particleIni';
import { scaleEffect } from '../../formats/particles/particleScale';

const TEXT = `FXParticleSystem Test
  System
    Lifetime = 30 30
    Size = 4 6
  End
  Alpha = DefaultAlpha
    Alpha1 = 1.00 1.00 0
    Alpha2 = 0.00 0.00 30
  End
  Physics = DefaultPhysics
    Gravity = -0.2
    VelocityDamping = 0.81 0.81
  End
  EmissionVelocity = OrthoEmissionVelocity
    Z = 2 2
  End
  EmissionVolume = SphereEmissionVolume
    Radius = 10
  End
End`;

const scaled = (space: number, time: number) => {
  const fields = numericFields(findParticleDefinitions(TEXT)[0]);
  const values = scaleEffect(fields, new Map(), space, time);

  return Object.fromEntries(
    fields
      .filter((field) => values.has(field.id))
      .map((field) => [
        `${field.keyword} ${field.part}`.trim(),
        values.get(field.id),
      ]),
  );
};

suite('Particle effect scaling', () => {
  test('twice the size doubles lengths, speeds and gravity, and nothing else', () => {
    assert.deepStrictEqual(scaled(2, 1), {
      'Size min': 8,
      'Size max': 12,
      Gravity: -0.4,
      'Z min': 4,
      'Z max': 4,
      Radius: 20,
    });
  });

  test('twice the time stretches durations and keys, and slows rates to match', () => {
    assert.deepStrictEqual(scaled(1, 2), {
      'Lifetime min': 60,
      'Lifetime max': 60,
      'Alpha2 frame': 60,
      Gravity: -0.05,
      'VelocityDamping min': 0.9,
      'VelocityDamping max': 0.9,
      'Z min': 1,
      'Z max': 1,
    });
  });
});
