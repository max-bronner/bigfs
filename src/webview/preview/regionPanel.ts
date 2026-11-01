import { element } from '../shared/element';
import type { Box } from '../shared/pickBox';
import type { TextureRegion } from './protocol';

/**
 * The side panel beside a texture: the regions other files use, grouped by
 * what uses them, and the selected one's edges as numbers to type. Dashed
 * boxes on the texture are rotated images, packed turned a quarter turn.
 */

/** What the panel reports back to the page */
export interface RegionPanelEvents {
  onSelect(id: string): void;
  onEdit(id: string, rect: Box): void;
  onReveal(source: NonNullable<TextureRegion['source']>): void;
}

/** What the panel shows: the regions found, the selected one, and whether the search goes on */
export interface RegionPanelContent {
  regions: readonly TextureRegion[];
  selected?: string;
  loading?: boolean;
}

const EDGES = ['Left', 'Top', 'Right', 'Bottom'] as const;

/** Builds the numbers that edit a region's edges; each change is sent whole */
const createEdgeFields = (
  region: TextureRegion,
  onEdit: RegionPanelEvents['onEdit'],
): HTMLElement => {
  const fields = element('div', undefined, 'edges');
  const inputs = EDGES.map((edge, at) => {
    const input = element('input');

    input.type = 'number';
    input.step = '1';
    input.value = String(Math.round(region.rect[at]));
    input.disabled = !region.editable;
    input.title = edge;
    input.onchange = () => {
      const rect = inputs.map((each) => Number(each.value)) as Box;

      if (rect.every(Number.isFinite)) {
        onEdit(region.id, rect);
      }
    };
    fields.append(element('label', edge), input);

    return input;
  });

  return fields;
};

/** Creates the panel inside `root`, which stays hidden until there is something to show */
export const createRegionPanel = (
  root: HTMLElement,
  events: RegionPanelEvents,
): ((content: RegionPanelContent) => void) => {
  return ({ regions, selected, loading }) => {
    root.hidden = !regions.length && !loading;

    const chosen = regions.find((region) => region.id === selected);
    const parts: HTMLElement[] = [
      element(
        'h3',
        `References (${regions.length})${loading ? ' · searching…' : ''}`,
      ),
    ];

    if (chosen) {
      const detail = element('div', undefined, 'detail');

      detail.append(
        element('strong', chosen.label),
        createEdgeFields(chosen, events.onEdit),
      );
      if (chosen.rotated) {
        detail.append(
          element(
            'p',
            'Packed turned a quarter turn clockwise: the box is the rect as packed.',
          ),
        );
      }
      if (chosen.note) {
        detail.append(element('p', chosen.note));
      }
      if (chosen.source) {
        const { source } = chosen;
        const open = element('button', 'Open definition');

        open.onclick = () => events.onReveal(source);
        detail.append(open);
      }
      parts.push(detail);
    }

    const groups = new Map<string, TextureRegion[]>();

    for (const region of regions) {
      groups.set(region.group, [...(groups.get(region.group) ?? []), region]);
    }
    for (const [group, members] of groups) {
      const list = element('div', undefined, 'group');

      list.append(element('h4', `${group} (${members.length})`));
      for (const region of members) {
        const item = element('button', region.label, 'item');

        item.setAttribute('aria-pressed', String(region.id === selected));
        item.onclick = () => events.onSelect(region.id);
        list.append(item);
      }
      parts.push(list);
    }

    root.replaceChildren(...parts);
  };
};
