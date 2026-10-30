import type { FromPreviewPage, VideoMessage } from './protocol';

/** Plays a VP6 movie: the extension decodes, the page asks frame by frame */

interface Movie {
  info: VideoMessage;
  frame: number;
  playing: boolean;
  pending: boolean;
  last: number;
  show(index: number, pixels: Uint8Array): void;
}

/** Controls the preview page's message handler drives a movie through */
export interface MovieControl {
  /** Draws a decoded frame and, while playing, asks for the next one on time */
  show(index: number, pixels: Uint8Array): void;
  /** Reports that the asked-for frame could not be decoded, so the next one may be asked for */
  reportFrameError(): void;
}

/** Shows a VP6 movie's player and asks for its first frame */
export const showMovie = (
  main: HTMLElement,
  info: VideoMessage,
  post: (message: FromPreviewPage) => void,
): MovieControl => {
  const canvas = document.createElement('canvas');

  canvas.width = info.width;
  canvas.height = info.height;
  canvas.className = `video${info.hasAlpha ? ' checker' : ''}`;

  const bar = document.createElement('div');
  const play = document.createElement('button');
  const slider = document.createElement('input');
  const label = document.createElement('span');

  bar.className = 'controls';
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(Math.max(0, info.frameCount - 1));
  label.className = 'status';
  bar.append(play, slider, label);

  const facts = document.createElement('p');

  facts.textContent = `${info.width} × ${info.height} · ${info.frameCount} frames · ${info.framesPerSecond.toFixed(2)} fps${info.hasAlpha ? ' · with alpha' : ''} · no sound: EA movies keep it in a separate file`;
  main.replaceChildren(bar, canvas, facts);

  const context = canvas.getContext('2d')!;
  const movie: Movie = {
    info,
    frame: 0,
    playing: true,
    pending: false,
    last: 0,
    show: () => {},
  };
  const request = (index: number) => {
    if (movie.pending) {
      return;
    }

    movie.pending = true;
    post({ kind: 'videoFrame', index });
  };
  const update = () => {
    play.textContent = movie.playing ? 'Pause' : 'Play';
    slider.value = String(movie.frame);
    label.textContent = `frame ${movie.frame + 1} / ${info.frameCount}`;
  };

  play.onclick = () => {
    movie.playing = !movie.playing;

    if (movie.playing && movie.frame >= info.frameCount - 1) {
      movie.frame = -1;
    }

    update();

    if (movie.playing) {
      request(movie.frame + 1);
    }
  };
  slider.oninput = () => {
    movie.playing = false;
    update();
    request(Number(slider.value));
  };
  movie.show = (index, pixels) => {
    movie.pending = false;
    movie.frame = index;
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(
          pixels.buffer as ArrayBuffer,
          pixels.byteOffset,
          pixels.byteLength,
        ),
        info.width,
        info.height,
      ),
      0,
      0,
    );
    update();

    if (movie.playing && index < info.frameCount - 1) {
      const wait = Math.max(
        0,
        1000 / info.framesPerSecond - (performance.now() - movie.last),
      );

      setTimeout(() => {
        movie.last = performance.now();
        request(index + 1);
      }, wait);
    } else if (index >= info.frameCount - 1) {
      movie.playing = false;
      update();
    }
  };
  update();
  request(0);

  return {
    show: (index, pixels) => movie.show(index, pixels),
    reportFrameError: () => {
      movie.pending = false;
    },
  };
};
