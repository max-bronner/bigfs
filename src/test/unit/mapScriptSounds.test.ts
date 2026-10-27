import * as assert from 'assert';
import {
  soundParameterIndexes,
  withSoundParameters,
} from '../../formats/map/mapScriptSounds';

// Invented event names; only the verbs are the games'
suite('Map script sounds', () => {
  test('the first parameter of a playing verb names the sound', () => {
    for (const verb of [
      'PLAY_SOUND_EFFECT',
      'PLAY_SOUND_EFFECT_AT',
      'PLAY_SOUND_EFFECT_AT_TEAM',
      'SOUND_PLAY_NAMED',
      'SPEECH_PLAY',
      'MUSIC_PLAY_TRACK_FINITE_TIMES',
      'AUDIO_PUSH_MUSIC',
      'HAS_FINISHED_AUDIO',
    ]) {
      assert.deepStrictEqual(
        soundParameterIndexes(verb, ['TestEvent', 'TestWaypoint']),
        [0],
        verb,
      );
    }
  });

  test('the verb is matched without regard to case', () => {
    assert.deepStrictEqual(
      soundParameterIndexes('Play_Sound_Effect', ['TestEvent']),
      [0],
    );
  });

  test('other parameters of the same call are not sounds', () => {
    assert.deepStrictEqual(
      soundParameterIndexes('PLAY_SOUND_EFFECT_AT', ['TestEvent', 'Spot']),
      [0],
    );
  });

  test('calls that do not name a sound have none', () => {
    assert.deepStrictEqual(
      soundParameterIndexes('MUSIC_SET_VOLUME', ['50']),
      [],
    );
    assert.deepStrictEqual(
      soundParameterIndexes('EVA_SET_ENABLED_DISABLED', ['1']),
      [],
    );
    assert.deepStrictEqual(soundParameterIndexes('SET_FLAG', ['Flag']), []);
  });

  test('an empty name has nothing to play', () => {
    assert.deepStrictEqual(soundParameterIndexes('SPEECH_PLAY', ['']), []);
    assert.deepStrictEqual(soundParameterIndexes('SPEECH_PLAY', []), []);
  });

  test('a call keeps its fields and gains the sound indexes', () => {
    assert.deepStrictEqual(
      withSoundParameters({ name: 'SPEECH_PLAY', parameters: ['TestLine', '1'] }),
      { name: 'SPEECH_PLAY', parameters: ['TestLine', '1'], sounds: [0] },
    );
  });
});
