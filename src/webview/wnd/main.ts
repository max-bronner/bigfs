import type { WndBox, WndState } from '../../formats/wnd/wndLayout';
import { getVsCodeApi } from '../shared/vscodeApi';
import { drawText } from './drawText';
import { drawList, drawPart, drawSlider } from './paint';
import type { Painter } from './paint';
import type { FromWndPage, ToWndPage } from './protocol';

/** The WND preview's page: the windows drawn at their creation resolution */

const CHECK_INSET = 3;

type Rect = [number, number, number, number];

const vscode = getVsCodeApi<FromWndPage>();
const canvas = document.getElementById('screen') as HTMLCanvasElement;
const context = canvas.getContext('2d')!;
const status = document.getElementById('status')!;
const showHidden = document.getElementById('hidden') as HTMLInputElement;
const showOutlines = document.getElementById('outlines') as HTMLInputElement;
const stateSelect = document.getElementById('state') as HTMLSelectElement;
const checkedBox = document.getElementById('checked') as HTMLInputElement;

const painter: Painter = { context, images: {}, textures: {} };
let boxes: WndBox[] = [];
let placed: { box: WndBox; rect: Rect }[] = [];
let hover: WndBox | undefined;

const lookOf = (box: WndBox) => {
  const state = stateSelect.value as WndState;
  const checked = `${state}+checked` as const;
  const key = checkedBox.checked && box.looks[checked] ? checked : state;

  return box.looks[key] ?? [];
};

const drawBox = (box: WndBox, rect: Rect) => {
  const [left, top, right, bottom] = rect;
  const width = right - left;
  const height = bottom - top;
  const state = stateSelect.value as WndState;
  const parts = lookOf(box);
  const type = box.type.toUpperCase();

  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();

  let textLeft: number | undefined;

  if (type === 'CHECKBOX') {
    const side = Math.max(0, height - 2 * CHECK_INSET);

    for (const part of parts) {
      drawPart(painter, part, left, top + CHECK_INSET, side, side);
    }

    textLeft = left + height;
  } else if (type === 'HORZSLIDER' || type === 'VERTSLIDER') {
    drawSlider(painter, parts, rect, type === 'VERTSLIDER');
  } else if (type === 'SCROLLLISTBOX') {
    drawList(painter, box, parts, rect);
  } else if (type === 'COMBOBOX') {
    for (const part of parts) {
      if (part.role === 'button') {
        const side = Math.min(height, width);

        drawPart(painter, part, right - side, top, side, height);
      } else {
        drawPart(painter, part, left, top, width, height);
      }
    }
  } else {
    for (const part of parts) {
      drawPart(painter, part, left, top, width, height);
    }
  }

  if (
    type !== 'SCROLLLISTBOX' &&
    type !== 'HORZSLIDER' &&
    type !== 'VERTSLIDER'
  ) {
    drawText(context, box, state, rect, textLeft);
  }

  context.restore();

  if (showOutlines.checked || hover === box) {
    context.strokeStyle =
      hover === box
        ? '#ffd24a'
        : box.hidden
          ? 'rgba(255,255,255,0.25)'
          : box.laidOut
            ? 'rgba(255,170,90,0.6)'
            : 'rgba(200,220,255,0.3)';
    context.lineWidth = hover === box ? 2 : 1;
    context.setLineDash(box.hidden || box.laidOut ? [4, 3] : []);
    context.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
    context.setLineDash([]);
  }
};

const draw = () => {
  const roots = boxes.filter((box) => box.rect);
  const resolution = roots.find((box) => box.resolution)?.resolution ?? [
    800, 600,
  ];

  canvas.width = resolution[0];
  canvas.height = resolution[1];
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  placed = [];

  const walk = (list: WndBox[], scale: [number, number]) => {
    for (const box of list) {
      if (box.hidden && !showHidden.checked) {
        continue;
      }

      if (box.rect) {
        context.save();
        context.scale(scale[0], scale[1]);
        drawBox(box, box.rect);
        context.restore();
        placed.push({
          box,
          rect: [
            box.rect[0] * scale[0],
            box.rect[1] * scale[1],
            box.rect[2] * scale[0],
            box.rect[3] * scale[1],
          ],
        });
      }

      walk(box.children, scale);
    }
  };

  // each root is scaled from its own creation resolution to the screen
  for (const root of boxes) {
    const own = root.resolution ?? resolution;

    walk([root], [resolution[0] / own[0], resolution[1] / own[1]]);
  }

  status.textContent =
    `${placed.length} windows at ${resolution[0]} × ${resolution[1]}` +
    (hover
      ? ` · ${hover.name} (${hover.type})${hover.image ? ` · ${hover.image}` : ''}${hover.laidOut ? ' · placed by the engine' : ''}`
      : '');
};

const at = (event: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * canvas.width) / rect.width;
  const y = ((event.clientY - rect.top) * canvas.height) / rect.height;
  let found: (typeof placed)[number] | undefined;

  for (const entry of placed) {
    const [left, top, right, bottom] = entry.rect;

    if (x >= left && x <= right && y >= top && y <= bottom) {
      found = entry;
    }
  }

  return found;
};

canvas.addEventListener('mousemove', (event) => {
  const box = at(event)?.box;

  if (box !== hover) {
    hover = box;
    draw();
  }
});
canvas.addEventListener('click', (event) => {
  const found = at(event);

  if (found) {
    vscode.postMessage({ kind: 'reveal', offset: found.box.start });
  }
});

for (const control of [showHidden, showOutlines, stateSelect, checkedBox]) {
  control.addEventListener('change', draw);
}

window.addEventListener('message', ({ data }: MessageEvent<ToWndPage>) => {
  if (data.kind !== 'layout') {
    return;
  }

  boxes = data.boxes;
  painter.images = data.images || painter.images;
  hover = undefined;

  for (const [id, uri] of Object.entries(data.textures || {})) {
    const texture = new Image();

    texture.onload = draw;
    texture.src = uri;
    painter.textures[id] = texture;
  }

  draw();
});

vscode.postMessage({ kind: 'ready' });
