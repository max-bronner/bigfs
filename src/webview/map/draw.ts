import { canvas, context } from './elements';
import {
  isStart,
  isWaypoint,
  nameOf,
  projectToCanvas,
  shadeRelief,
  unprojectFromCanvas,
  waypointsById,
} from './mapModel';
import type { HeightsView } from './protocol';
import { state } from './state';
import type { ReliefSurface } from './state';

/** Shades the height map once into an off-screen canvas */
export const buildRelief = (heights: HeightsView): ReliefSurface => {
  const { width, height } = heights;
  const { pixels, low, high } = shadeRelief(heights);
  const image = new ImageData(width, height);
  const surface = document.createElement('canvas');

  image.data.set(pixels);
  surface.width = width;
  surface.height = height;
  surface.getContext('2d')!.putImageData(image, 0, 0);
  return { surface, low, high };
};

/** Converts world units to canvas pixels for the loaded height map */
export const project = (x: number, y: number): [number, number] =>
  projectToCanvas(state.heights!, canvas, x, y);

/** Converts canvas pixels to world units for the loaded height map */
export const unproject = (px: number, py: number): [number, number] =>
  unprojectFromCanvas(state.heights!, canvas, px, py);

const drawBoundary = (heights: HeightsView) => {
  context.strokeStyle = 'rgba(255, 220, 80, 0.9)';
  context.setLineDash([6, 4]);
  for (const [bx, by] of heights.boundaries) {
    const [left, bottom] = project(0, 0);
    const [right, top] = project(bx * 10, by * 10);

    context.strokeRect(left, top, right - left, bottom - top);
  }
  context.setLineDash([]);
};

const drawAreas = () => {
  context.font = '11px sans-serif';
  for (const [areaIndex, area] of state.map.triggerAreas.entries()) {
    if (!area.points.length) {
      continue;
    }
    context.beginPath();
    area.points.forEach(([x, y], index) => {
      const [px, py] = project(x, y);

      if (index) {
        context.lineTo(px, py);
      } else {
        context.moveTo(px, py);
      }
    });
    context.closePath();
    const chosen = state.selectedArea === areaIndex;

    context.fillStyle = chosen
      ? 'rgba(180, 90, 255, 0.32)'
      : 'rgba(180, 90, 255, 0.18)';
    context.strokeStyle = chosen ? '#ffffff' : 'rgba(200, 130, 255, 0.9)';
    context.lineWidth = chosen ? 2 : 1;
    context.fill();
    context.stroke();
    context.lineWidth = 1;
    if (chosen) {
      context.fillStyle = '#ffffff';
      for (const [x, y] of area.points) {
        const [vx, vy] = project(x, y);

        context.fillRect(vx - 3, vy - 3, 6, 6);
      }
    }
    const [cx, cy] = project(
      area.points.reduce((sum, p) => sum + p[0], 0) / area.points.length,
      area.points.reduce((sum, p) => sum + p[1], 0) / area.points.length,
    );

    context.fillStyle = '#e8d4ff';
    context.fillText(
      area.name,
      cx - context.measureText(area.name).width / 2,
      cy,
    );
  }
};

const drawLinks = () => {
  const ids = waypointsById(state.map.objects);
  const chosen =
    state.selected === undefined ? undefined : state.map.objects[state.selected];

  for (const link of state.map.waypointLinks) {
    const from = ids.get(link.from);
    const to = ids.get(link.to);

    if (!from || !to) {
      continue;
    }
    const [ax, ay] = project(from.x, from.y);
    const [bx, by] = project(to.x, to.y);
    const hot = chosen && (chosen === from || chosen === to);

    context.strokeStyle = hot ? '#ffd23f' : 'rgba(63, 169, 255, 0.55)';
    context.fillStyle = context.strokeStyle;
    context.lineWidth = hot ? 2 : 1;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.stroke();
    // An arrowhead half way along says which way the link runs
    const angle = Math.atan2(by - ay, bx - ax);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;

    context.beginPath();
    context.moveTo(mx + Math.cos(angle) * 6, my + Math.sin(angle) * 6);
    context.lineTo(
      mx + Math.cos(angle + 2.5) * 5,
      my + Math.sin(angle + 2.5) * 5,
    );
    context.lineTo(
      mx + Math.cos(angle - 2.5) * 5,
      my + Math.sin(angle - 2.5) * 5,
    );
    context.fill();
    context.lineWidth = 1;
  }
};

const drawObjects = () => {
  for (const object of state.map.objects) {
    const waypoint = isWaypoint(object);
    const start = waypoint && isStart(object);

    if (
      start
        ? !state.layers.starts
        : waypoint
          ? !state.layers.waypoints
          : !state.layers.objects
    ) {
      continue;
    }
    const [px, py] = project(object.x, object.y);
    const selected = state.selected === object.index;

    context.fillStyle = selected
      ? '#ff4040'
      : start
        ? '#ff8c1a'
        : waypoint
          ? '#3fa9ff'
          : 'rgba(30, 30, 30, 0.75)';
    const radius = selected ? 5 : start ? 5 : waypoint ? 2.5 : 2;

    context.beginPath();
    context.arc(px, py, radius, 0, Math.PI * 2);
    context.fill();
    if (start) {
      context.font = '11px sans-serif';
      context.fillStyle = '#fff';
      context.strokeStyle = '#000';
      context.lineWidth = 3;
      const label = nameOf(object).replace(/^Player_(\d+)_Start$/i, 'P$1');

      context.strokeText(label, px + 6, py + 4);
      context.fillText(label, px + 6, py + 4);
      context.lineWidth = 1;
    }
  }
};

const drawDraft = () => {
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.setLineDash([4, 3]);
  context.beginPath();
  state.draft.forEach(([x, y], index) => {
    const [px, py] = project(x, y);

    if (index) {
      context.lineTo(px, py);
    } else {
      context.moveTo(px, py);
    }
  });
  context.stroke();
  context.setLineDash([]);
  for (const [x, y] of state.draft) {
    const [px, py] = project(x, y);

    context.fillRect(px - 3, py - 3, 6, 6);
  }
};

/** Draws the terrain and the layers over it, sized to fit the stage */
export const draw = (): void => {
  const heights = state.heights;
  const relief = state.relief;

  if (!heights || !relief) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const bounds = canvas.parentElement!.getBoundingClientRect();
  const scale = Math.max(
    0.1,
    Math.min(
      (bounds.width - 4) / heights.width,
      (bounds.height - 4) / heights.height,
    ),
  );

  canvas.width = Math.round(heights.width * scale);
  canvas.height = Math.round(heights.height * scale);
  context.imageSmoothingEnabled = true;
  context.drawImage(relief.surface, 0, 0, canvas.width, canvas.height);
  if (state.layers.boundary) {
    drawBoundary(heights);
  }
  if (state.layers.areas) {
    drawAreas();
  }
  if (state.layers.links && state.layers.waypoints) {
    drawLinks();
  }
  drawObjects();
  if (state.mode && state.mode.kind === 'area' && state.draft.length) {
    drawDraft();
  }
};
