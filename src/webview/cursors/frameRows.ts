import type { AnimationRow } from '../../formats/cursor/buildAnimation';
import {
  jiffiesToMilliseconds,
  millisecondsToJiffies,
} from '../../formats/cursor/jiffies';
import { drawCursorFrame, pickCursorScale } from '../shared/drawCursorFrame';
import { element } from '../shared/element';

/** A frame of the animation being built, with the name of the file it came from */
export interface FrameRow extends AnimationRow {
  name: string;
}

/** What the row list asks of the page when the user edits a row */
export interface FrameRowActions {
  /** A duration or hotspot changed; the rows were edited in place */
  change(): void;
  /** Moves a row by `offset` places, a row up or down */
  move(index: number, offset: number): void;
  duplicate(index: number): void;
  remove(index: number): void;
}

const createNumberInput = (
  value: number,
  max: number,
  onChange: (value: number) => void,
) => {
  const input = element('input');

  input.type = 'number';
  input.min = '0';
  input.max = String(max);
  input.value = String(value);
  input.style.width = '64px';
  input.onchange = () => {
    if (input.checkValidity() && input.value !== '') {
      onChange(Math.round(Number(input.value)));
    }
  };

  return input;
};

const createButton = (text: string, title: string, onClick: () => void) => {
  const button = element('button', text);

  button.title = title;
  button.onclick = onClick;

  return button;
};

/** Draws one row: its thumbnail, name and size, then the hotspot and duration it edits in place */
const createFrameRow = (
  row: FrameRow,
  index: number,
  count: number,
  actions: FrameRowActions,
) => {
  const line = element('div', undefined, 'controls');
  const thumbnail = element('canvas', undefined, 'pixelated');
  const stage = element('div', undefined, 'stage checker');
  const name = element(
    'span',
    `${index + 1}. ${row.name} · ${row.frame.width}×${row.frame.height}`,
  );
  const jiffies = element('span', undefined, 'status');
  const duration = createNumberInput(
    jiffiesToMilliseconds(row.jiffies),
    60000,
    (milliseconds) => {
      row.jiffies = millisecondsToJiffies(milliseconds);
      jiffies.textContent = `${row.jiffies} jiffies`;
      actions.change();
    },
  );

  const redraw = () =>
    drawCursorFrame(thumbnail, row.frame, pickCursorScale(row.frame, 48));

  redraw();
  stage.append(thumbnail);
  jiffies.textContent = `${row.jiffies} jiffies`;
  name.style.flex = '1';

  const hotspotX = createNumberInput(
    row.frame.hotspotX,
    row.frame.width - 1,
    (value) => {
      row.frame.hotspotX = value;
      redraw();
      actions.change();
    },
  );
  const hotspotY = createNumberInput(
    row.frame.hotspotY,
    row.frame.height - 1,
    (value) => {
      row.frame.hotspotY = value;
      redraw();
      actions.change();
    },
  );

  line.append(
    stage,
    name,
    element('label', 'hotspot'),
    hotspotX,
    hotspotY,
    element('label', 'ms'),
    duration,
    jiffies,
    createButton('↑', 'Move earlier', () => actions.move(index, -1)),
    createButton('↓', 'Move later', () => actions.move(index, 1)),
    createButton('⧉', 'Duplicate', () => actions.duplicate(index)),
    createButton('✕', 'Remove', () => actions.remove(index)),
  );
  line.querySelectorAll('button').forEach((button, which) => {
    button.disabled =
      (which === 0 && index === 0) || (which === 1 && index === count - 1);
  });

  return line;
};

/** Fills `container` with one editable line per row */
export const showFrameRows = (
  container: HTMLElement,
  rows: FrameRow[],
  actions: FrameRowActions,
): void => {
  container.replaceChildren(
    ...rows.map((row, index) =>
      createFrameRow(row, index, rows.length, actions),
    ),
  );
};
