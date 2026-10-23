import type { Tool } from './toolRegistry';

/**
 * Turns a `.wav` entry into something a webview's audio element can play.
 *
 * The games ship two codecs inside RIFF/WAVE: plain PCM, which plays as it
 * is, and Microsoft IMA ADPCM, which no browser decodes. An ADPCM file is
 * decoded here into 16-bit PCM and wrapped in a new WAV header. Every size in
 * the file is clamped to the bytes present, so a header that claims more data
 * than the file holds plays what is there.
 */

/** What a preview shows about a sound beside the player */
export interface AudioInfo {
  /** The codec as stored: `PCM` or `IMA ADPCM` */
  format: string;
  channels: number;
  sampleRate: number;
  /** Bits per sample as stored; ADPCM stores 4 */
  bitsPerSample: number;
  durationSeconds: number;
}

/** A sound ready for an audio element */
export interface PlayableAudio {
  /** A WAV file of PCM samples, or the original bytes when already PCM */
  wav: Uint8Array;
  info: AudioInfo;
}

const FORMAT_PCM = 1;
const FORMAT_IMA_ADPCM = 17;

/** Step sizes of IMA ADPCM, indexed by the step index */
const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];

/** How each nibble moves the step index */
const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8];

interface WaveFormat {
  tag: number;
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bitsPerSample: number;
}

/** Finds the `fmt ` and `data` chunks, clamping each to the bytes present */
const readChunks = (
  bytes: Uint8Array,
): { format: WaveFormat; data: Uint8Array } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));

  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }

  let format: WaveFormat | undefined;
  let data: Uint8Array | undefined;
  let cursor = 12;

  while (cursor + 8 <= bytes.length) {
    const id = tag(cursor);
    const size = view.getUint32(cursor + 4, true);
    const start = cursor + 8;
    const end = Math.min(start + size, bytes.length);

    if (id === 'fmt ' && end - start >= 16) {
      format = {
        tag: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        blockAlign: view.getUint16(start + 12, true),
        bitsPerSample: view.getUint16(start + 14, true),
      };
    } else if (id === 'data') {
      data = bytes.subarray(start, end);
    }

    // Chunks are padded to an even length
    cursor = start + size + (size & 1);
  }

  if (!format || !data) {
    throw new Error('WAVE file without a fmt or data chunk');
  }

  if (!format.channels || !format.sampleRate) {
    throw new Error('WAVE format with no channels or no sample rate');
  }

  return { format, data };
};

/** Decodes Microsoft IMA ADPCM blocks into interleaved 16-bit samples */
const decodeImaAdpcm = (data: Uint8Array, format: WaveFormat): Int16Array => {
  const { channels, blockAlign } = format;
  const headerBytes = 4 * channels;

  if (blockAlign <= headerBytes || format.bitsPerSample !== 4) {
    throw new Error('IMA ADPCM block layout this decoder does not read');
  }

  const samplesPerBlock = ((blockAlign - headerBytes) * 2) / channels + 1;
  const blocks = Math.floor(data.length / blockAlign);
  const samples = new Int16Array(blocks * samplesPerBlock * channels);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let block = 0; block < blocks; block++) {
    const base = block * blockAlign;
    const outBase = block * samplesPerBlock * channels;

    for (let channel = 0; channel < channels; channel++) {
      let predictor = view.getInt16(base + channel * 4, true);
      let index = Math.min(88, Math.max(0, data[base + channel * 4 + 2]));

      samples[outBase + channel] = predictor;

      // Each channel's nibbles come in groups of four bytes, eight samples,
      // interleaved channel by channel, low nibble first
      for (let sample = 1; sample < samplesPerBlock; sample++) {
        const position = sample - 1;
        const group = Math.floor(position / 8);
        const within = position % 8;
        const byte =
          data[
            base +
              headerBytes +
              (group * channels + channel) * 4 +
              (within >> 1)
          ];
        const nibble = within & 1 ? byte >> 4 : byte & 15;
        const step = STEP_TABLE[index];
        let delta = step >> 3;

        if (nibble & 4) {
          delta += step;
        }
        if (nibble & 2) {
          delta += step >> 1;
        }
        if (nibble & 1) {
          delta += step >> 2;
        }

        predictor += nibble & 8 ? -delta : delta;
        predictor = Math.max(-32768, Math.min(32767, predictor));
        index = Math.max(0, Math.min(88, index + INDEX_TABLE[nibble & 7]));

        samples[outBase + sample * channels + channel] = predictor;
      }
    }
  }

  return samples;
};

/** Wraps 16-bit samples in a WAV header */
const encodePcmWav = (
  samples: Int16Array,
  channels: number,
  sampleRate: number,
): Uint8Array => {
  const dataBytes = samples.length * 2;
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);
  const writeTag = (at: number, text: string) =>
    wav.set(
      Array.from(text, (c) => c.charCodeAt(0)),
      at,
    );

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) =>
    view.setInt16(44 + index * 2, sample, true),
  );

  return wav;
};

/** Makes a WAV playable in a webview, decoding IMA ADPCM to PCM */
export const toPlayableAudio = (bytes: Uint8Array): PlayableAudio => {
  const { format, data } = readChunks(bytes);
  const { channels, sampleRate, bitsPerSample } = format;

  if (format.tag === FORMAT_PCM) {
    const frameBytes = Math.max(1, (bitsPerSample / 8) * channels);

    return {
      wav: bytes,
      info: {
        format: 'PCM',
        channels,
        sampleRate,
        bitsPerSample,
        durationSeconds: data.length / frameBytes / sampleRate,
      },
    };
  }

  if (format.tag === FORMAT_IMA_ADPCM) {
    const samples = decodeImaAdpcm(data, format);

    return {
      wav: encodePcmWav(samples, channels, sampleRate),
      info: {
        format: 'IMA ADPCM',
        channels,
        sampleRate,
        bitsPerSample,
        durationSeconds: samples.length / channels / sampleRate,
      },
    };
  }

  throw new Error(`WAVE codec ${format.tag} is not supported`);
};

/** Tool that makes a `.wav` entry playable */
export const playableAudioTool: Tool<Uint8Array, PlayableAudio> = {
  id: 'audio.toPlayable',
  run: toPlayableAudio,
};
