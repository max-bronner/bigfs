/**
 * Which parameters of a map script call name a sound. A script's parameters
 * are stored with an engine type ordinal that is not the same across the
 * titles, so the call's own name decides, as mint's script audio verbs read
 * them (`crates/games/rotwk/src/rules/map_scripts/audio.rs`,
 * `docs/design/audio/script-audio.md`): the first parameter of every verb
 * that plays, queues or gates on an audio event, a speech line or a music
 * track names it in the INI audio namespace.
 *
 * This file knows nothing of the editor, so it runs in the unit tests.
 */

/** Verbs and conditions whose first parameter is an audio event name */
const SOUND_FIRST_PARAMETER: ReadonlySet<string> = new Set([
  'play_sound_effect',
  'play_sound_effect_at',
  'play_sound_effect_at_team',
  'sound_play_named',
  'speech_play',
  'music_play_track_finite_times',
  'music_play_track_finite_times_and_notify',
  'audio_push_music',
  'audio_make_sound_immune_to_fade',
  'audio_make_sound_subject_to_fade',
  'sound_disable_type',
  'sound_enable_type',
  'has_finished_audio',
]);

/** The call names compared as the table spells them, ignoring case */
const normal = (name: string) => name.toLowerCase();

/** The indexes of the parameters of a call that name a sound */
export const soundParameterIndexes = (
  name: string,
  parameters: readonly string[],
): number[] =>
  SOUND_FIRST_PARAMETER.has(normal(name)) && parameters[0]?.trim() ? [0] : [];

/** A call with the indexes of its sound parameters, for the page to draw */
export const withSoundParameters = <
  T extends { name: string; parameters: string[] },
>(
  call: T,
): T & { sounds: number[] } => ({
  ...call,
  sounds: soundParameterIndexes(call.name, call.parameters),
});
