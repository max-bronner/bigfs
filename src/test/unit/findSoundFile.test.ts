import * as assert from 'assert';
import { chooseSoundVariant } from '../../game/audio/chooseSoundVariant';
import { findSoundFile } from '../../game/audio/findSoundFile';
import type {
  AudioDefinition,
  AudioLookup,
} from '../../game/audio/sageAudioResolve';

// Invented names; only the grammar is the games'
const definitions: Record<string, AudioDefinition> = {
  gun: {
    keyword: 'AudioEvent',
    fields: [
      { key: 'Attack', values: ['windup'] },
      { key: 'Sounds', values: ['shot1', 'shot2:2000'] },
      { key: 'Decay', values: ['tail'] },
    ],
    sideSounds: [],
  },
  both: {
    keyword: 'Multisound',
    fields: [{ key: 'Subsounds', values: ['Gun', 'Leaf'] }],
    sideSounds: [],
  },
  leaf: {
    keyword: 'AudioEvent',
    fields: [{ key: 'Sounds', values: ['leaf1'] }],
    sideSounds: [],
  },
};
const lookup: AudioLookup = (name) => definitions[name.toLowerCase()];

suite('findSoundFile', () => {
  test('an event plays its Sounds entry, not its attack', async () => {
    const file = await findSoundFile('Gun', lookup, () => true);

    assert.strictEqual(file, 'shot1.wav');
  });

  test('a multisound plays the Sounds entry of its first subsound', async () => {
    assert.strictEqual(
      await findSoundFile('Both', lookup, () => true),
      'shot1.wav',
    );
  });

  test('the wav is tried before the mp3', async () => {
    const held = new Set(['leaf1.mp3']);

    assert.strictEqual(
      await findSoundFile('Leaf', lookup, (file) => held.has(file)),
      'leaf1.mp3',
    );
  });

  test('a name no event defines is a file name', async () => {
    assert.strictEqual(
      await findSoundFile('Some/Path/Click.WAV', lookup, () => true),
      'click.wav',
    );
  });

  test('nothing held plays nothing', async () => {
    assert.strictEqual(await findSoundFile('Gun', lookup, () => false), undefined);
  });

  test('a variant list without a Sounds role plays its first', () => {
    assert.strictEqual(
      chooseSoundVariant([
        { label: 'Attack', file: 'a' },
        { label: 'Decay', file: 'b' },
      ])?.file,
      'a',
    );
    assert.strictEqual(chooseSoundVariant([]), undefined);
  });
});
