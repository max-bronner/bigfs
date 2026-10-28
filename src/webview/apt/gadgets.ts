import {
  DEFAULT_SIZE,
  fraction,
  itemsOf,
  numberOf,
  rangeOf,
} from '../../formats/apt/aptGadgets';
import type { Rect } from '../../formats/apt/aptMovie';
import { byId } from './dom';
import { engine } from './engineState';
import {
  findGadgets,
  readBinding,
  writeBinding,
} from './gadgetModel';
import type { Gadget } from './gadgetModel';
import { mappedImage, onMappedImages } from './mappedSurfaces';
import type { Affine } from './scene';
import { multiply } from './scene';
import { addRenderHook, currentPlayer, instanceBox, render } from './stage';
import { state } from './state';

/**
 * Gadgets on the stage: interactive controls laid over the canvas for
 * sliders, check boxes, list and combo boxes, text entries, scroll bars and
 * progress bars, drawn at the box their clip covers (or a default size when
 * it draws nothing), and `MappedImage` surfaces painted on the canvas. A
 * `_type` nothing here knows is a labelled placeholder. Ported from mint's
 * apt-viewer; what each control reads and writes is `BINDINGS`.
 */

const stage = byId<HTMLCanvasElement>('stage');
const layer = document.createElement('div');
const wrap = document.createElement('div');

wrap.style.cssText = 'position:relative;display:inline-block;line-height:0';
layer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
stage.replaceWith(wrap);
wrap.append(stage, layer);

/** The gadgets of the shown run; the Engine panel lists these too */
export const currentGadgets = (): Gadget[] => findGadgets(currentPlayer());

/** An instance's matrix to the shown character's space */
const absolute = (gadget: Gadget): Affine => {
  const chain = [];

  for (let at = gadget.instance; at.parent; at = at.parent) {
    chain.unshift(at);
  }
  return chain.reduce<Affine>(
    (matrix, at) => multiply(matrix, [...at.matrix, ...at.translate] as Affine),
    [1, 0, 0, 1, 0, 0],
  );
};

/** Where a gadget sits in the shown character's space */
const boxOf = (gadget: Gadget): Rect => {
  const drawn = instanceBox(gadget.instance);

  if (drawn) {
    return drawn;
  }

  const [a, , , , tx, ty] = absolute(gadget);
  const [w, h] = DEFAULT_SIZE[gadget.kind];

  return [tx, ty, tx + w * (a || 1), ty + h * (a || 1)];
};

const write = (gadget: Gadget, name: string, value: string): void => {
  writeBinding(currentPlayer(), engine, gadget, name, value);
  render();
};

/** Makes the control of a gadget; `fill` brings it in line with what is bound */
const control = (
  gadget: Gadget,
): { element: HTMLElement; fill: (gadget: Gadget) => void } => {
  const player = () => currentPlayer();
  const value = (g: Gadget, name: string) =>
    readBinding(player(), engine, g, {
      name,
      fallback: '',
    });
  const label = document.createElement('div');

  switch (gadget.kind) {
    case 'slider':
    case 'scrollbar': {
      const range = document.createElement('input');

      range.type = 'range';
      range.oninput = () => write(gadget, '_value', range.value);
      return {
        element: range,
        fill: (g) => {
          const [low, high] = rangeOf(value(g, '_min'), value(g, '_max'));

          range.min = String(low);
          range.max = String(high);
          range.value = String(numberOf(value(g, '_value'), low));
          if (g.kind === 'scrollbar' && g.instance) {
            range.title = `${g.label} ${range.value}`;
          }
        },
      };
    }
    case 'checkbox': {
      const box = document.createElement('input');

      box.type = 'checkbox';
      box.onchange = () => write(gadget, '_checked', String(box.checked));
      return {
        element: box,
        fill: (g) => (box.checked = value(g, '_checked') === true || value(g, '_checked') === 'true'),
      };
    }
    case 'listbox':
    case 'combobox': {
      const select = document.createElement('select');

      if (gadget.kind === 'listbox') {
        select.size = 5;
      }
      select.onchange = () => write(gadget, '_selected', select.value);
      return {
        element: select,
        fill: (g) => {
          const items = itemsOf(value(g, '_items'));

          select.replaceChildren(
            ...items.map((item, at) => new Option(item, String(at))),
          );
          select.selectedIndex = Math.min(
            items.length - 1,
            numberOf(value(g, '_selected'), -1),
          );
        },
      };
    }
    case 'textentry': {
      const entry = document.createElement('input');

      entry.type = 'text';
      entry.oninput = () => write(gadget, '_text', JSON.stringify(entry.value));
      return {
        element: entry,
        fill: (g) => {
          if (document.activeElement !== entry) {
            entry.value = String(value(g, '_text') ?? '');
          }
        },
      };
    }
    case 'progressbar': {
      const bar = document.createElement('progress');

      return {
        element: bar,
        fill: (g) => {
          const range = rangeOf(0, value(g, '_max'));

          bar.max = range[1] || 1;
          bar.value = fraction(numberOf(value(g, '_value'), 0), range) * bar.max;
        },
      };
    }
    default:
      label.style.cssText =
        'border:1px dashed currentColor;font:11px monospace;line-height:1.2;overflow:hidden;display:flex;align-items:center;justify-content:center;opacity:.8;box-sizing:border-box';
      return {
        element: label,
        fill: (g) => (label.textContent = g.label),
      };
  }
};

const controls = new Map<
  Gadget['instance'],
  { kind: string; element: HTMLElement; fill: (g: Gadget) => void }
>();

const sync = (ctx: CanvasRenderingContext2D, base: Affine): void => {
  const ratio = window.devicePixelRatio || 1;
  const all = currentGadgets();
  const alive = new Set<Gadget['instance']>();

  layer.style.width = `${stage.width / ratio}px`;
  layer.style.height = `${stage.height / ratio}px`;

  for (const gadget of all) {
    const [left, top, right, bottom] = boxOf(gadget);

    if (gadget.kind === 'image') {
      paintImage(ctx, base, gadget, [left, top, right, bottom]);
      continue;
    }
    alive.add(gadget.instance);

    let held = controls.get(gadget.instance);

    if (!held || held.kind !== gadget.kind) {
      held?.element.remove();
      held = { kind: gadget.kind, ...control(gadget) };
      held.element.style.cssText += ';position:absolute;pointer-events:auto;box-sizing:border-box;margin:0';
      controls.set(gadget.instance, held);
      layer.append(held.element);
    }
    held.fill(gadget);

    const { style } = held.element;

    style.left = `${(base[0] * left + base[4]) / ratio}px`;
    style.top = `${(base[3] * top + base[5]) / ratio}px`;
    style.width = `${(base[0] * (right - left)) / ratio}px`;
    style.height = `${(base[3] * (bottom - top)) / ratio}px`;
  }
  for (const [instance, held] of controls) {
    if (!alive.has(instance)) {
      held.element.remove();
      controls.delete(instance);
    }
  }
};

/** An image surface: its `MappedImage` drawn into its box, or a placeholder naming it */
const paintImage = (
  ctx: CanvasRenderingContext2D,
  base: Affine,
  gadget: Gadget,
  [left, top, right, bottom]: Rect,
): void => {
  const name = gadget.imageName?.trim() || gadget.imageMap?.trim() || '';
  const image = mappedImage(name);
  const texture = image && state.textures.get(image.texture);
  const boxed = instanceBox(gadget.instance);
  const [w, h] = image?.extent ?? [right - left, bottom - top];
  const dest: Rect = boxed ?? [left, top, left + w, top + h];
  const [x, y] = [dest[0], dest[1]];
  const [width, height] = [dest[2] - dest[0], dest[3] - dest[1]];

  ctx.save();
  ctx.setTransform(...base);
  if (image && texture) {
    const [u, v, uw, vh] = image.uv;
    const source: Rect = [
      u * texture.width,
      v * texture.height,
      uw * texture.width,
      vh * texture.height,
    ];

    if (image.rotated) {
      ctx.translate(x, y + height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(texture, source[0], source[1], source[2], source[3], 0, 0, height, width);
    } else {
      ctx.drawImage(texture, source[0], source[1], source[2], source[3], x, y, width, height);
    }
  } else {
    ctx.strokeStyle = '#c0c';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1 / base[0];
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = '#c0c';
    ctx.font = `${11 / base[0]}px monospace`;
    ctx.fillText(
      image === null ? `[no MappedImage ${name}]` : `[image ${name || '?'}]`,
      x + 2 / base[0],
      y + 12 / base[0],
    );
  }
  ctx.restore();
};

addRenderHook(sync);
onMappedImages(render);
