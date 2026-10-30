import type { WndBox, WndState } from '../../formats/wnd/wndLayout';
import { css, POINTS_TO_UNITS } from './paint';

const lineBreaks = (
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
) => {
  const out: string[] = [];

  for (const paragraph of text.split('\n')) {
    let line = '';

    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;

      if (line && context.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else {
        line = next;
      }
    }

    out.push(line);
  }

  return out;
};

/**
 * Draws a window's text in its state's colour, wrapped and aligned the way its
 * gadget type lays text out. `textLeft` starts the text after a check box's square.
 */
export const drawText = (
  context: CanvasRenderingContext2D,
  box: WndBox,
  state: WndState,
  rect: [number, number, number, number],
  textLeft: number | undefined,
) => {
  const text = box.shown;

  if (!text) {
    return;
  }

  const [left, top, right, bottom] = rect;
  const size = box.font ? box.font.size * POINTS_TO_UNITS : 12;
  const stateColour = box.textColors?.[state];
  const colour =
    stateColour && stateColour[3] > 0 ? stateColour : [255, 255, 255, 255];

  context.font = `${box.font?.bold ? 'bold ' : ''}${size}px ${box.font?.name ? `"${box.font.name}", ` : ''}sans-serif`;
  context.fillStyle = css(colour as [number, number, number, number]);
  context.textBaseline = 'middle';

  const start = textLeft === undefined ? left : textLeft;
  const centred = box.wrapCentered || box.type === 'PUSHBUTTON';
  const lines =
    box.wrapCentered || box.type === 'STATICTEXT'
      ? lineBreaks(context, text, right - start)
      : [text];
  const height = lines.length * size * 1.15;
  const middleAligned =
    box.wrapCentered || box.type === 'PUSHBUTTON' || box.type === 'CHECKBOX';
  const middle = middleAligned ? (top + bottom) / 2 : top + size * 0.65 + 2;
  const first = middleAligned ? middle - height / 2 + size * 0.575 : middle;

  context.textAlign = centred ? 'center' : 'left';
  lines.forEach((line, index) =>
    context.fillText(
      line,
      centred ? (start + right) / 2 : start + 3,
      first + index * size * 1.15,
    ),
  );
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
};
