import {
  DEFAULT_SIZE,
  getFillFraction,
  splitItems,
  toNumberOr,
  getRange,
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
import { onMappedImages } from './mappedSurfaces';
import type { Affine } from './scene';
import { multiply } from './scene';
import { addRenderHook, currentPlayer, measureInstanceBox, render } from './stage';
import { state } from './state';
import { onRenderObjects } from './view3dSurface';

/**
 * Gadgets on the stage: interactive controls laid over the canvas for
 * sliders, check boxes, list and combo boxes, text entries, scroll bars and
 * progress bars, drawn at the box their clip covers (or a default size when
 * it draws nothing). Images and `View3D` models are the stage's to paint, in
 * paint order (`imageSurface.ts`, `view3dSurface.ts`). A `_type` nothing here
 * knows is a labelled placeholder. Ported from mint's apt-viewer; what each
 * control reads and writes is `BINDINGS`.
 */

const stage = byId<HTMLCanvasElement>('stage');
const layer = document.createElement('div');
const wrap = document.createElement('div');

wrap.style.cssText = 'position:relative;display:inline-block;line-height:0';
layer.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
stage.replaceWith(wrap);
wrap.append(stage, layer);

/** Gets the gadgets of the shown run; the Engine panel lists these too */
export const currentGadgets = (): Gadget[] =>
  state.movie ? findGadgets(currentPlayer()) : [];

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
  const drawn = measureInstanceBox(gadget.instance);

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
          const [low, high] = getRange(value(g, '_min'), value(g, '_max'));

          range.min = String(low);
          range.max = String(high);
          range.value = String(toNumberOr(value(g, '_value'), low));
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
          const items = splitItems(value(g, '_items'));

          select.replaceChildren(
            ...items.map((item, at) => new Option(item, String(at))),
          );
          select.selectedIndex = Math.min(
            items.length - 1,
            toNumberOr(value(g, '_selected'), -1),
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
          const range = getRange(0, value(g, '_max'));

          bar.max = range[1] || 1;
          bar.value = getFillFraction(toNumberOr(value(g, '_value'), 0), range) * bar.max;
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

const sync = (_ctx: CanvasRenderingContext2D, base: Affine): void => {
  const ratio = window.devicePixelRatio || 1;
  const all = currentGadgets();
  const alive = new Set<Gadget['instance']>();

  layer.style.width = `${stage.width / ratio}px`;
  layer.style.height = `${stage.height / ratio}px`;

  for (const gadget of all) {
    if (gadget.kind === 'view3d' || gadget.kind === 'image') {
      continue;
    }

    const [left, top, right, bottom] = boxOf(gadget);

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

addRenderHook(sync);
onMappedImages(render);
onRenderObjects(render);
