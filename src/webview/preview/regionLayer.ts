import { drawBoxHandles, HANDLE_RADIUS } from '../shared/drawBoxHandles';
import { getResizeScale } from '../shared/getResizeScale';
import { pickBox } from '../shared/pickBox';
import type { Box, BoxGrab } from '../shared/pickBox';
import type { TextureRegion } from './protocol';

/**
 * A transparent canvas over the shown texture that draws every region as a
 * box. The selected region, when it can be edited, is moved by dragging
 * inside it and resized by its corners; a press on another box selects it.
 * Boxes are in pixels of the finest level and are drawn at the texture's
 * on-screen scale.
 */

interface Drag {
  grab: BoxGrab;
  start: readonly [number, number];
  original: Box;
}

/** What the layer reports back to the page */
export interface RegionLayerEvents {
  onSelect(id: string): void;
  /** The selected region's box was released after a drag, in whole pixels */
  onEdit(id: string, rect: Box): void;
}

/** The layer's element and the calls that change what it draws */
export interface RegionLayer {
  element: HTMLCanvasElement;
  /** Replaces the regions drawn and which one is selected */
  setRegions(regions: readonly TextureRegion[], selected?: string): void;
  /** Resizes the layer to the texture's on-screen size, `pixelWidth` being the finest level's width */
  fit(cssWidth: number, cssHeight: number, pixelWidth: number): void;
}

const SELECTED_COLOR = 'rgba(30, 140, 255, 1)';
const OTHER_COLOR = 'rgba(255, 190, 40, 0.9)';

const toBox = (rect: TextureRegion['rect']): Box => [...rect];

const area = ([left, top, right, bottom]: Box) =>
  Math.abs(right - left) * Math.abs(bottom - top);

/** Creates the layer; put `element` over the texture's canvas */
export const createRegionLayer = (events: RegionLayerEvents): RegionLayer => {
  const element = document.createElement('canvas');
  const ctx = element.getContext('2d')!;
  let regions: readonly TextureRegion[] = [];
  let selected: string | undefined;
  let scale = 1;
  let drag: Drag | undefined;
  let dragged: Box | undefined;

  element.style.cssText = 'position:absolute;left:0;top:0;';

  const boxOf = (region: TextureRegion): Box =>
    region.id === selected && dragged ? dragged : toBox(region.rect);

  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, element.width, element.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // The selected box last, so it lies over the others
    const ordered = [...regions].sort(
      (a, b) => Number(a.id === selected) - Number(b.id === selected),
    );

    for (const region of ordered) {
      const [left, top, right, bottom] = boxOf(region);
      const isSelected = region.id === selected;

      ctx.strokeStyle = isSelected ? SELECTED_COLOR : OTHER_COLOR;
      ctx.lineWidth = (isSelected ? 2 : 1) / scale;
      ctx.setLineDash(region.rotated ? [4 / scale, 3 / scale] : []);
      ctx.strokeRect(left, top, right - left, bottom - top);
      if (isSelected) {
        ctx.fillStyle = 'rgba(30, 140, 255, 0.14)';
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.setLineDash([]);
        ctx.lineWidth = 1 / scale;
        if (region.editable) {
          drawBoxHandles(ctx, [left, top, right, bottom], scale);
        }
      }
    }
  };

  const pointOn = (event: MouseEvent): [number, number] => [
    event.offsetX / scale,
    event.offsetY / scale,
  ];

  const selectedRegion = () => regions.find((each) => each.id === selected);

  const grabAt = (point: [number, number]) => {
    const region = selectedRegion();

    return region?.editable
      ? pickBox(boxOf(region), point, (HANDLE_RADIUS + 2) / scale)
      : undefined;
  };

  /** The smallest box under the point, so a region inside a larger one can still be picked */
  const regionAt = (point: [number, number]) =>
    regions
      .filter((region) => {
        const [left, top, right, bottom] = toBox(region.rect);

        return (
          point[0] >= left &&
          point[0] <= right &&
          point[1] >= top &&
          point[1] <= bottom
        );
      })
      .sort((a, b) => area(toBox(a.rect)) - area(toBox(b.rect)))[0];

  const resized = (
    { grab, start, original }: Drag,
    point: [number, number],
  ): Box => {
    if (grab === 'move') {
      const dx = point[0] - start[0];
      const dy = point[1] - start[1];

      return [original[0] + dx, original[1] + dy, original[2] + dx, original[3] + dy];
    }

    const [sx, sy] = getResizeScale(grab, point, false);
    const [ax, ay] = grab.anchor;
    const handle: [number, number] = [
      ax + (grab.handle[0] - ax) * sx,
      ay + (grab.handle[1] - ay) * sy,
    ];

    return [
      Math.min(ax, handle[0]),
      Math.min(ay, handle[1]),
      Math.max(ax, handle[0]),
      Math.max(ay, handle[1]),
    ];
  };

  element.onmousedown = (event) => {
    const point = pointOn(event);
    const grab = grabAt(point);
    const region = selectedRegion();

    if (grab && region) {
      drag = { grab, start: point, original: toBox(region.rect) };
      return;
    }

    const hit = regionAt(point);

    if (hit && hit.id !== selected) {
      events.onSelect(hit.id);
    }
  };

  element.onmousemove = (event) => {
    const point = pointOn(event);

    if (drag) {
      dragged = resized(drag, point);
      draw();
      return;
    }

    const grab = grabAt(point);

    element.style.cursor = !grab
      ? regionAt(point)
        ? 'pointer'
        : 'default'
      : grab === 'move'
        ? 'move'
        : 'nwse-resize';
  };

  window.addEventListener('mouseup', () => {
    if (drag && dragged && selected) {
      const [left, top, right, bottom] = dragged;

      events.onEdit(selected, [
        Math.round(left),
        Math.round(top),
        Math.round(right),
        Math.round(bottom),
      ]);
    }
    drag = undefined;
    dragged = undefined;
  });

  return {
    element,
    setRegions(next, nextSelected) {
      regions = next;
      selected = nextSelected;
      drag = undefined;
      dragged = undefined;
      draw();
    },
    fit(cssWidth, cssHeight, pixelWidth) {
      element.width = Math.max(1, Math.round(cssWidth));
      element.height = Math.max(1, Math.round(cssHeight));
      element.style.width = `${cssWidth}px`;
      element.style.height = `${cssHeight}px`;
      scale = cssWidth / pixelWidth;
      draw();
    },
  };
};
