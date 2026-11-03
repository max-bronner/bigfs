import type { RegionEditor } from './createRegionEditor';
import { getFitScale } from './getFitScale';
import { readPageState, savePageState } from './pageState';
import type { TextureMessage } from './protocol';

/**
 * A texture on a canvas, with zoom, channel, background and mip controls. The
 * texture scrolls inside its own area, beside the references panel, and Fit
 * follows that area as it changes size.
 */

const MAX_ZOOM = 32;

/** Room the stage leaves around the texture: the area's padding on both sides */
const MARGIN = 24;

const byId = <Element extends HTMLElement>(id: string) =>
  document.getElementById(id) as Element;

/** Creates the texture view on the page's toolbar and returns the function that shows a texture message */
export const createTexturePage = (
  main: HTMLElement,
  regions: RegionEditor,
  events: { onPopOut(): void },
) => {
  const toolbar = byId('toolbar');
  const status = byId('status');
  const levelSelect = byId<HTMLSelectElement>('level');
  const channelSelect = byId<HTMLSelectElement>('channels');
  const backgroundSelect = byId<HTMLSelectElement>('background');
  const state = {
    zoom: readPageState().zoom ?? 0,
    levels: [] as TextureMessage['levels'],
    level: 0,
    format: '',
  };
  let canvas: HTMLCanvasElement | undefined;
  let stage: HTMLDivElement | undefined;

  /** The part of the stage inside the scrolling area, from the stage's top left */
  const getVisibleBox = () => {
    const area = main.getBoundingClientRect();
    const box = stage!.getBoundingClientRect();
    const left = Math.max(0, area.left - box.left);
    const top = Math.max(0, area.top - box.top);

    return {
      left,
      top,
      width: Math.min(box.width, area.left + main.clientWidth - box.left) - left,
      height: Math.min(box.height, area.top + main.clientHeight - box.top) - top,
    };
  };

  const fitRegions = () => {
    regions.fit(
      parseFloat(canvas!.style.width),
      parseFloat(canvas!.style.height),
      state.levels[0].width,
      getVisibleBox(),
    );
  };

  const layout = () => {
    const { width, height } = state.levels[state.level];
    const scale =
      state.zoom ||
      getFitScale(
        {
          width: main.clientWidth - MARGIN,
          height: main.clientHeight - MARGIN,
        },
        { width, height },
      );

    canvas!.style.width = `${width * scale}px`;
    canvas!.style.height = `${height * scale}px`;
    canvas!.classList.toggle('pixelated', scale > 1);
    fitRegions();
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
    savePageState({ zoom });
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
  byId('popout').onclick = events.onPopOut;
  // The area changes size when the references panel appears or is dragged,
  // a scrollbar comes or goes, or the window is resized
  new ResizeObserver(() => canvas && layout()).observe(main);
  main.addEventListener('scroll', () => canvas && fitRegions());

  return (message: TextureMessage) => {
    document.body.classList.add('texture-page');
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
    regions.mount(stage);
    main.replaceChildren(stage);
    drawTexture();
  };
};
