import type { TextureMessage } from './protocol';

/** A texture on a canvas, with zoom, channel, background and mip controls */

const MAX_ZOOM = 32;

const byId = <Element extends HTMLElement>(id: string) =>
  document.getElementById(id) as Element;

/** Creates the texture view on the page's toolbar and returns the function that shows a texture message */
export const createTexturePage = (main: HTMLElement) => {
  const toolbar = byId('toolbar');
  const status = byId('status');
  const levelSelect = byId<HTMLSelectElement>('level');
  const channelSelect = byId<HTMLSelectElement>('channels');
  const backgroundSelect = byId<HTMLSelectElement>('background');
  const state = {
    zoom: 0,
    levels: [] as TextureMessage['levels'],
    level: 0,
    format: '',
  };
  let canvas: HTMLCanvasElement | undefined;
  let stage: HTMLDivElement | undefined;

  const layout = () => {
    const { width, height } = state.levels[state.level];
    const available = Math.max(1, main.clientWidth - 24);
    const scale = state.zoom || Math.min(1, available / width);

    canvas!.style.width = `${width * scale}px`;
    canvas!.style.height = `${height * scale}px`;
    canvas!.classList.toggle('pixelated', scale > 1);
    byId('fit').setAttribute('aria-pressed', String(!state.zoom));
    byId('actual').setAttribute('aria-pressed', String(state.zoom === 1));
    status.textContent =
      `${state.format} · ${width}×${height}` +
      (state.levels.length > 1 ? ` · ${state.levels.length} mips` : '') +
      ` · ${Math.round(scale * 100)}%`;
  };

  const drawTexture = () => {
    const { width, height, pixels } = state.levels[state.level];
    const image = new ImageData(width, height);
    const mode = channelSelect.value;

    for (let at = 0; at < pixels.length; at += 4) {
      if (mode === 'alpha') {
        image.data.fill(pixels[at + 3], at, at + 3);
        image.data[at + 3] = 255;
      } else {
        image.data[at] = pixels[at];
        image.data[at + 1] = pixels[at + 1];
        image.data[at + 2] = pixels[at + 2];
        image.data[at + 3] = mode === 'rgb' ? 255 : pixels[at + 3];
      }
    }

    canvas!.width = width;
    canvas!.height = height;
    canvas!.getContext('2d')!.putImageData(image, 0, 0);
    layout();
  };

  const setZoom = (zoom: number) => {
    state.zoom = zoom;
    layout();
  };

  const getCurrentScale = () => {
    const { width } = state.levels[state.level];

    return parseFloat(canvas!.style.width) / width;
  };

  byId('fit').onclick = () => setZoom(0);
  byId('actual').onclick = () => setZoom(1);
  byId('zoom-in').onclick = () =>
    setZoom(Math.min(MAX_ZOOM, getCurrentScale() * 2));
  byId('zoom-out').onclick = () =>
    setZoom(Math.max(1 / MAX_ZOOM, getCurrentScale() / 2));
  channelSelect.onchange = drawTexture;
  levelSelect.onchange = () => {
    state.level = Number(levelSelect.value);
    drawTexture();
  };
  backgroundSelect.onchange = () => {
    stage!.className = `stage ${backgroundSelect.value}`;
  };
  window.addEventListener('resize', () => canvas && layout());

  return (message: TextureMessage) => {
    Object.assign(state, {
      levels: message.levels,
      format: message.format,
      level: 0,
    });
    toolbar.hidden = false;
    channelSelect.value = message.hasAlpha ? 'rgba' : 'rgb';
    levelSelect.hidden = message.levels.length < 2;
    levelSelect.replaceChildren(
      ...message.levels.map((level, index) => {
        const option = document.createElement('option');

        option.value = String(index);
        option.textContent = `Mip ${index} (${level.width}×${level.height})`;

        return option;
      }),
    );
    stage = document.createElement('div');
    stage.className = 'stage checker';
    canvas = document.createElement('canvas');
    stage.append(canvas);
    main.replaceChildren(stage);
    drawTexture();
  };
};
