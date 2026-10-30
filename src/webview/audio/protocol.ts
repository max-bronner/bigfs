/** Message asking the sound player to play one file; sent only after a user's click */
export interface PlayMessage {
  kind: 'play';
  name: string;
  mime: string;
  /** The file's bytes, base64 */
  data: string;
}

/** Messages the extension sends to the sound player's page */
export type ToSoundPage = PlayMessage;

/** Messages the sound player's page sends to the extension */
export type FromSoundPage = { kind: 'ready' };
