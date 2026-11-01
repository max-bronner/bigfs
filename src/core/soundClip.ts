/**
 * What a page and the extension exchange to play a sound in the page itself:
 * the page asks for a name, the extension answers with the playable bytes.
 * The bytes travel as base64, since a message goes through JSON and a Node
 * Buffer would arrive as a plain object.
 */

/** A page's press of a play button, or a movie's request for a sound */
export interface PlaySoundRequest {
  kind: 'playSound';
  /** An audio event or a sound file name */
  name: string;
  /** Echoed in the reply, so a reply that arrives late can be told from the current one */
  id?: number;
  /** Open the file in an editor instead of playing it; set by Ctrl or Cmd with the click */
  open?: boolean;
}

/** A sound ready for the Web Audio decoder */
export interface SoundClip {
  /** The file that plays */
  file: string;
  mime: string;
  /** The file's bytes, base64: a PCM WAV or an MP3 */
  data: string;
}

/** The extension's answer to a `PlaySoundRequest` that was not an open */
export interface SoundReply {
  kind: 'sound';
  name: string;
  id?: number;
  /** The sound, or nothing when the name resolves to no file */
  clip?: SoundClip;
  /** Why nothing plays */
  error?: string;
}
