import type { NumericField } from '../../formats/particles/particleIni';
import { MAX_KEYS } from '../../formats/particles/particleKeys';
import type { KeyKind, KeyValue } from '../../formats/particles/particleKeys';
import { $, library, post, state } from './page';

/**
 * Curves over a particle's life: its colour keys as a gradient, its alpha
 * keys as a band between min and max, and its size as the game grows it
 * (`Size`, then `SizeRate` each frame, damped by `SizeRateDamping`). Keys
 * are dragged in place, added and removed; the end of the size band is
 * dragged to set the rate that reaches it. A drag previews like a slider;
 * adding or removing a key renumbers the keys, so it writes to the INI at
 * once, together with every value pending.
 */

type Part = 'R' | 'G' | 'B' | 'min' | 'max' | 'frame';

/** One key: its values and the field ids that write them */
interface Key {
  values: Partial<Record<Part, number>>;
  ids: Partial<Record<Part, string>>;
  /** Read by the game: the first key, and each after it with a later frame */
  active: boolean;
}

const container = $('curves');
const selected: Record<KeyKind, number> = { Color: 0, Alpha: 0 };
let drag:
  | { apply: (x: number, y: number) => void; canvas: HTMLCanvasElement }
  | undefined;

const fields = (): NumericField[] => state.scene?.fields ?? [];

const valueOf = (field: NumericField) =>
  state.scene?.values[field.id] ?? field.value;

/** The keys of a kind as the block now has them, slider values included */
const keysOf = (kind: KeyKind): Key[] => {
  const keys: Key[] = [];

  for (let index = 1; index <= MAX_KEYS; index++) {
    const own = fields().filter(
      (field) =>
        field.keyword.toLowerCase() === `${kind}${index}`.toLowerCase(),
    );

    if (!own.length) {
      break;
    }

    const key: Key = { values: {}, ids: {}, active: true };

    for (const field of own) {
      key.values[field.part as Part] = valueOf(field);
      key.ids[field.part as Part] = field.id;
    }
    keys.push(key);
  }
  // As the game reads them: a key not later than the one before ends the list
  keys.forEach((key, index) => {
    key.active =
      index === 0 ||
      (keys[index - 1].active &&
        (key.values.frame ?? 0) > (keys[index - 1].values.frame ?? 0));
  });
  return keys;
};

/** A plain field's value, slider value included, or a fallback */
const fieldValue = (keyword: string, part: string, fallback: number) => {
  const field = fields().find(
    (each) =>
      each.keyword.toLowerCase() === keyword.toLowerCase() &&
      each.part === part,
  );

  return field ? { value: valueOf(field), id: field.id } : { value: fallback };
};

const set = (id: string | undefined, value: number) => {
  if (!id || !state.scene || !Number.isFinite(value)) {
    return;
  }
  state.scene.values[id] = value;
  post({ kind: 'set', id, value });
};

const toValue = (kind: KeyKind, key: Key): KeyValue =>
  kind === 'Color'
    ? {
        rgb: [key.values.R ?? 0, key.values.G ?? 0, key.values.B ?? 0],
        frame: key.values.frame ?? 0,
      }
    : {
        min: key.values.min ?? 0,
        max: key.values.max ?? 0,
        frame: key.values.frame ?? 0,
      };

const writeKeys = (kind: KeyKind, keys: Key[]) =>
  post({
    kind: 'keys',
    keyKind: kind,
    keys: keys.map((key) => toValue(kind, key)),
  });

const rootDef = () =>
  state.scene?.root?.kind === 'system'
    ? library.systems.get(state.scene.root.name.toLowerCase())
    : undefined;

/** The frames the graphs span: the longest life, or the last key */
const span = (): number => {
  const def = rootDef();
  const life = fieldValue('Lifetime', 'max', def?.lifetime.high ?? 30).value;
  const lastKey = Math.max(
    0,
    ...(['Color', 'Alpha'] as const).flatMap((kind) =>
      keysOf(kind)
        .filter((key) => key.active)
        .map((key) => key.values.frame ?? 0),
    ),
  );

  return Math.max(1, life, lastKey);
};

/** A channel or alpha value at a frame, held before the first key and after the last */
const sample = (keys: Key[], part: Part, frame: number): number => {
  const active = keys.filter((key) => key.active);

  if (!active.length) {
    return 0;
  }
  for (let index = 0; index < active.length - 1; index++) {
    const a = active[index];
    const b = active[index + 1];
    const fa = a.values.frame ?? 0;
    const fb = b.values.frame ?? 0;

    if (frame < fb) {
      return frame <= fa
        ? (a.values[part] ?? 0)
        : (a.values[part] ?? 0) +
            ((b.values[part] ?? 0) - (a.values[part] ?? 0)) *
              ((frame - fa) / (fb - fa));
    }
  }
  return active[active.length - 1].values[part] ?? 0;
};

/** Size at an age: the start plus each frame's rate, damped */
const sizeAt = (start: number, rate: number, damping: number, age: number) =>
  damping === 1
    ? start + rate * age
    : start + (rate * (1 - damping ** age)) / (1 - damping);

const PAD = 8;

const makeCanvas = (height: number) => {
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(120, container.clientWidth);

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.className = 'curve';

  const ctx = canvas.getContext('2d')!;

  ctx.scale(ratio, ratio);
  return { canvas, ctx, width, height };
};

const frameToX = (frame: number, width: number) =>
  PAD + (frame / span()) * (width - 2 * PAD);
const xToFrame = (x: number, width: number) =>
  ((x - PAD) / (width - 2 * PAD)) * span();

/** Starts a drag on a canvas; `apply` gets canvas coordinates */
const startDrag = (
  canvas: HTMLCanvasElement,
  event: PointerEvent,
  apply: (x: number, y: number) => void,
) => {
  drag = { apply, canvas };
  canvas.setPointerCapture(event.pointerId);
  // Shows the new selection without replacing the canvas being dragged
  renderCurves(true);
};

const attachDrag = (canvas: HTMLCanvasElement) => {
  canvas.addEventListener('pointermove', (event) => {
    if (drag?.canvas === canvas) {
      const box = canvas.getBoundingClientRect();

      drag.apply(event.clientX - box.left, event.clientY - box.top);
    }
  });
  canvas.addEventListener('pointerup', () => {
    drag = undefined;
    renderCurves();
  });
};

/** The frame a key may move to: after the key before it, before the one after */
const clampFrame = (keys: Key[], index: number, frame: number) => {
  if (index === 0) {
    return keys[0].values.frame ?? 0;
  }

  const low = (keys[index - 1].values.frame ?? 0) + 1;
  const next = keys[index + 1];
  const high =
    next?.active && next.values.frame !== undefined
      ? next.values.frame - 1
      : Number.POSITIVE_INFINITY;

  return Math.round(Math.max(low, Math.min(high, frame)));
};

const toHex = (key: Key) =>
  '#' +
  (['R', 'G', 'B'] as const)
    .map((part) =>
      Math.max(0, Math.min(255, Math.round(key.values[part] ?? 0)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

const button = (text: string, title: string, onClick: () => void) => {
  const element = document.createElement('button');

  element.textContent = text;
  element.title = title;
  element.onclick = onClick;
  return element;
};

/** Adds a key after the selected one, halfway to the next, at the curve's value there */
const addKey = (kind: KeyKind) => {
  const keys = keysOf(kind);
  const active = keys.filter((key) => key.active);
  const inactive = keys.filter((key) => !key.active);

  if (active.length >= MAX_KEYS) {
    return;
  }

  const at = Math.min(selected[kind], active.length - 1);
  const here = active[at]?.values.frame ?? 0;
  const next = active[at + 1]?.values.frame;
  const frame =
    next !== undefined
      ? Math.round((here + next) / 2)
      : Math.round(here + Math.max(1, (span() - here) / 2));

  if (next !== undefined && (frame <= here || frame >= next)) {
    return;
  }

  const parts: Part[] = kind === 'Color' ? ['R', 'G', 'B'] : ['min', 'max'];
  const added: Key = {
    values: Object.fromEntries([
      ...parts.map((part) => [part, sample(keys, part, frame)]),
      ['frame', active.length ? frame : 0],
    ]),
    ids: {},
    active: true,
  };
  const result = [...active];

  result.splice(at + 1, 0, added);
  selected[kind] = active.length ? at + 1 : 0;
  // Unread keys stay after the read ones while there is room
  writeKeys(kind, [...result, ...inactive].slice(0, MAX_KEYS));
};

const removeKey = (kind: KeyKind) => {
  const keys = keysOf(kind);
  const index = selected[kind];

  if (!keys[index]) {
    return;
  }
  keys.splice(index, 1);
  // The first key starts at frame 0 whatever it said before
  if (index === 0 && keys[0]) {
    keys[0].values.frame = 0;
  }
  selected[kind] = Math.max(0, index - 1);
  writeKeys(kind, keys);
};

const colourSection = (): HTMLElement[] => {
  const keys = keysOf('Color');
  const { canvas, ctx, width, height } = makeCanvas(36);
  const strip = 22;

  for (let x = PAD; x < width - PAD; x++) {
    const frame = xToFrame(x, width);
    const [r, g, b] = (['R', 'G', 'B'] as const).map((part) =>
      Math.round(sample(keys, part, frame)),
    );

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 1, strip);
  }
  keys.forEach((key, index) => {
    const x = frameToX(key.values.frame ?? 0, width);

    ctx.beginPath();
    ctx.moveTo(x, strip);
    ctx.lineTo(x - 6, height - 1);
    ctx.lineTo(x + 6, height - 1);
    ctx.closePath();
    ctx.fillStyle = key.active ? toHex(key) : '#808080';
    ctx.fill();
    ctx.lineWidth = index === selected.Color ? 2 : 1;
    ctx.strokeStyle = index === selected.Color ? '#ffcc33' : '#000';
    ctx.stroke();
  });
  attachDrag(canvas);
  canvas.addEventListener('pointerdown', (event) => {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const hit = keys.findIndex(
      (key) => Math.abs(frameToX(key.values.frame ?? 0, width) - x) < 7,
    );

    if (hit < 0) {
      return;
    }
    selected.Color = hit;
    startDrag(canvas, event, (dragX) => {
      const now = keysOf('Color');
      const frame = clampFrame(now, hit, xToFrame(dragX, width));

      if (frame !== now[hit].values.frame) {
        set(now[hit].ids.frame, frame);
        renderCurves(true);
      }
    });
  });

  const key = keys[selected.Color];
  const picker = document.createElement('input');
  const frameInput = document.createElement('input');

  picker.type = 'color';
  picker.value = key ? toHex(key) : '#ffffff';
  picker.disabled = !key;
  picker.oninput = () => {
    const now = keysOf('Color')[selected.Color];

    (['R', 'G', 'B'] as const).forEach((part, channel) =>
      set(
        now?.ids[part],
        parseInt(picker.value.slice(1 + channel * 2, 3 + channel * 2), 16),
      ),
    );
    renderCurves(true);
  };
  frameInput.type = 'number';
  frameInput.value = String(key?.values.frame ?? 0);
  frameInput.disabled = !key || selected.Color === 0;
  frameInput.onchange = () => {
    const now = keysOf('Color');

    set(
      now[selected.Color]?.ids.frame,
      clampFrame(now, selected.Color, Number(frameInput.value)),
    );
    renderCurves();
  };

  return [
    heading('Colour'),
    canvas,
    row(
      picker,
      label('frame'),
      frameInput,
      button('+ Key', 'Add a key after the selected one; written at once', () =>
        addKey('Color'),
      ),
      button('− Key', 'Remove the selected key; written at once', () =>
        removeKey('Color'),
      ),
    ),
  ];
};

const alphaSection = (): HTMLElement[] => {
  const keys = keysOf('Alpha');
  const { canvas, ctx, width, height } = makeCanvas(90);
  const toY = (value: number) => PAD + (1 - value) * (height - 2 * PAD);
  const fromY = (y: number) =>
    Math.max(0, Math.min(1, 1 - (y - PAD) / (height - 2 * PAD)));

  grid(ctx, width, height);
  ctx.beginPath();
  for (let x = PAD; x <= width - PAD; x++) {
    ctx.lineTo(x, toY(sample(keys, 'max', xToFrame(x, width))));
  }
  for (let x = width - PAD; x >= PAD; x--) {
    ctx.lineTo(x, toY(sample(keys, 'min', xToFrame(x, width))));
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(160, 200, 255, 0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.9)';
  ctx.stroke();

  const points = keys.flatMap((key, index) =>
    (['min', 'max'] as const).map((part) => ({
      index,
      part,
      x: frameToX(key.values.frame ?? 0, width),
      y: toY(key.values[part] ?? 0),
      active: key.active,
    })),
  );

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, point.index === selected.Alpha ? 5 : 4, 0, 7);
    ctx.fillStyle = point.active
      ? point.part === 'max'
        ? '#fff'
        : '#9cf'
      : '#808080';
    ctx.fill();
    ctx.strokeStyle = point.index === selected.Alpha ? '#ffcc33' : '#000';
    ctx.stroke();
  }
  attachDrag(canvas);
  canvas.addEventListener('pointerdown', (event) => {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const hit = points
      .map((point) => ({
        point,
        distance: Math.hypot(point.x - x, point.y - y),
      }))
      .filter((each) => each.distance < 8)
      .sort((a, b) => a.distance - b.distance)[0]?.point;

    if (!hit) {
      return;
    }
    selected.Alpha = hit.index;
    // Shift moves min and max together
    const together = event.shiftKey;

    startDrag(canvas, event, (dragX, dragY) => {
      const now = keysOf('Alpha');
      const key = now[hit.index];
      const value = Math.round(fromY(dragY) * 100) / 100;
      const frame = clampFrame(now, hit.index, xToFrame(dragX, width));

      if (together) {
        const shift = value - (key.values[hit.part] ?? 0);

        for (const part of ['min', 'max'] as const) {
          set(
            key.ids[part],
            Math.max(0, Math.min(1, (key.values[part] ?? 0) + shift)),
          );
        }
      } else {
        set(key.ids[hit.part], value);
      }
      if (frame !== key.values.frame) {
        set(key.ids.frame, frame);
      }
      renderCurves(true);
    });
  });

  return [
    heading('Alpha', 'shift-drag moves min and max together'),
    canvas,
    row(
      button('+ Key', 'Add a key after the selected one; written at once', () =>
        addKey('Alpha'),
      ),
      button('− Key', 'Remove the selected key; written at once', () =>
        removeKey('Alpha'),
      ),
    ),
  ];
};

const sizeSection = (): HTMLElement[] => {
  const def = rootDef();

  if (!def) {
    return [];
  }

  const range = (keyword: string, fallback: { low: number; high: number }) =>
    [
      fieldValue(keyword, 'min', fallback.low),
      fieldValue(keyword, 'max', fallback.high),
    ] as const;
  const sizes = range('Size', def.size);
  const rates = range('SizeRate', def.sizeRate);
  const dampings = range('SizeRateDamping', def.sizeRateDamping);
  const life = span();
  const curves = [0, 1].map((at) =>
    Array.from({ length: Math.ceil(life) + 1 }, (_, age) =>
      sizeAt(sizes[at].value, rates[at].value, dampings[at].value, age),
    ),
  );
  const top = Math.max(1, ...curves.flat()) * 1.15;
  const { canvas, ctx, width, height } = makeCanvas(90);
  const toY = (value: number) =>
    PAD + (1 - Math.max(0, value) / top) * (height - 2 * PAD);
  const fromY = (y: number) => (1 - (y - PAD) / (height - 2 * PAD)) * top;

  grid(ctx, width, height);
  curves.forEach((curve, at) => {
    ctx.beginPath();
    curve.forEach((value, age) => ctx.lineTo(frameToX(age, width), toY(value)));
    ctx.strokeStyle = at ? '#fff' : '#9cf';
    ctx.stroke();
  });

  // The end of each curve sets the rate that reaches it there
  const handles = [0, 1].map((at) => ({
    at,
    x: frameToX(life, width),
    y: toY(curves[at][curves[at].length - 1]),
    id: rates[at].id,
  }));

  for (const handle of handles.filter((each) => each.id)) {
    ctx.fillStyle = handle.at ? '#fff' : '#9cf';
    ctx.fillRect(handle.x - 4, handle.y - 4, 8, 8);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '10px sans-serif';
  ctx.fillText(top.toFixed(1), 2, 10);
  attachDrag(canvas);
  canvas.addEventListener('pointerdown', (event) => {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const hit = handles.find(
      (handle) => handle.id && Math.hypot(handle.x - x, handle.y - y) < 8,
    );

    if (!hit) {
      return;
    }
    startDrag(canvas, event, (_dragX, dragY) => {
      const end = Math.max(0, fromY(dragY));
      const damping = dampings[hit.at].value;
      const growth =
        damping === 1 ? life : (1 - damping ** life) / (1 - damping);
      const rate = (end - sizes[hit.at].value) / (growth || 1);

      set(hit.id, Math.round(rate * 10000) / 10000);
      renderCurves(true);
    });
  });

  return [
    heading(
      'Size',
      'drag the end of a curve to set its SizeRate; blue min, white max',
    ),
    canvas,
  ];
};

const grid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  ctx.fillStyle = 'rgba(24, 24, 24, 0.9)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let tenth = 0; tenth <= 10; tenth++) {
    const x = PAD + (tenth / 10) * (width - 2 * PAD);

    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
};

const heading = (text: string, hint?: string): HTMLElement => {
  const element = document.createElement('div');

  element.className = 'curve-heading';
  element.textContent = text;
  if (hint) {
    const muted = document.createElement('span');

    muted.className = 'muted';
    muted.textContent = ` ${hint}`;
    element.append(muted);
  }
  return element;
};

const label = (text: string) => {
  const element = document.createElement('span');

  element.textContent = text;
  return element;
};

const row = (...children: HTMLElement[]) => {
  const element = document.createElement('div');

  element.className = 'row';
  element.append(...children);
  return element;
};

/**
 * Draws the curves of the previewed system; empty for an FX list. During
 * a drag only the canvases are redrawn, so the drag survives.
 */
export const renderCurves = (dragging = false): void => {
  if (!rootDef()) {
    container.replaceChildren();
    return;
  }
  if (drag && !dragging) {
    return;
  }

  const sections = [...colourSection(), ...alphaSection(), ...sizeSection()];

  if (dragging && drag) {
    // Swap only the canvases, keeping the one being dragged in place
    const old = [...container.querySelectorAll('canvas')];
    const fresh = sections.filter(
      (each): each is HTMLCanvasElement => each instanceof HTMLCanvasElement,
    );

    old.forEach((canvas, index) => {
      if (canvas === drag!.canvas && fresh[index]) {
        canvas.getContext('2d')!.setTransform(1, 0, 0, 1, 0, 0);
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
        canvas.getContext('2d')!.drawImage(fresh[index], 0, 0);
      } else if (fresh[index]) {
        canvas.replaceWith(fresh[index]);
      }
    });
    return;
  }
  container.replaceChildren(
    heading('Over lifetime', 'frames along, as the game steps them'),
    ...sections,
  );
};
