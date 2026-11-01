import { findPointerTargetAt } from './hitTest';
import type { Instance } from './instance';
import type { Player } from './player';
import type { HitArea } from './scene';

/** A tool that can take the pointer before the stage picks, and draw on top */
export interface StageTool {
  /** Offers a press; true when the tool takes the drag that follows */
  down(point: [number, number], event: MouseEvent): boolean;
  /** Takes a move while it holds the pointer */
  move(point: [number, number], event: MouseEvent): boolean;
  /** Ends the drag the tool holds the pointer for */
  up(): void;
  /** Draws in the shown character's space, `pixel` wide lines */
  draw(ctx: CanvasRenderingContext2D, pixel: number): void;
  /** The cursor over a point, when the tool has one */
  cursor(point: [number, number]): string | undefined;
}

/** What the pointer needs of the stage it moves over */
export interface StagePointerHost {
  tools: readonly StageTool[];
  /** Whether the pointer drives the buttons rather than the inspector */
  isInteractive(): boolean;
  hasMovie(): boolean;
  getPlayer(): Player;
  getHits(): readonly HitArea[];
  pointAt(event: MouseEvent): [number, number];
  findInstanceAt(point: [number, number], deep?: boolean): Instance | undefined;
  inspect(instance: Instance | undefined): void;
  render(): void;
}

/** The stage's pointer: what it hovers, and when to look again */
export interface StagePointer {
  getHovered(): Instance | undefined;
  /** Forgets what the pointer was on, for a player starting over */
  reset(): void;
  /**
   * Picks again after a played frame, but only once nothing stays hovered, so
   * a button appearing over the hovered one waits for the pointer to move
   * (mint's `idle_pointer`). Returns whether the hover changed.
   */
  updateAfterFrame(): boolean;
}

/** Listens to the pointer on the stage's canvas for as long as the page lives */
export const attachStagePointer = (
  canvas: HTMLCanvasElement,
  host: StagePointerHost,
): StagePointer => {
  let hovered: Instance | undefined;
  let pressed: Instance | undefined;
  let isDown = false;
  /** Where the pointer last was, in the shown character's space */
  let pointer: [number, number] | undefined;
  /** The tool that holds the pointer, while a drag lasts */
  let holder: StageTool | undefined;

  const updateHover = (point: [number, number]): boolean => {
    const next = findPointerTargetAt(host.getHits(), point);

    canvas.style.cursor = next ? 'pointer' : 'default';
    if (next === hovered) {
      return false;
    }
    host.getPlayer().hover(hovered, next, isDown);
    hovered = next;
    return true;
  };

  const inspectAt = (point: [number, number]) => {
    const next = host.findInstanceAt(point);

    canvas.style.cursor =
      host.tools.map((each) => each.cursor(point)).find(Boolean) ?? 'default';
    if (next !== hovered) {
      hovered = next;
      canvas.title = next ? next.path || 'the shown character' : '';
      host.render();
    }
  };

  canvas.addEventListener('mousemove', (event) => {
    if (!host.hasMovie()) {
      return;
    }

    const point = host.pointAt(event);

    if (!host.isInteractive() && holder?.move(point, event)) {
      return;
    }

    pointer = point;
    if (!host.isInteractive()) {
      inspectAt(point);
    } else if (updateHover(point)) {
      host.render();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (host.isInteractive() && hovered) {
      host.getPlayer().hover(hovered, undefined, isDown);
    }
    hovered = undefined;
    pointer = undefined;
    if (host.hasMovie()) {
      host.render();
    }
  });

  canvas.addEventListener('mousedown', (event) => {
    if (!host.hasMovie()) {
      return;
    }

    const point = host.pointAt(event);

    pointer = point;
    if (host.isInteractive()) {
      updateHover(point);
      isDown = true;
      pressed = hovered;
      if (hovered) {
        host.getPlayer().press(hovered);
      }
      host.render();
      return;
    }

    holder = host.tools.find((each) => each.down(point, event));
    if (!holder) {
      // A click picks what the shown timeline places; a double click reaches inside
      host.inspect(host.findInstanceAt(point, event.detail >= 2));
    }
  });

  window.addEventListener('mouseup', () => {
    holder?.up();
    holder = undefined;
    if (!isDown || !host.isInteractive()) {
      isDown = false;
      return;
    }
    isDown = false;
    if (pressed) {
      host.getPlayer().release(pressed, hovered);
      pressed = undefined;
    }
    host.render();
  });

  return {
    getHovered: () => hovered,
    reset: () => {
      hovered = undefined;
      pressed = undefined;
      isDown = false;
    },
    updateAfterFrame: () =>
      host.isInteractive() &&
      !!pointer &&
      (!hovered || !!hovered.removed || hovered.visible === false) &&
      updateHover(pointer),
  };
};
