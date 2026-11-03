import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ROOT_CONTEXT,
  createSageIniSchema,
} from '../../formats/ini/sageIniSchema';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import { findSageIniProblems } from '../../formats/ini/sageIniProblems';
import { resolveSageSymbol } from '../../formats/ini/sageIniSymbol';
import {
  AUDIO_NAMESPACES,
  EVA_NAMESPACES,
  getAudioReferenceKind,
} from '../../formats/ini/sageAudioFields';
import {
  findAudioNames,
  isAudioSentinel,
  findReferencedNames,
} from '../../formats/ini/sageAudioValues';

const schema = createSageIniSchema(
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'assets', 'sageIniSchema.json'),
      'utf8',
    ),
  ),
);

/** Invented names throughout: nothing here is from a retail file */
const FIXTURE = [
  'AudioEvent TestVoiceSelect',
  '  Sounds = tvsel_a tvsel_b:2000',
  '  Attack = tvsel_c',
  '  Decay = tvsel_d',
  'End',
  'AudioEvent TestVoiceMove',
  'End',
  'DialogEvent TestSpeech',
  '  Filename = TestSpeech01.mp3',
  'End',
  'MusicTrack TestTrack',
  'End',
  'AmbientStream TestAmbience',
  'End',
  'StreamedSound TestRainLoop',
  'End',
  'Multisound TestVoiceSelectMS',
  '  Subsounds = TestVoiceSelect TestVoiceMove:2000',
  'End',
  'NewEvaEvent TestUnitReady',
  '  SideSound',
  '    Side = Men',
  '    Sound = TestSpeech',
  '  End',
  'End',
  'MiscAudio',
  '  NoCanDoSound = TestVoiceMove',
  '  RallyPointSet = NoSound',
  'End',
  'Object TestUnit',
  '  VoiceSelect = TestVoiceSelectMS',
  '  VoiceCreated = EVA:TestUnitReady',
  '  VoiceCreated = +SOUND:TestVoiceMove',
  '  VoiceMove = TestVoiceMove',
  '  SoundAmbient = TestAmbience',
  '  SoundStealthOn = NoSound',
  '  EvaEventDieOwner = TestUnitReady',
  '  UnitSpecificSounds',
  '    VoiceGarrison = TestVoiceMove',
  '    VoiceMadeUpKey = EVA:TestUnitReady',
  '  End',
  '  ClientBehavior = AnimationSoundClientBehavior ModuleTag_A',
  '    AnimationSound = Sound:TestVoiceMove Animation:TUBody_SKL.TUBody_ATKA Frames:3',
  '    AnimationSound = Sound: TestVoiceSelect Animation: X.Y Frames: 5 9',
  '  End',
  '  ClientBehavior = ModelConditionAudioLoopClientBehavior ModuleTag_L',
  '    ModelCondition = Required:RUBBLE Sound:TestVoiceMove',
  '  End',
  '  Behavior = GateOpenAndCloseBehavior ModuleTag_G',
  '    SoundOpeningGateLoop = TestVoiceMove',
  '  End',
  'End',
  'FXList TestFx',
  '  Sound',
  '    Name = TestVoiceSelectMS',
  '  End',
  'End',
  'WeatherData',
  '  WeatherSound = TestRainLoop',
  'End',
];

const parsed = parseSageIni(FIXTURE, schema);

/** Every name the document's reference fields write, with the field and text */
const listUses = () =>
  parsed.statements
    .filter((statement) => !statement.block)
    .flatMap((statement) =>
      findReferencedNames(statement, schema).map((reference) => ({
        line: statement.line,
        field: statement.keyword.text,
        reference,
      })),
    );

suite('SAGE INI audio references', () => {
  test('the fixture parses without a problem', () => {
    assert.deepStrictEqual(
      findSageIniProblems(parsed, schema).map(
        ({ line, message }) => `${line}: ${message}`,
      ),
      [],
    );
  });

  test('every sound name in the fixture is defined, and no Filename is a reference', () => {
    const declared = new Set(
      parsed.statements
        .filter(
          (statement) => statement.block && statement.context === ROOT_CONTEXT,
        )
        .map((statement) => statement.values[0]?.text.toLowerCase()),
    );
    const unknown = listUses().filter(
      ({ reference }) =>
        !declared.has(reference.name.toLowerCase()) &&
        !isAudioSentinel(reference.name),
    );

    assert.deepStrictEqual(
      unknown.map(({ field, reference }) => `${field}: ${reference.name}`),
      [],
    );
    assert.ok(listUses().every(({ field }) => field.toLowerCase() !== 'filename'));
  });

  test('a use of one sound is found in each of its eight spellings', () => {
    const found = listUses().filter(
      ({ reference }) => reference.name === 'TestVoiceMove',
    );

    assert.deepStrictEqual(
      found.map(({ field }) => field),
      [
        'Subsounds',
        'NoCanDoSound',
        'VoiceCreated',
        'VoiceMove',
        'VoiceGarrison',
        'AnimationSound',
        'ModelCondition',
        'SoundOpeningGateLoop',
      ],
    );
  });

  test('an announcer name excludes its EVA: prefix and sits in announcer namespaces', () => {
    const line = FIXTURE.indexOf('  VoiceCreated = EVA:TestUnitReady');
    const [reference] = findAudioNames(
      parsed.statements.find((statement) => statement.line === line)!,
      'audio',
    );

    assert.strictEqual(
      FIXTURE[line].slice(reference.start, reference.end),
      'TestUnitReady',
    );
    assert.deepStrictEqual(reference.namespaces, EVA_NAMESPACES);
  });

  test('the symbol under a prefixed or weighted name is the name alone', () => {
    const plus = FIXTURE.indexOf('  VoiceCreated = +SOUND:TestVoiceMove');
    const weighted = FIXTURE.indexOf(
      '  Subsounds = TestVoiceSelect TestVoiceMove:2000',
    );
    const onPlus = resolveSageSymbol(
      parsed,
      schema,
      plus,
      FIXTURE[plus].indexOf('TestVoiceMove') + 2,
    );
    const onWeight = resolveSageSymbol(
      parsed,
      schema,
      weighted,
      FIXTURE[weighted].indexOf('TestVoiceMove') + 3,
    );

    assert.strictEqual(onPlus?.name, 'TestVoiceMove');
    assert.deepStrictEqual(onPlus?.namespaces, AUDIO_NAMESPACES);
    assert.strictEqual(onWeight?.name, 'TestVoiceMove');
    assert.strictEqual(
      FIXTURE[weighted].slice(onWeight!.token.start, onWeight!.token.end),
      'TestVoiceMove',
    );
  });

  test('keyed sounds take only the Sound: key, whichever way it is spaced', () => {
    const line = FIXTURE.findIndex((text) =>
      text.includes('Sound: TestVoiceSelect'),
    );
    const statement = parsed.statements.find(
      (candidate) => candidate.line === line,
    )!;

    assert.deepStrictEqual(
      findAudioNames(statement, 'audio').map(({ name }) => name),
      ['TestVoiceSelect'],
    );
  });

  test('field kinds follow the last context segment and the field', () => {
    assert.strictEqual(getAudioReferenceKind('Object', 'VoiceSelect'), 'audio');
    assert.strictEqual(getAudioReferenceKind('Object', 'EvaEventDieOwner'), 'eva');
    assert.strictEqual(
      getAudioReferenceKind('Object', 'EvaEventSecondDamageFarFromFirstScanRange'),
      undefined,
    );
    assert.strictEqual(
      getAudioReferenceKind('Object', 'VoicePriority'),
      undefined,
    );
    assert.strictEqual(
      getAudioReferenceKind('AmbientStream', 'Filename'),
      undefined,
    );
    assert.strictEqual(getAudioReferenceKind('FXList > Sound', 'Name'), 'audio');
    assert.strictEqual(
      getAudioReferenceKind('FXList > ParticleSystem', 'Name'),
      undefined,
    );
    assert.strictEqual(
      getAudioReferenceKind('Object > UnitSpecificSounds', 'AnyKey'),
      'audio',
    );
    assert.strictEqual(
      getAudioReferenceKind('Object', 'UnitSpecificSoundToUseAsVoiceMove'),
      undefined,
    );
  });

  test('a ship death names its sound as the second token only', () => {
    const [name, ...rest] = findAudioNames(
      {
        keyword: { text: 'Sound', start: 0, end: 5 },
        values: [
          { text: 'INITIAL', start: 8, end: 15 },
          { text: 'ShipBoom', start: 16, end: 24 },
        ],
      },
      'audio',
      'ShipSlowDeathBehavior',
    );

    assert.strictEqual(name.name, 'ShipBoom');
    assert.strictEqual(rest.length, 0);
  });
});
