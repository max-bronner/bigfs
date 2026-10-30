/**
 * Engine gadgets: the clips whose `_type` (or `_Load` template) tell the
 * engine to attach a control - sliders, check boxes, list boxes, combo
 * boxes, text entries, scroll bars, progress bars - or a `MappedImage`
 * surface (`_imageName`). Ported from mint's apt-player and apt-viewer
 * (`gadget.rs`, `host.rs`): a surface is told apart by what its own
 * variables say, never by its movie, name or place, and a `_type` nothing
 * here knows stays a labelled placeholder.
 *
 * mint publishes a gadget's content from the host, keyed by `_Init` and the
 * surface's name. The preview has no host game, so each gadget's value
 * lives in variables of the gadget's own clip (`BINDINGS` below), which the
 * movie can read and the Engine panel can override.
 */

/** Kind of engine surface: a gadget control, a `MappedImage`, or a `_type` nothing here knows */
export type GadgetKind =
  | 'slider'
  | 'checkbox'
  | 'listbox'
  | 'combobox'
  | 'textentry'
  | 'scrollbar'
  | 'progressbar'
  | 'image'
  | 'unknown';

/** The variables a surface names itself with, as the clip holds them */
export interface SurfaceVars {
  type?: string;
  load?: string;
  init?: string;
  windowId?: string;
  imageName?: string;
  imageMap?: string;
  mode?: string;
}

/** Classification of an engine surface, with the label a placeholder or the panel shows */
export interface GadgetInfo extends SurfaceVars {
  kind: GadgetKind;
  label: string;
}

/** A variable a gadget reads and writes on its clip */
export interface Binding {
  name: string;
  /** What the movie holds until something sets it */
  fallback: string | number | boolean;
}

/** `_type` values, lowercased, and `_Load` template stems, by kind */
const NAMES: [GadgetKind, RegExp][] = [
  ['slider', /^(horz|vert)?slider$/],
  ['checkbox', /^checkbox$/],
  ['listbox', /^(scroll)?listbox$/],
  ['combobox', /^combobox$/],
  ['textentry', /^(text|edit)entry$|^editbox$/],
  ['scrollbar', /^(horz|vert)?scrollbar$/],
  ['progressbar', /^progress(bar)?$/],
];

const kindOfName = (name: string | undefined): GadgetKind | undefined => {
  const stem = (name ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.wnd$/i, '')
    .toLowerCase();

  return NAMES.find(([, pattern]) => pattern.test(stem))?.[0];
};

/**
 * Classifies a surface by `_type` first, then the template `_Load` names, then
 * an image (`_imageName`, else `_imageMap`). Anything else with a `_type`
 * is unknown; a clip with none of these is no surface at all.
 */
export const classifySurface = (vars: SurfaceVars): GadgetInfo | undefined => {
  const type = vars.type?.trim();
  const load = vars.load?.trim();
  const image = vars.imageName?.trim() || vars.imageMap?.trim();
  const kind =
    kindOfName(type) ??
    kindOfName(load) ??
    (image ? 'image' : type ? 'unknown' : undefined);

  if (!kind) {
    return undefined;
  }
  return {
    ...vars,
    kind,
    label:
      kind === 'unknown'
        ? `[engine surface: ${type}]`
        : `[${kind}${image && kind === 'image' ? `: ${image}` : ''}]`,
  };
};

/** The variables each kind binds, in the order the Engine panel lists them */
export const BINDINGS: Record<GadgetKind, Binding[]> = {
  slider: [
    { name: '_value', fallback: 0 },
    { name: '_min', fallback: 0 },
    { name: '_max', fallback: 100 },
  ],
  checkbox: [{ name: '_checked', fallback: false }],
  listbox: [
    { name: '_selected', fallback: -1 },
    { name: '_items', fallback: '' },
  ],
  combobox: [
    { name: '_selected', fallback: -1 },
    { name: '_items', fallback: '' },
  ],
  textentry: [{ name: '_text', fallback: '' }],
  scrollbar: [
    { name: '_value', fallback: 0 },
    { name: '_min', fallback: 0 },
    { name: '_max', fallback: 100 },
  ],
  progressbar: [
    { name: '_value', fallback: 0 },
    { name: '_max', fallback: 100 },
  ],
  image: [],
  unknown: [],
};

/** Reads the number a variable holds, or the fallback for anything else, blank strings included */
export const toNumberOr = (value: unknown, fallback: number): number => {
  const n = typeof value === 'string' && !value.trim() ? NaN : Number(value);

  return Number.isFinite(n) ? n : fallback;
};

/** Reads the range of a value-bound gadget, swapped if needed so `min <= max` */
export const getRange = (min: unknown, max: unknown): [number, number] => {
  const low = toNumberOr(min, 0);
  const high = toNumberOr(max, 100);

  return high < low ? [high, low] : [low, high];
};

/** Clamps a value into an inclusive range */
export const clamp = (value: number, [low, high]: [number, number]): number =>
  Math.min(high, Math.max(low, value));

/** Maps a pointer at `x` along a track `width` wide to a whole value in `range` */
export const valueAt = (
  x: number,
  width: number,
  range: [number, number],
): number =>
  width > 0
    ? Math.round(range[0] + clamp(x / width, [0, 1]) * (range[1] - range[0]))
    : range[0];

/** Computes how full a value-bound gadget is, `0..1` */
export const getFillFraction = (value: number, range: [number, number]): number =>
  range[1] > range[0] ? clamp((value - range[0]) / (range[1] - range[0]), [0, 1]) : 0;

/** Splits a list or combo box's `_items` on `|` into its rows */
export const splitItems = (items: unknown): string[] =>
  typeof items === 'string' && items.length ? items.split('|') : [];

/** The default box of a surface with nothing drawn in it, in its own units */
export const DEFAULT_SIZE: Record<GadgetKind, [number, number]> = {
  slider: [120, 16],
  checkbox: [16, 16],
  listbox: [140, 90],
  combobox: [140, 20],
  textentry: [140, 20],
  scrollbar: [16, 90],
  progressbar: [120, 12],
  image: [64, 64],
  unknown: [96, 24],
};
