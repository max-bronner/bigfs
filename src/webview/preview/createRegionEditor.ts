import type { Box } from '../shared/pickBox';
import { createRegionLayer } from './regionLayer';
import { createRegionPanel } from './regionPanel';
import type { FromPreviewPage, RegionsMessage } from './protocol';

/** The region editor's hold on the page: the layer over the texture and the panel beside it */
export interface RegionEditor {
  /** Puts the layer over the stage of a newly shown texture and forgets the old regions */
  mount(stage: HTMLElement): void;
  /** Shows the regions the extension found */
  show(message: RegionsMessage): void;
  /** Fits the layer to the texture's on-screen size after a zoom */
  fit(cssWidth: number, cssHeight: number, pixelWidth: number): void;
}

/**
 * Creates the editor of the regions of a texture: boxes drawn over it, the
 * panel that lists them, and the edits both send back to the extension,
 * which writes them into the file that defines the region.
 */
export const createRegionEditor = (
  panelRoot: HTMLElement,
  post: (message: FromPreviewPage) => void,
): RegionEditor => {
  let content: RegionsMessage = { kind: 'regions', regions: [] };

  const select = (id: string) => {
    content = { ...content, selected: id };
    render();
  };
  const edit = (id: string, rect: Box) => {
    // Shown at once; the extension answers with what it wrote
    content = {
      ...content,
      regions: content.regions.map((region) =>
        region.id === id ? { ...region, rect } : region,
      ),
    };
    render();
    post({ kind: 'editRegion', id, rect });
  };
  const layer = createRegionLayer({ onSelect: select, onEdit: edit });
  const show = createRegionPanel(panelRoot, {
    onSelect: select,
    onEdit: edit,
    onReveal: ({ uri, line }) => post({ kind: 'reveal', uri, line }),
  });

  function render() {
    layer.setRegions(content.regions, content.selected);
    show(content);
  }

  return {
    mount(stage) {
      content = { kind: 'regions', regions: [] };
      stage.append(layer.element);
      render();
    },
    show(message) {
      content = message;
      render();
    },
    fit: layer.fit,
  };
};
