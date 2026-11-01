import type { AnimationRow } from '../../formats/cursor/buildAnimation';
import { jiffiesToMilliseconds } from '../../formats/cursor/jiffies';
import { drawCursorFrame, pickCursorScale } from '../shared/drawCursorFrame';
import { element } from '../shared/element';

/** The live preview of the animation being built: its frames looping at their own durations */
export interface LoopPreview {
  element: HTMLElement;
  /** Shows the new rows from the start, keeping a pause */
  setRows(rows: AnimationRow[]): void;
}

/** Creates the preview: a canvas on a checkerboard and a play and pause button */
export const createLoopPreview = (): LoopPreview => {
  const root = element('div');
  const stage = element('div', undefined, 'stage checker');
  const canvas = element('canvas', undefined, 'pixelated');
  const play = element('button', 'Pause');
  const label = element('p', undefined, 'status');
  let rows: AnimationRow[] = [];
  let position = 0;
  let timer: number | undefined;

  stage.append(canvas);
  root.append(stage, play, label);

  const show = () => {
    const row = rows[position];

    if (!row) {
      canvas.width = canvas.height = 0;
      label.textContent = 'Add images to see the animation';

      return;
    }

    drawCursorFrame(canvas, row.frame, pickCursorScale(row.frame, 160));
    label.textContent = `frame ${position + 1} / ${rows.length} · ${jiffiesToMilliseconds(row.jiffies)} ms`;
  };
  const tick = () => {
    show();

    if (rows.length) {
      timer = window.setTimeout(
        () => {
          position = (position + 1) % rows.length;
          tick();
        },
        Math.max(1, jiffiesToMilliseconds(rows[position].jiffies)),
      );
    }
  };
  const stop = () => {
    window.clearTimeout(timer);
    timer = undefined;
    play.textContent = 'Play';
  };
  const start = () => {
    play.textContent = 'Pause';
    tick();
  };

  play.onclick = () => (timer === undefined ? start() : stop());

  return {
    element: root,
    setRows(next) {
      const wasPlaying = timer !== undefined;

      window.clearTimeout(timer);
      timer = undefined;
      rows = next;
      position = Math.min(position, Math.max(0, rows.length - 1));

      if (wasPlaying || play.textContent === 'Pause') {
        start();
      } else {
        show();
      }
    },
  };
};
