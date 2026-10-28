import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createSageIniSchema } from '../../formats/ini/sageIniSchema';
import { parseSageIni } from '../../formats/ini/sageIniParser';
import {
  audioDefinitionOf,
  resolveAudio,
  stripAudioPrefix,
} from '../../game/audio/sageAudioResolve';
import type { AudioLookup } from '../../game/audio/sageAudioResolve';

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
  'AudioEvent Gun',
  '  Sounds = shot1 shot2:2000',
  '  Attack = windup',
  '  Decay = tail:5',
  'End',
  'AudioEvent Leaf',
  '  Sounds = leaf1',
  'End',
  'Multisound Both',
  '  Control = PLAY_ONE',
  '  Subsounds = Gun:10 Leaf',
  'End',
  'Multisound Echo',
  '  Subsounds = Echo Leaf',
  'End',
  'Multisound Ping',
  '  Subsounds = Pong',
  'End',
  'Multisound Pong',
  '  Subsounds = Ping Leaf',
  'End',
  'Multisound Deep0',
  '  Subsounds = Deep1',
  'End',
  'Multisound Deep1',
  '  Subsounds = Deep2',
  'End',
  'Multisound Deep2',
  '  Subsounds = Deep3',
  'End',
  'Multisound Deep3',
  '  Subsounds = Deep4',
  'End',
  'Multisound Deep4',
  '  Subsounds = Deep5',
  'End',
  'Multisound Deep5',
  '  Subsounds = Leaf',
  'End',
  'DialogEvent Talk',
  '  Filename = "Speech\\talk01.wav"',
  'End',
  'NewEvaEvent Alert',
  '  Priority = 3',
  '  SideSound',
  '    Side = North',
  '    Sound = Gun',
  '  End',
  '  SideSound',
  '    Side = South',
  '    Sound = Both',
  '  End',
  '  SideSound',
  '    Side = Empty',
  '  End',
  'End',
  'Video Intro',
  '  Filename = Movies\\intro_cut.vp6',
  'End',
  'AudioEvent intro_cut',
  '  Sounds = intro_voice',
  'End',
  'AudioEvent intro_cut_Music',
  '  Sounds = intro_score',
  'End',
  'Video Silent',
  '  Filename = silent',
  'End',
];

const parsed = parseSageIni(TEXT, schema);
const lookup: AudioLookup = (name) => {
  const block = parsed.blocks.find(
    (each) => each.name?.toLowerCase() === name.toLowerCase(),
  );

  return block && audioDefinitionOf(parsed, block);
};

const files = async (name: string) =>
  (await resolveAudio(name, lookup)).map((variant) => variant.file);

suite('sageAudioResolve', () => {
  test('an audio event labels Sounds, Attack and Decay and keeps weights', async () => {
    assert.deepStrictEqual(await resolveAudio('Gun', lookup), [
      { label: 'Sounds', file: 'shot1' },
      { label: 'Sounds', file: 'shot2', weight: 2000 },
      { label: 'Attack', file: 'windup' },
      { label: 'Decay', file: 'tail', weight: 5 },
    ]);
  });

  test('a streamed definition names its Filename', async () => {
    assert.deepStrictEqual(await resolveAudio('Talk', lookup), [
      { label: 'Filename', file: 'Speech\\talk01.wav' },
    ]);
  });

  test('a Multisound resolves each subsound without its weight', async () => {
    const variants = await resolveAudio('Both', lookup);

    assert.deepStrictEqual(
      variants.map((variant) => variant.label),
      [
        'Gun › Sounds',
        'Gun › Sounds',
        'Gun › Attack',
        'Gun › Decay',
        'Leaf › Sounds',
      ],
    );
  });

  test('a Multisound containing itself terminates', async () => {
    assert.deepStrictEqual(await files('Echo'), ['leaf1']);
    assert.deepStrictEqual(await files('Ping'), ['leaf1']);
  });

  test('nesting is followed four Multisounds deep and no further', async () => {
    // Four Multisounds are opened, as the runtime does: Deep2 reaches the
    // event under Deep5, Deep1 would need a fifth level
    assert.deepStrictEqual(await files('Deep2'), ['leaf1']);
    assert.deepStrictEqual(await files('Deep1'), []);
  });

  test('an EVA event labels each side and follows its sound', async () => {
    const variants = await resolveAudio('EVA:Alert', lookup);

    assert.strictEqual(variants[0].label, 'North › Sounds');
    assert.strictEqual(variants[0].file, 'shot1');
    assert.ok(variants.some((each) => each.label === 'South › Leaf › Sounds'));
    assert.ok(!variants.some((each) => each.label.startsWith('Empty')));
  });

  test('a video plays its music event then its own, by file stem', async () => {
    assert.deepStrictEqual(await files('Intro'), [
      'intro_score',
      'intro_voice',
    ]);
    assert.deepStrictEqual(await files('Silent'), []);
  });

  test('lookup prefixes are stripped and unknown names resolve to nothing', async () => {
    assert.strictEqual(stripAudioPrefix('+SOUND:eva:Leaf'), 'Leaf');
    assert.deepStrictEqual(await files('+SOUND:Leaf'), ['leaf1']);
    assert.deepStrictEqual(await files('Nothing'), []);
  });
});
