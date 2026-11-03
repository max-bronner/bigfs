/** Room the stage's page leaves for a canvas, in CSS pixels */
export interface FitSpace {
  width: number;
  height: number;
}

/** Page chrome around the canvas: the main column's padding, and the toolbars above it */
const HORIZONTAL_CHROME = 24;
const VERTICAL_CHROME = 230;

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;

/** The part of the page that scrolls the canvas, which holds the stage and its overlay wrapper */
interface StageElement {
  closest(selector: string): { clientWidth: number } | null;
}

/**
 * Measures the room for the stage from the page's scrolling column, never
 * from the canvas's own wrapper: that shrinks to fit the canvas, so fitting
 * to it would shrink the canvas again with every render.
 */
export const getFitSpace = (
  stage: StageElement,
  viewportHeight: number,
): FitSpace => ({
  width: (stage.closest('main')?.clientWidth ?? 0) - HORIZONTAL_CHROME,
  height: viewportHeight - VERTICAL_CHROME,
});

/** The zoom that fits an extent, with its margin on each side, into the room */
export const fitZoom = (
  space: FitSpace,
  extentSize: { width: number; height: number },
  margin: number,
): number =>
  Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        space.width / (extentSize.width + 2 * margin),
        space.height / (extentSize.height + 2 * margin),
      ),
    ),
  );
