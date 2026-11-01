import { element } from '../shared/element';
import type { Box } from '../shared/pickBox';
import type { TextureRegion } from './protocol';

/**
 * The side panel beside a texture: the regions other files use, grouped by
 * what uses them and filtered by what is typed, and the selected one's edges
 * as numbers to type. Dashed boxes on the texture are rotated images, packed
 * turned a quarter turn.
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

/** More regions than this get a filter box */
const FILTER_FROM = 12;

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

/** Builds the selected region's details: its edges, what to know about it, and a way to its definition */
const createDetail = (
  region: TextureRegion,
  events: RegionPanelEvents,
): HTMLElement => {
  const detail = element('div', undefined, 'detail');

  detail.append(element('strong', region.label), createEdgeFields(region, events.onEdit));
  if (region.rotated) {
    detail.append(
      element(
        'p',
        'Drawn dashed: turned. The box is the rect as the file stores it.',
      ),
    );
  }
  if (region.note) {
    detail.append(element('p', region.note));
  }
  if (region.source) {
    const { source } = region;
    const open = element('button', 'Open definition');

    open.onclick = () => events.onReveal(source);
    detail.append(open);
  }
  return detail;
};

/** Creates the panel inside `root`, which stays hidden until there is a region to show */
export const createRegionPanel = (
  root: HTMLElement,
  events: RegionPanelEvents,
): ((content: RegionPanelContent) => void) => {
  const heading = element('h3');
  const filter = element('input');
  const detail = element('div');
  const list = element('div');
  let last: RegionPanelContent = { regions: [] };

  filter.type = 'search';
  filter.placeholder = 'Filter references';
  root.replaceChildren(heading, filter, detail, list);

  const render = ({ regions, selected, loading }: RegionPanelContent) => {
    const wanted = filter.value.trim().toLowerCase();
    const shown = regions
      .filter((region) => region.label.toLowerCase().includes(wanted))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }),
      );
    const chosen = regions.find((region) => region.id === selected);
    const groups = new Map<string, TextureRegion[]>();

    root.hidden = !regions.length;
    heading.textContent = `References (${regions.length})${loading ? ' · searching…' : ''}`;
    filter.hidden = regions.length < FILTER_FROM;
    detail.replaceChildren(...(chosen ? [createDetail(chosen, events)] : []));
    for (const region of shown) {
      groups.set(region.group, [...(groups.get(region.group) ?? []), region]);
    }
    list.replaceChildren(
      ...[...groups].map(([group, members]) => {
        const section = element('div', undefined, 'group');

        section.append(element('h4', `${group} (${members.length})`));
        for (const region of members) {
          const item = element('button', region.label, 'item');

          item.setAttribute('aria-pressed', String(region.id === selected));
          item.onclick = () => events.onSelect(region.id);
          section.append(item);
        }
        return section;
      }),
    );
    list
      .querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  };

  filter.oninput = () => render(last);

  return (content) => {
    last = content;
    render(content);
  };
};
