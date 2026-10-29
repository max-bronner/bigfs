import { getVsCodeApi } from '../shared/vscodeApi';
import { showAudio, showCompressedAudio } from './audio';
import { showMovie } from './movie';
import type { MovieControl } from './movie';
import type { FromPreviewPage, ToPreviewPage } from './protocol';
import { showModel } from './showModel';
import type { ModelControl } from './showModel';
import { createTexturePage } from './texture';

/**
 * The preview editor's page: a texture on a canvas, a sound with its
 * facts, a VP6 movie frame by frame, or a W3D model in 3D. The extension
 * sends what to show for the file; the page asks for what it needs next.
 */

const vscode = getVsCodeApi<FromPreviewPage>();
const main = document.getElementById('main')!;
const showTexture = createTexturePage(main);
let modelControl: ModelControl | undefined;
let movie: MovieControl | undefined;

window.addEventListener('message', ({ data }: MessageEvent<ToPreviewPage>) => {
  switch (data.kind) {
    case 'model':
      modelControl = showModel(data, {
        main,
        post: (message) => vscode.postMessage(message),
      });
      break;
    case 'compressedAudio':
      showCompressedAudio(main, data);
      break;
    case 'video':
      movie = showMovie(main, data, (message) => vscode.postMessage(message));
      break;
    case 'videoFrame':
      movie?.show(data.index, data.pixels);
      break;
    case 'videoError': {
      const error = document.createElement('p');

      movie?.failed();
      error.className = 'error';
      error.textContent = `Cannot decode this frame: ${data.message}`;
      main.append(error);
      break;
    }
    case 'uses':
      modelControl?.setUses(data.uses);
      break;
    case 'animations':
      modelControl?.setAnimations(data.names);
      break;
    case 'animation':
      modelControl?.play(data);
      break;
    case 'animationError':
      modelControl?.notice(data.message);
      break;
    case 'texture':
      showTexture(data);
      break;
    case 'audio':
      showAudio(main, data);
      break;
    case 'error': {
      const error = document.createElement('p');

      error.className = 'error';
      error.textContent = `Cannot preview this file: ${data.message}`;
      main.replaceChildren(error);
      break;
    }
  }
});

vscode.postMessage({ kind: 'ready' });
