import { onEngineRestart, showEngine } from './enginePanel';
import { keepAnswers } from './engineState';
import { setGameText } from './gameText';
import { movieArrived, storeTextures } from './movieLoads';
import { byId, escapeHtml } from './dom';
import {
  describe,
  GO_TO_FRAME,
  send,
  showDetails,
  showScript,
  vscode,
} from './details';
import { scriptSaved } from './blocks/scriptBlock';
import { installBlockStyles } from './blocks/blockStyles';
import type { ToPage } from './protocol';
import { showAtlas } from './atlas';
import './gadgets';
import { mappedImagesArrived } from './mappedSurfaces';
import { showIntegrity } from './integrity';
import { nudge } from './edit';
import './geometry';
import { freeDepth, showInspector, updateInspector } from './inspector';
import { markPlayhead, setOnion, showTimeline } from './timelinePanel';
import {
  currentPlayer,
  goToFrame,
  play,
  playFrom,
  pointAt,
  remeasure,
  render,
  restart,
  setInspectorView,
  showMode,
  view,
} from './stage';
import { SPEEDS } from './protocol';
import { movie, state } from './state';

/**
 * The APT editor page: the character list, the stage that draws the
 * selected character, and its details. It reaches the extension only
 * through messages: to ask for a script, or to send an edit.
 */

/** The panels about what is picked: the inspector, and the texture behind it */
const showPanels = () => {
  showInspector();
  showAtlas();
  showTimeline();
};

const list = byId('list');
const filter = byId<HTMLInputElement>('filter');
const frameInput = byId<HTMLInputElement>('frame');
const zoomSelect = byId<HTMLSelectElement>('zoom');
const playFromSelect = byId<HTMLSelectElement>('play-from');

playFromSelect.onchange = () => {
  if (playFromSelect.value !== '') {
    playFrom(Number(playFromSelect.value));
    showPanels();
  }
  playFromSelect.value = '';
};

// The engine panel's Restart: the movie again from its start, with the answers given
onEngineRestart(() => {
  restart();
  goToFrame(0);
  showPanels();
  showDetails();
  render();
});

const select = (id: number) => {
  state.selected = id;
  state.frame = 0;
  restart();
  showPlayFrom();
  showPanels();
  list
    .querySelectorAll<HTMLElement>('.row')
    .forEach((each) =>
      each.classList.toggle('selected', Number(each.dataset.id) === id),
    );
  showDetails();
  render();
};

/** The frames to play from: the start, and every label of the shown timeline */
const showPlayFrom = () => {
  const root = currentPlayer().root;

  playFromSelect.replaceChildren(
    new Option('Play from…', ''),
    new Option('frame 0', '0'),
    ...currentPlayer()
      .labels(root)
      .map(
        ({ label, frame }) =>
          new Option(`${label} (frame ${frame})`, String(frame)),
      ),
  );
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
        // Dragged onto the stage, it is placed in the shown timeline
        element.draggable = character.type !== 'movie';
        element.ondragstart = (event) =>
          event.dataTransfer?.setData(
            'application/x-apt-character',
            String(character.id),
          );
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
  key: 'origin' | 'boxes' | 'masks' | 'scripts' | 'interact' | 'wireframe',
  id: string,
) => {
  view[key] = !view[key];
  // These two checkboxes say the opposite of the mode: shown, ignored
  byId<HTMLInputElement>(id).checked =
    key === 'masks' || key === 'scripts' ? !view[key] : view[key];
  // Applied masks size the canvas to what they let show; shown, to it all
  if (key === 'masks') {
    remeasure();
  }
  // Scripts and interaction change what plays, so it starts over
  if (key === 'scripts' || key === 'interact') {
    const inspected = state.inspected;

    restart();
    state.inspected = inspected;
    goToFrame(state.frame);
    if (key === 'interact' && view.interact && !view.playing) {
      play(true);
    }
    showPanels();
  }
  showMode();
  render();
};

const stage = byId<HTMLCanvasElement>('stage');

stage.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('application/x-apt-character')) {
    event.preventDefault();
  }
});
stage.addEventListener('drop', (event) => {
  const id = Number(event.dataTransfer?.getData('application/x-apt-character'));
  const root = currentPlayer().root;

  event.preventDefault();
  if (
    !Number.isInteger(id) ||
    root.movie !== state.movie ||
    !['sprite', 'movie'].includes(root.character?.type ?? '')
  ) {
    return;
  }

  const depth = freeDepth(root);

  state.inspected = `/${depth}`;
  send({
    kind: 'placeObject',
    timeline: root.id,
    frame: root.frame,
    depth,
    character: id,
    translate: pointAt(event),
  });
});

filter.oninput = showList;
zoomSelect.onchange = render;
frameInput.oninput = () => goTo(Number(frameInput.value));
byId('play').onclick = () => play(!view.playing);
byId('back').onclick = () => step(-1);
byId('forward').onclick = () => step(1);
const speedSelect = byId<HTMLSelectElement>('speed');
const setSpeed = (speed: number) => {
  view.speed = speed;
  speedSelect.value = String(speed);
  showMode();
};

speedSelect.onchange = () => setSpeed(Number(speedSelect.value));
/** One step slower or faster through the speeds offered */
const stepSpeed = (by: number) => {
  const at = SPEEDS.indexOf(view.speed);

  setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + by))]);
};
byId('show-origin').onchange = () => toggle('origin', 'show-origin');
byId('show-boxes').onchange = () => toggle('boxes', 'show-boxes');
byId('show-masks').onchange = () => toggle('masks', 'show-masks');
byId('scripts').onchange = () => toggle('scripts', 'scripts');
byId('interact').onchange = () => toggle('interact', 'interact');
byId('wireframe').onchange = () => toggle('wireframe', 'wireframe');
setInspectorView(showPanels, () => {
  updateInspector();
  markPlayhead();
});
window.addEventListener('resize', () => state.movie && render());
window.addEventListener(GO_TO_FRAME, (event) => {
  play(false);
  goTo((event as CustomEvent<number>).detail);
  showTimeline();
});

// Hotkeys, except while typing into a field
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;

  if (
    !state.movie ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    // Blocks and their menus use the keys themselves
    target.closest('#details, .bk-popup')
  ) {
    return;
  }

  const actions: Record<string, () => void> = {
    ' ': () => play(!view.playing),
    // Arrows nudge what is selected on the stage, or step frames
    ArrowLeft: () => nudge(event.shiftKey ? -10 : -1, 0) || step(-1),
    ArrowRight: () => nudge(event.shiftKey ? 10 : 1, 0) || step(1),
    ArrowUp: () => void nudge(0, event.shiftKey ? -10 : -1),
    ArrowDown: () => void nudge(0, event.shiftKey ? 10 : 1),
    ',': () => step(-1),
    '.': () => step(1),
    o: () => toggle('origin', 'show-origin'),
    b: () => toggle('boxes', 'show-boxes'),
    m: () => toggle('masks', 'show-masks'),
    s: () => toggle('scripts', 'scripts'),
    i: () => toggle('interact', 'interact'),
    w: () => toggle('wireframe', 'wireframe'),
    '[': () => stepSpeed(-1),
    ']': () => stepSpeed(1),
    n: () => setOnion((view.onion + 1) % 4),
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
      setGameText(data.texts);
      if (data.answers) {
        keepAnswers(data.answers);
      }
      for (const [key, imported] of Object.entries(data.library)) {
        state.library.set(key, imported);
      }
      storeTextures(data.textures);
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
      showPlayFrom();
      showPanels();
      showList();
      showDetails();
      render();
      break;
    }
    case 'movieLoaded':
      movieArrived(data);
      render();
      break;
    case 'mappedImages':
      mappedImagesArrived(data);
      break;
    case 'select':
      showList();
      select(data.character);
      break;
    case 'integrity':
      showIntegrity(data.problems, (character) => {
        showList();
        select(character);
      });
      break;
    case 'script':
      showScript(data);
      break;
    case 'scriptSaved': {
      scriptSaved(data.previous, data.block);
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

byId('toggleTextView').onclick = () =>
  vscode.postMessage({ kind: 'openTextView' });

installBlockStyles();
showMode();
showEngine();
vscode.postMessage({ kind: 'ready' });
