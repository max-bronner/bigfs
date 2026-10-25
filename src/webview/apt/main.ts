import { byId, escapeHtml } from './dom';
import { describe, showDetails, showScript, vscode } from './details';
import type { ToPage } from './protocol';
import { showInspector, updateInspector } from './inspector';
import {
  goToFrame,
  play,
  render,
  restart,
  setInspectorView,
  showMode,
  view,
} from './stage';
import { movie, state } from './state';

/**
 * The APT editor page: the character list, the stage that draws the
 * selected character, and its details. It reaches the extension only
 * through messages: to ask for a script, or to send an edit.
 */

const list = byId('list');
const filter = byId<HTMLInputElement>('filter');
const frameInput = byId<HTMLInputElement>('frame');
const zoomSelect = byId<HTMLSelectElement>('zoom');

const select = (id: number) => {
  state.selected = id;
  state.frame = 0;
  restart();
  showInspector();
  list
    .querySelectorAll<HTMLElement>('.row')
    .forEach((each) =>
      each.classList.toggle('selected', Number(each.dataset.id) === id),
    );
  showDetails();
  render();
};

const showList = () => {
  const needle = filter.value.toLowerCase();

  list.replaceChildren(
    ...movie()
      .characters.filter(
        (character) =>
          !needle || describe(character).toLowerCase().includes(needle),
      )
      .map((character) => {
        const element = document.createElement('div');

        element.className =
          'row' + (character.id === state.selected ? ' selected' : '');
        element.dataset.id = String(character.id);
        element.textContent = describe(character);
        element.onclick = () => select(character.id);
        return element;
      }),
  );
};

/** Moves to a frame of the shown timeline, which restarts the clocks of nested ones */
const goTo = (frame: number) => {
  goToFrame(frame);
  showDetails();
  render();
};

const step = (by: number) => {
  play(false);
  goTo(state.frame + by);
};

const toggle = (
  key: 'origin' | 'boxes' | 'scripts' | 'interact',
  id: string,
) => {
  view[key] = !view[key];
  byId<HTMLInputElement>(id).checked = view[key];
  // Scripts and interaction change what plays, so it starts over
  if (key === 'scripts' || key === 'interact') {
    const inspected = state.inspected;

    restart();
    state.inspected = inspected;
    goToFrame(state.frame);
    if (key === 'interact' && view.interact && !view.playing) {
      play(true);
    }
    showInspector();
  }
  showMode();
  render();
};

filter.oninput = showList;
zoomSelect.onchange = render;
frameInput.oninput = () => goTo(Number(frameInput.value));
byId('play').onclick = () => play(!view.playing);
byId('back').onclick = () => step(-1);
byId('forward').onclick = () => step(1);
byId<HTMLSelectElement>('fps').onchange = (event) => {
  view.fps = Number((event.target as HTMLSelectElement).value);
  showMode();
};
byId('show-origin').onchange = () => toggle('origin', 'show-origin');
byId('show-boxes').onchange = () => toggle('boxes', 'show-boxes');
byId('scripts').onchange = () => toggle('scripts', 'scripts');
byId('interact').onchange = () => toggle('interact', 'interact');
setInspectorView(showInspector, updateInspector);
window.addEventListener('resize', () => state.movie && render());

// Hotkeys, except while typing into a field
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;

  if (
    !state.movie ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  ) {
    return;
  }

  const actions: Record<string, () => void> = {
    ' ': () => play(!view.playing),
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    o: () => toggle('origin', 'show-origin'),
    b: () => toggle('boxes', 'show-boxes'),
    s: () => toggle('scripts', 'scripts'),
    i: () => toggle('interact', 'interact'),
  };
  const action = actions[event.key];

  if (action) {
    event.preventDefault();
    action();
  }
});

window.addEventListener('message', ({ data }: MessageEvent<ToPage>) => {
  switch (data.kind) {
    case 'movie': {
      const isFirst = !state.movie;

      state.movie = data.movie;
      for (const [key, imported] of Object.entries(data.library)) {
        state.library.set(key, imported);
      }
      for (const [path, texture] of Object.entries(data.textures)) {
        const canvas = document.createElement('canvas');

        canvas.width = texture.width;
        canvas.height = texture.height;
        canvas
          .getContext('2d')!
          .putImageData(
            new ImageData(
              new Uint8ClampedArray(texture.pixels),
              texture.width,
              texture.height,
            ),
            0,
            0,
          );
        state.textures.set(path, canvas);
      }
      byId('summary').textContent = data.summary;
      if (isFirst || !data.movie.characters[state.selected]) {
        state.selected = 0;
        state.frame = 0;
      }

      // An edit changes what plays; it starts over at the same frame
      const inspected = state.inspected;

      restart();
      state.inspected = inspected;
      goToFrame(state.frame);
      showInspector();
      showList();
      showDetails();
      render();
      break;
    }
    case 'select':
      showList();
      select(data.character);
      break;
    case 'script':
      showScript(data);
      break;
    case 'scriptSaved': {
      state.drafts.delete(data.previous);
      state.openBlocks.delete(data.previous);
      state.openBlocks.add(data.block);

      const element = document.querySelector<HTMLDetailsElement>(
        `#details details[data-block="${data.block}"]`,
      );

      if (element && !element.open) {
        element.open = true;
      }
      break;
    }
    case 'notice': {
      const notice = byId('notice');

      notice.textContent = data.message;
      notice.hidden = false;
      setTimeout(() => (notice.hidden = true), 6000);
      break;
    }
    case 'error':
      document.body.innerHTML =
        '<p class="error">Cannot open this movie: ' +
        escapeHtml(data.message) +
        '</p>';
      break;
  }
});

showMode();
vscode.postMessage({ kind: 'ready' });
