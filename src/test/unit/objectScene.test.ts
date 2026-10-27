import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import { focusAt, readObjectScene } from '../../language/model/objectScene';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

// Invented names; only the grammar is the games'
const TEXT = [
  'Object TestHero',
  '  Draw = W3DHordeModelDraw ModuleTag_Draw',
  '    DefaultModelConditionState',
  '      Model = TH_SKN',
  '      ParticleSysBone = B_TORCH TorchFire FollowBone:Yes',
  '    End',
  '    ModelConditionState = USER_1',
  '      Model = TH_Cloak_SKN',
  '    End',
  '    AnimationState = MOVING',
  '      Animation = Run',
  '        AnimationName = TH_SKL.TH_RUNA',
  '        AnimationMode = LOOP',
  '      End',
  '      EnteringStateFX = FX_Dust',
  '    End',
  '  End',
  '  Behavior = SlowDeathBehavior ModuleTag_Death',
  '    FX = INITIAL FX_Fall',
  '  End',
  'End',
];

suite('Object scene', () => {
  const parsed = parseSageIni(TEXT, schema);
  const scene = readObjectScene(
    parsed,
    schema,
    (name) => name.startsWith('FX_'),
    (name) => name === 'TorchFire',
  )!;

  test('states carry their model, animations, FX and bone systems', () => {
    assert.deepStrictEqual(
      scene.states.map((state) => [
        state.label,
        state.kind,
        state.model,
        state.animations,
        state.fx,
        state.particles,
      ]),
      [
        [
          'DefaultModelConditionState',
          'model',
          'TH_SKN',
          [],
          [],
          [{ bone: 'B_TORCH', system: 'TorchFire' }],
        ],
        ['ModelConditionState = USER_1', 'model', 'TH_Cloak_SKN', [], [], []],
        // On the default model, which the state itself does not name
        [
          'AnimationState = MOVING',
          'animation',
          'TH_SKN',
          ['TH_SKL.TH_RUNA'],
          ['FX_Dust'],
          [],
        ],
      ],
    );
    assert.deepStrictEqual(scene.fx, [{ field: 'FX', name: 'FX_Fall' }]);
  });

  test('a line opens the preview on its state and what it names', () => {
    assert.deepStrictEqual(focusAt(parsed, 11, scene), {
      state: 2,
      animation: 'TH_SKL.TH_RUNA',
    });
    assert.deepStrictEqual(focusAt(parsed, 18, scene), { fx: 'FX_Fall' });
    assert.deepStrictEqual(focusAt(parsed, 4, scene), {
      state: 0,
      system: 'TorchFire',
    });
  });

  test('every voice and sound field is listed once, by the field naming it', () => {
    const voiced = parseSageIni(
      [
        'Object TestHero',
        '  VoiceSelect = TestHeroVoiceSelect',
        '  VoiceMove = TestHeroVoiceMove',
        '  VoiceMove = TestHeroVoiceMove',
        '  VoiceAttack = NONE',
        '  VoicePriority = 5',
        '  SoundOnDamaged = TestHeroHurt',
        '  EvaEventDieOwner = TestHeroLost',
        '  Draw = W3DModelDraw ModuleTag_Draw',
        '    DefaultModelConditionState',
        '      Model = TH_SKN',
        '    End',
        '  End',
        'End',
      ],
      schema,
    );
    const voices = readObjectScene(
      voiced,
      schema,
      () => false,
      () => false,
    )!.voices;

    assert.deepStrictEqual(voices, [
      { field: 'VoiceSelect', name: 'TestHeroVoiceSelect' },
      { field: 'VoiceMove', name: 'TestHeroVoiceMove' },
      { field: 'SoundOnDamaged', name: 'TestHeroHurt' },
      { field: 'EvaEventDieOwner', name: 'TestHeroLost' },
    ]);
  });
});
