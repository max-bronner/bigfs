import type {
  CommandSetMessage,
  EditorSlot,
  FromCommandSetPage,
} from '../../game/objects/commandSetEdit';
import { getVsCodeApi } from '../shared/vscodeApi';

/**
 * The CommandSet editor's page: slots in rows of five, each a button with
 * its icon, text and hotkey. Drag to move, × to clear, click an empty
 * slot to add.
 */

const vscode = getVsCodeApi<FromCommandSetPage>();
const grid = document.getElementById('grid')!;
const COLUMNS = 5;

const createSlotElement = (number: number, slot: EditorSlot | undefined) => {
  const element = document.createElement('div');
  const label = document.createElement('span');

  label.className = 'number';
  label.textContent = String(number);
  element.className = 'slot';
  element.dataset.slot = String(number);
  element.append(label);
  element.ondragover = (event) => {
    event.preventDefault();
    element.classList.add('over');
  };
  element.ondragleave = () => element.classList.remove('over');
  element.ondrop = (event) => {
    event.preventDefault();
    element.classList.remove('over');

    const from = Number(event.dataTransfer?.getData('text/plain'));

    if (Number.isInteger(from) && from !== number) {
      vscode.postMessage({ kind: 'move', from, to: number });
    }
  };

  if (!slot) {
    element.classList.add('empty');
    element.append('+');
    element.title = `Add a button to slot ${number}`;
    element.onclick = () => vscode.postMessage({ kind: 'add', slot: number });
    return element;
  }

  const clear = document.createElement('button');
  const text = document.createElement('div');
  const command = document.createElement('div');
  const picture = slot.icon
    ? document.createElement('img')
    : document.createElement('div');

  clear.className = 'clear';
  clear.textContent = '×';
  clear.title = 'Clear this slot';
  clear.onclick = () => vscode.postMessage({ kind: 'clear', slot: number });
  if (picture instanceof HTMLImageElement) {
    picture.src = slot.icon!;
    picture.draggable = false;
  } else {
    picture.className = 'noicon';
  }
  text.className = 'text';
  text.textContent = slot.defined
    ? (slot.text ?? slot.button).replace(/&(?!&)/, '')
    : `${slot.button} (not defined)`;
  text.title = `${slot.button}: open it`;
  text.style.cursor = 'pointer';
  text.onclick = () => vscode.postMessage({ kind: 'reveal', slot: number });
  if (slot.hotkey) {
    const key = document.createElement('span');

    key.className = slot.clashes?.length ? 'clash' : '';
    key.textContent = ` [${slot.hotkey}]`;
    key.title = slot.clashes?.length
      ? `Same hotkey as slot ${slot.clashes.join(', ')}`
      : 'Hotkey';
    text.append(key);
  }
  command.className = 'command';
  command.textContent = slot.command ?? '';
  element.classList.toggle('undefined', !slot.defined);
  element.draggable = true;
  element.ondragstart = (event) =>
    event.dataTransfer?.setData('text/plain', String(number));
  element.append(clear, picture, text, command);
  return element;
};

window.addEventListener(
  'message',
  ({ data }: MessageEvent<CommandSetMessage>) => {
    if (data.kind !== 'set') {
      return;
    }

    const bySlot = new Map(data.slots.map((slot) => [slot.slot, slot]));
    const highest = Math.max(0, ...bySlot.keys());
    // Every slot up to the highest, and a row more to add to
    const count = Math.max(10, Math.ceil((highest + 1) / COLUMNS) * COLUMNS);

    grid.replaceChildren(
      ...Array.from({ length: count }, (_, at) =>
        createSlotElement(at + 1, bySlot.get(at + 1)),
      ),
    );
  },
);
vscode.postMessage({ kind: 'ready' });
