import { spawn } from 'child_process';
import path from 'path';

/**
 * FFmpeg, when the user has it: probing a video's size and rate, and
 * reading its frames as raw RGBA through a pipe, a bounded number at a time.
 */

/** Runs a program to its end, returning its output and status */
export const run = (
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });

/** Size and frame rate as FFmpeg reports them for the first video stream */
export const probe = async (
  ffmpeg: string,
  file: string,
): Promise<{ width: number; height: number; fps: number }> => {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', file]);
  const stream = /Stream #[^\n]*Video:[^\n]*/.exec(stderr)?.[0] ?? '';
  const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(stream);
  const fps = /([\d.]+) (?:fps|tbr)/.exec(stream);

  if (!size) {
    throw new Error(`FFmpeg found no video stream in ${path.basename(file)}`);
  }
  return {
    width: Number(size[1]),
    height: Number(size[2]),
    fps: fps ? Number(fps[1]) : 30,
  };
};

/** Frames from FFmpeg, as raw RGBA at the size and rate asked for */
export const ffmpegSource = (
  ffmpeg: string,
  file: string,
  width: number,
  height: number,
  fps: number,
): { next: () => Promise<Uint8Array | undefined>; stop: () => void } => {
  const frameSize = width * height * 4;
  const child = spawn(ffmpeg, [
    '-v',
    'error',
    '-i',
    file,
    '-vf',
    `scale=${width}:${height}:flags=bicubic,fps=${fps}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    'pipe:1',
  ]);
  const chunks: Buffer[] = [];
  let buffered = 0;
  let ended = false;
  let failure = '';
  let waiting: (() => void) | undefined;

  child.stderr.on('data', (data: Buffer) => (failure += data.toString()));
  child.stdout.on('data', (data: Buffer) => {
    chunks.push(data);
    buffered += data.length;
    // Bounded: stop reading once two frames are waiting
    if (buffered >= frameSize * 2) {
      child.stdout.pause();
    }
    waiting?.();
  });
  child.stdout.on('end', () => {
    ended = true;
    waiting?.();
  });
  child.once('error', (error) => {
    failure ||= error.message;
    ended = true;
    waiting?.();
  });

  return {
    next: async () => {
      while (buffered < frameSize && !ended) {
        child.stdout.resume();
        await new Promise<void>((resolve) => (waiting = resolve));
        waiting = undefined;
      }
      if (buffered < frameSize) {
        if (failure.trim() && !buffered) {
          throw new Error(`FFmpeg: ${failure.trim().split('\n').pop()}`);
        }
        return undefined;
      }

      const all = Buffer.concat(chunks);
      const frame = new Uint8Array(all.subarray(0, frameSize));

      chunks.length = 0;
      chunks.push(all.subarray(frameSize));
      buffered = all.length - frameSize;
      child.stdout.resume();
      return frame;
    },
    stop: () => child.kill(),
  };
};
