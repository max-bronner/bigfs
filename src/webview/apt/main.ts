import { byId, escapeHtml } from './dom';
import { describe, showDetails, showScript, vscode } from './details';
import type { ToPage } from './protocol';
import { render } from './stage';
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

filter.oninput = showList;
zoomSelect.onchange = render;
frameInput.oninput = () => {
  state.frame = Number(frameInput.value);
  showDetails();
  render();
};
window.addEventListener('resize', () => state.movie && render());

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
      }
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

vscode.postMessage({ kind: 'ready' });
