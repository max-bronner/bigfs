import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../language/model/sageIniSchema';
import { parseSageIni } from '../../language/model/sageIniParser';
import {
  findAssetReferences,
  missingAssetMessage,
  suggestedAssetNames,
} from '../../language/model/sageIniAssets';

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
  'Object TestUnit',
  '  Draw = W3DScriptedModelDraw ModuleTag_Draw',
  '    DefaultModelConditionState',
  '      Model = TUBody_SKN',
  '    End',
  '    IdleAnimationState',
  '      Animation = Idle',
  '        AnimationName = TUBody_SKL.TUBody_IDLA',
  '      End',
  '    End',
  '  End',
  'End',
  'Object TestTree',
  '  Draw = W3DTreeDraw ModuleTag_Tree',
  '    ModelName = TTree01',
  '  End',
  'End',
  'MappedImage TestIcon',
  '  Texture = TUIcons.tga',
  'End',
  'AudioEvent TestVoice',
  '  Sounds = tuvoia tuvoib:2000',
  'End',
  'MusicTrack TestMusic',
  '  Filename = "Music\\theme.mp3"',
  'End',
  'Object NoModel',
  '  Draw = W3DScriptedModelDraw ModuleTag_Draw',
  '    DefaultModelConditionState',
  '      Model = NONE',
  '    End',
  '  End',
  'End',
];

suite('INI asset references', () => {
  test('models, animations, textures and sounds give their file names', () => {
    const references = findAssetReferences(parseSageIni(TEXT, schema));

    assert.deepStrictEqual(
      references.map((reference) => [
        reference.kind,
        reference.name,
        reference.line,
        reference.candidates,
      ]),
      [
        ['model', 'TUBody_SKN', 3, ['tubody_skn.w3d']],
        ['animation', 'TUBody_SKL.TUBody_IDLA', 7, ['tubody_idla.w3d']],
        ['model', 'TTree01', 14, ['ttree01.w3d']],
        [
          'texture',
          'TUIcons.tga',
          18,
          ['tuicons.dds', 'tuicons.tga', 'tuicons.jpg', 'tuicons.png'],
        ],
        ['sound', 'tuvoia', 21, ['tuvoia.wav', 'tuvoia.mp3']],
        ['sound', 'tuvoib', 21, ['tuvoib.wav', 'tuvoib.mp3']],
        ['sound', 'Music\\theme.mp3', 24, ['theme.mp3']],
      ],
    );
  });

  test('a missing-asset message carries its suggestions for the quick fix', () => {
    const [reference] = findAssetReferences(parseSageIni(TEXT, schema));
    const message = missingAssetMessage(reference, ['tubody_skm']);

    assert.strictEqual(
      message,
      "Model 'TUBody_SKN' has no tubody_skn.w3d in any archive or folder; did you mean 'tubody_skm'?",
    );
    assert.deepStrictEqual(suggestedAssetNames(message), ['tubody_skm']);
  });
});
