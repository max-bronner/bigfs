import * as assert from 'assert';
import {
  applyValueEdits,
  findParticleDefinitions,
  findNumericFields,
  readFxList,
  readParticleDef,
  computeValueEdits,
} from '../../formats/particles/particleIni';
import type { ParticleDef } from '../../formats/particles/particleIni';
import { getEffectStateAt } from '../../formats/particles/fxEffects';
import { ParticleWorld } from '../../formats/particles/particleSimulation';

// Synthetic definitions: field names are the games' grammar, values invented
const BLOCK = `
FXParticleSystem TestSparks ; a comment
  System
    Priority = ALWAYS_RENDER
    ParticleName = test_spark.tga
    Shader = ALPHA
    Lifetime = 10 10
    BurstCount = 2 2
    BurstDelay = 4 4
    Size = 3 5
    SlaveSystem = TestSlave
  End
  Color = DefaultColor
    Color1 = R:255 G:0 B:0 0
    Color2 = R:0 G:0 B:255 10
  End
  Alpha = DefaultAlpha
    Alpha1 = 0.00 0.00 0
    Alpha2 = 1.00 1.00 5
    Alpha3 = 0.00 0.00 10
  End
  Update = DefaultUpdate
    SizeRate = 1 1
    SizeRateDamping = 0.5 0.5
  End
  Physics = DefaultPhysics
    Gravity = -0.5
    VelocityDamping = 1 1
  End
  EmissionVelocity = OrthoEmissionVelocity
    Z = 2 2
  End
  EmissionVolume = CylinderEmissionVolume
    Radius = 4
    Length = 2
    IsHollow = Yes
  End
  Draw = DefaultDraw
  End
  Wind = DefaultWind
    WindMotion = PingPong
  End
End

FXParticleSystem TestSlave
  System
    Lifetime = 3 3
  End
End
`;

const FLAT = `
ParticleSystem TestFlat
  Lifetime = 20 30
  VolumeType = BOX
  VolBoxHalfSize = X:1 Y:2 Z:3
  VelocityType = OUTWARD
  VelOutward = 5 6
  VelOutwardOther = 1 1
End
`;

const FX = `
FXList FX_Test
  PlayEvenIfShrouded = Yes
  ParticleSystem
    Name = TestSparks
    Offset = X:0 Y:0 Z:10
    InitialDelay = 100
  End
  Sound
    Name = SomeSound
  End
  ParticleSystem
    Name = TestFlat
    Count = 2
  End
End
`;

const definitionsOf = (text: string) => findParticleDefinitions(text);

const worldOf = (...defs: ParticleDef[]) =>
  new ParticleWorld({
    findSystem: (name) =>
      defs.find((def) => def.name.toLowerCase() === name.toLowerCase()),
    findFxList: () => undefined,
  });

suite('Particle systems', () => {
  test('the block form reads its modules', () => {
    const [sparks, slave] = definitionsOf(BLOCK);
    const def = readParticleDef(sparks);

    assert.strictEqual(def.name, 'TestSparks');
    assert.strictEqual(def.shader, 'ALPHA');
    assert.strictEqual(def.particleName, 'test_spark.tga');
    assert.deepStrictEqual(def.size, { low: 3, high: 5 });
    assert.deepStrictEqual(def.volume, {
      type: 'cylinder',
      radius: 4,
      length: 2,
      offset: [0, 0, 0],
      hollow: true,
    });
    assert.deepStrictEqual(def.velocity, {
      type: 'ortho',
      x: { low: 0, high: 0 },
      y: { low: 0, high: 0 },
      z: { low: 2, high: 2 },
    });
    assert.deepStrictEqual(def.colors[1], { rgb: [0, 0, 1], frame: 10 });
    assert.strictEqual(def.alphas[1].frame, 5);
    assert.strictEqual(def.drawModule, 'DefaultDraw');
    assert.strictEqual(def.wind?.motion, 'pingpong');
    assert.strictEqual(def.wind?.strength, 2);
    assert.strictEqual(def.slaveSystem, 'TestSlave');
    assert.strictEqual(readParticleDef(slave).shader, 'ADDITIVE');
  });

  test('the flat form reads its emitter fields', () => {
    const def = readParticleDef(definitionsOf(FLAT)[0]);

    assert.strictEqual(def.form, 'flat');
    assert.deepStrictEqual(def.volume, {
      type: 'box',
      halfSize: [1, 2, 3],
      hollow: false,
    });
    assert.deepStrictEqual(def.velocity, {
      type: 'outward',
      speed: { low: 5, high: 6 },
      otherSpeed: { low: 1, high: 1 },
    });
  });

  test('an FX list keeps each particle and sound nugget and names the rest', () => {
    const list = readFxList(definitionsOf(FX)[0]);

    assert.deepStrictEqual(
      list.nuggets.map((nugget) => [
        nugget.system,
        nugget.count,
        nugget.offset,
        nugget.initialDelay.low,
      ]),
      [
        ['TestSparks', 1, [0, 0, 10], 100],
        ['TestFlat', 2, [0, 0, 0], 0],
      ],
    );
    assert.deepStrictEqual(list.sounds, [
      { name: 'SomeSound', module: 1, initialDelay: { low: 0, high: 0 } },
    ]);
    assert.deepStrictEqual(list.effects, []);
  });

  test('an FX list reads its other nuggets as effects, approximated or listed', () => {
    const list = readFxList(
      definitionsOf(`
FXList FX_Mixed
  LightPulse
    Color = R:255 G:128 B:0
    Radius = 80
    IncreaseTime = 100
    DecreaseTime = 400
    InitialDelay = 200
  End
  ViewShake
    Type = STRONG
  End
  CameraShakerVolume
    Radius = 100
    Duration_Seconds = 2
    Amplitude_Degrees = 3
  End
  TerrainScorch
    Type = RANDOM
    Radius = 25
  End
  FXListAtBonePos
    FX = FX_Inner
    BoneName = MUZZLE
  End
  BuffNugget
    BuffType = FIRE
  End
End
`)[0],
    );

    assert.deepStrictEqual(
      list.effects.map((effect) => [
        effect.slot,
        effect.approximation?.type,
        effect.initialDelay.low,
      ]),
      [
        ['LightPulse', 'flash', 200],
        ['ViewShake', 'shake', 0],
        ['CameraShakerVolume', 'shake', 0],
        ['TerrainScorch', 'scorch', 0],
        ['FXListAtBonePos', undefined, 0],
        ['BuffNugget', undefined, 0],
      ],
    );
    assert.deepStrictEqual(list.effects[0].approximation, {
      type: 'flash',
      color: [1, 128 / 255, 0],
      rise: 100,
      fall: 400,
    });
    assert.deepStrictEqual(list.effects[2].approximation, {
      type: 'shake',
      seconds: 2,
      degrees: 3,
    });
    assert.strictEqual(list.effects[4].detail, 'FX FX_Inner, BoneName MUZZLE');
  });

  test('approximated effects show only between their delay and their end', () => {
    const [flash, shake, scorch] = readFxList(
      definitionsOf(`
FXList FX_Timed
  LightPulse
    Color = R:0 G:0 B:255
    IncreaseTime = 100
    DecreaseTime = 100
    InitialDelay = 1000
  End
  ViewShake
    Type = NORMAL
    InitialDelay = 1000
  End
  TerrainScorch
    Radius = 30
    InitialDelay = 1000
  End
End
`)[0],
    ).effects.map((effect) => [effect]);
    const effects = [flash[0], shake[0], scorch[0]];

    assert.deepStrictEqual(getEffectStateAt(effects, 29, 30), {
      shake: 0,
      scorches: [],
    });

    // 1100 ms: the flash is at its peak, the shake and the scorch have begun
    const peak = getEffectStateAt(effects, 33, 30);

    assert.deepStrictEqual(peak.flash?.color, [0, 0, 1]);
    assert.ok(peak.flash!.alpha > 0.4);
    assert.notStrictEqual(peak.shake, 0);
    assert.deepStrictEqual(peak.scorches, [30]);

    // 3000 ms: flash and shake are over, the scorch stays
    assert.deepStrictEqual(getEffectStateAt(effects, 90, 30), {
      shake: 0,
      scorches: [30],
    });
    assert.deepStrictEqual(getEffectStateAt(effects, 33, 30), peak);
  });

  test('a light pulse that writes no times still fades out', () => {
    const [pulse] = readFxList(
      definitionsOf(`
FXList FX_Pulse
  LightPulse
    Color = R:255 G:255 B:255
  End
End
`)[0],
    ).effects;

    assert.deepStrictEqual(pulse.approximation, {
      type: 'flash',
      color: [1, 1, 1],
      rise: 0,
      fall: 300,
    });
    assert.ok(getEffectStateAt([pulse], 0, 30).flash);
    assert.strictEqual(getEffectStateAt([pulse], 15, 30).flash, undefined);
  });

  test('slider values are written back over the tokens they came from', () => {
    const [sparks] = definitionsOf(BLOCK);
    const fields = findNumericFields(sparks);
    const red = fields.find(
      (field) => field.keyword === 'Color1' && field.part === 'R',
    )!;
    const size = fields.find(
      (field) => field.keyword === 'Size' && field.part === 'max',
    )!;
    const edits = computeValueEdits(
      sparks,
      new Map([
        [red.id, 128.4],
        [size.id, 7.25],
      ]),
    );
    const text = applyValueEdits(BLOCK, edits);

    assert.match(text, /Color1 = R:128 G:0 B:0 0/);
    assert.match(text, /Size = 3 7\.25/);
    assert.strictEqual(readParticleDef(definitionsOf(text)[0]).size.high, 7.25);
  });
});

suite('Particle simulation', () => {
  const [sparksText, slaveText] = definitionsOf(BLOCK);
  const sparks = readParticleDef(sparksText);
  const slave = readParticleDef(slaveText);

  test('bursts on its delay, keys alpha by snapping and dies on time', () => {
    const world = worldOf(sparks, slave);
    const id = world.spawn('TestSparks', [0, 0, 0])!;
    const system = () => world.find(id)!;

    world.step();
    assert.strictEqual(system().particles.length, 2);
    // The slave gets one particle for each of its master's
    assert.strictEqual(world.find(system().slave)!.particles.length, 2);

    for (let frame = 1; frame < 5; frame++) {
      world.step();
    }
    assert.strictEqual(system().particles.length, 2);
    world.step();
    assert.strictEqual(system().particles.length, 4);

    const oldest = system().particles[0];

    // Alpha reached its frame-5 key and was snapped to it
    assert.strictEqual(oldest.age, 6);
    assert.ok(Math.abs(oldest.alpha - 0.8) < 1e-9);
    // Colour runs from red toward blue over ten frames, not snapped
    assert.ok(Math.abs(oldest.color[0] - 0.4) < 1e-9);
    // Size grows by a rate halved every frame
    assert.ok(Math.abs(oldest.size - oldest.previousSize - 1 / 32) < 1e-9);

    for (let frame = 0; frame < 4; frame++) {
      world.step();
    }
    assert.ok(system().particles.every((particle) => particle.age < 10));
  });
});
