import { buildAnimation } from '../../formats/cursor/buildAnimation';
import { millisecondsToJiffies } from '../../formats/cursor/jiffies';
import { writeAni } from '../../formats/cursor/writeAni';
import { getVsCodeApi } from '../shared/vscodeApi';
import { element } from '../shared/element';
import { showFrameRows } from './frameRows';
import type { FrameRow } from './frameRows';
import { createLoopPreview } from './loopPreview';
import type { FromBuilderPage, ToBuilderPage } from './protocol';

/**
 * The animated cursor builder's page: images added from disk become frames in
 * a list whose order, hotspots and durations are edited in place, a loop
 * previews them, and Save writes the `.ani` through the extension.
 */

/** Duration given to a frame when it is added, ten frames a second */
const NEW_FRAME_MILLISECONDS = 100;

const vscode = getVsCodeApi<FromBuilderPage>();
const main = document.getElementById('main')!;
const toolbar = element('div', undefined, 'controls');
const add = element('button', 'Add Images…');
const save = element('button', 'Save as .ani…');
const allMilliseconds = element('input');
const applyAll = element('button', 'Set All Durations');
const problem = element('p', undefined, 'error');
const list = element('div');
const preview = createLoopPreview();
let rows: FrameRow[] = [];

allMilliseconds.type = 'number';
allMilliseconds.min = '1';
allMilliseconds.value = String(NEW_FRAME_MILLISECONDS);
allMilliseconds.style.width = '72px';
allMilliseconds.title = 'Milliseconds a frame shows';
toolbar.append(add, save, allMilliseconds, applyAll);
main.append(toolbar, problem, list, preview.element);

/** Refreshes what depends on the rows' values, not on their order or number */
const refreshPreview = () => {
  preview.setRows(rows);

  try {
    // Writing is the check: it refuses sizes and steps the format cannot store
    writeAni(buildAnimation(rows));
    problem.textContent = '';
    save.disabled = false;
  } catch (error) {
    problem.textContent = rows.length
      ? String(error instanceof Error ? error.message : error)
      : 'Add the images the animation is made of.';
    save.disabled = true;
  }
};

const render = () => {
  showFrameRows(list, rows, {
    change: refreshPreview,
    move(index, offset) {
      const [moved] = rows.splice(index, 1);

      rows.splice(index + offset, 0, moved);
      render();
    },
    duplicate(index) {
      const { frame, name, jiffies } = rows[index];

      rows.splice(index + 1, 0, { frame: { ...frame }, name, jiffies });
      render();
    },
    remove(index) {
      rows.splice(index, 1);
      render();
    },
  });
  refreshPreview();
};

add.onclick = () => vscode.postMessage({ kind: 'addImages' });
applyAll.onclick = () => {
  const jiffies = millisecondsToJiffies(Number(allMilliseconds.value) || 1);

  rows.forEach((row) => (row.jiffies = jiffies));
  render();
};
save.onclick = () =>
  vscode.postMessage({
    kind: 'save',
    bytes: writeAni(buildAnimation(rows)),
  });

window.addEventListener('message', ({ data }: MessageEvent<ToBuilderPage>) => {
  if (data.kind === 'images') {
    rows.push(
      ...data.images.map(({ name, ...frame }) => ({
        name,
        frame,
        jiffies: millisecondsToJiffies(Number(allMilliseconds.value)),
      })),
    );
    render();
  } else {
    problem.textContent = data.message;
  }
});

render();
vscode.postMessage({ kind: 'ready' });
