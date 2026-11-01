import type { PlaySoundRequest, SoundReply } from '../../core/soundClip';

/** Messages the extension sends to the sound player's page: a sound to play, unasked or answering a press */
export type ToSoundPage = SoundReply;

/** Messages the sound player's page sends to the extension */
export type FromSoundPage = { kind: 'ready' } | PlaySoundRequest;
