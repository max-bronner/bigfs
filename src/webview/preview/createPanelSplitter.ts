import { element } from '../shared/element';

/** Narrowest and widest the panel is dragged to, the widest as a share of the window */
const MIN_WIDTH = 180;
const MAX_SHARE = 0.7;

/** What the splitter reports back to the page */
export interface PanelSplitterEvents {
  /** The panel was given a new width by a drag */
  onResize(width: number): void;
}

/**
 * Creates the bar between the texture and the references panel, which
 * resizes the panel when dragged, and puts it before `panel`. Returns a
 * function that gives the panel a width.
 */
export const createPanelSplitter = (
  panel: HTMLElement,
  events: PanelSplitterEvents,
): ((width: number) => void) => {
  const bar = element('div', undefined, 'splitter');

  const setWidth = (width: number) => {
    const widest = Math.max(MIN_WIDTH, window.innerWidth * MAX_SHARE);

    panel.style.width = `${Math.min(Math.max(MIN_WIDTH, width), widest)}px`;
  };

  bar.title = 'Drag to resize the references';
  bar.onpointerdown = (down) => {
    bar.setPointerCapture(down.pointerId);
    bar.onpointermove = (move) => {
      setWidth(panel.getBoundingClientRect().right - move.clientX);
    };
    bar.onpointerup = () => {
      bar.onpointermove = null;
      bar.onpointerup = null;
      events.onResize(panel.getBoundingClientRect().width);
    };
  };
  panel.before(bar);
  new MutationObserver(() => {
    bar.hidden = panel.hidden;
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  bar.hidden = panel.hidden;

  return setWidth;
};
