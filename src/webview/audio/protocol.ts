/** A sound for the player to play: the user asked for it with a click */
export interface PlayMessage {
  kind: 'play';
  name: string;
  mime: string;
  /** The file's bytes, base64 */
  data: string;
}

export type ToSoundPage = PlayMessage;

export type FromSoundPage = { kind: 'ready' };
