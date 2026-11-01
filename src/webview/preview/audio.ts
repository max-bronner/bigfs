import type { AudioMessage } from './protocol';

/**
 * Sound files opened on purpose: the page shows the facts and an audio
 * element with controls, and never starts it.
 */

const addFact = (list: HTMLElement, term: string, value: string) => {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');

  dt.textContent = term;
  dd.textContent = value;
  list.append(dt, dd);
};

/** Shows a decoded sound's facts and a paused player for its WAV bytes */
export const showAudio = (main: HTMLElement, { wav, info }: AudioMessage) => {
  const list = document.createElement('dl');
  const audio = document.createElement('audio');

  addFact(list, 'Codec', info.format);
  addFact(list, 'Channels', String(info.channels));
  addFact(list, 'Sample rate', `${info.sampleRate} Hz`);
  addFact(list, 'Bits per sample', String(info.bitsPerSample));
  addFact(list, 'Duration', `${info.durationSeconds.toFixed(2)} s`);
  audio.controls = true;
  audio.src = URL.createObjectURL(
    new Blob([wav as BlobPart], { type: 'audio/wav' }),
  );
  main.replaceChildren(list, audio);
};
