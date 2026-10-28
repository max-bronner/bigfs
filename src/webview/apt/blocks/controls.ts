import type { PlacementChange } from '../../../formats/apt/aptWriter';
import { describeCharacter } from '../describeCharacter';
import { movie } from '../state';
import {
  cssColour,
  hexColour,
  matchesSearch,
  parseHexColour,
} from './blockModel';

/**
 * The typed inputs of a block: a number, a colour with its swatch, flag
 * toggles, a character picker with search. Each commits one value when
 * the user is done with it, so one change is one undo step.
 */

/** A labelled field of a block; the label sits left and the controls wrap */
export const field = (label: string, ...controls: Node[]): HTMLDivElement => {
  const element = document.createElement('div');
  const name = document.createElement('label');

  element.className = 'bk-field';
  name.textContent = label;
  element.append(name, ...controls);
  return element;
};

/** A subheading inside a block's body */
export const section = (title: string): HTMLDivElement => {
  const element = document.createElement('div');

  element.className = 'bk-section';
  element.textContent = title;
  return element;
};

export const text = (value: string, title?: string): HTMLSpanElement => {
  const element = document.createElement('span');

  element.className = 'bk-text';
  element.textContent = value;
  if (title) {
    element.title = title;
  }
  return element;
};

export const action = (
  label: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement => {
  const element = document.createElement('button');

  element.className = 'bk-button';
  element.textContent = label;
  element.onclick = onClick;
  if (title) {
    element.title = title;
  }
  return element;
};

/** A number committed on change; a value that is not a number is marked and kept out */
export const numberField = (
  value: number | undefined,
  onCommit: (value: number) => void,
  title?: string,
  width?: 'short',
): HTMLInputElement => {
  const element = document.createElement('input');

  element.type = 'text';
  element.inputMode = 'decimal';
  element.className = 'bk-input bk-number' + (width ? ' short' : '');
  element.value = value === undefined ? '' : String(value);
  if (title) {
    element.title = title;
  }
  element.onchange = () => {
    const parsed = Number(element.value.trim());

    if (element.value.trim() === '' || !Number.isFinite(parsed)) {
      element.classList.add('invalid');
      return;
    }
    element.classList.remove('invalid');
    onCommit(parsed);
  };
  element.onkeydown = (event) => {
    const step =
      event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;

    if (!step || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const current = Number(element.value);

    if (Number.isFinite(current)) {
      event.preventDefault();
      event.stopPropagation();
      element.value = String(
        Math.round((current + step * (event.shiftKey ? 10 : 1)) * 1e6) / 1e6,
      );
      element.dispatchEvent(new Event('change'));
    }
  };
  return element;
};

/** A line of text committed on change */
export const textField = (
  value: string,
  onCommit: (value: string) => void,
  placeholder?: string,
): HTMLInputElement => {
  const element = document.createElement('input');

  element.type = 'text';
  element.className = 'bk-input bk-line';
  element.value = value;
  if (placeholder) {
    element.placeholder = placeholder;
  }
  element.onchange = () => onCommit(element.value);
  return element;
};

/** A packed 32-bit word shown as hex */
export const hexField = (
  value: number,
  onCommit: (value: number) => void,
): HTMLInputElement => {
  const element = document.createElement('input');

  element.type = 'text';
  element.className = 'bk-input bk-hex';
  element.value = '0x' + (value >>> 0).toString(16).padStart(8, '0');
  element.onchange = () => {
    const parsed = parseInt(element.value.trim().replace(/^0x/i, ''), 16);

    if (!Number.isFinite(parsed)) {
      element.classList.add('invalid');
      return;
    }
    element.classList.remove('invalid');
    onCommit(parsed >>> 0);
  };
  return element;
};

/**
 * A colour as a swatch, a native picker for RGB and one number per channel
 * (bytes, 0 to 255, R G B A). The whole colour commits at once.
 */
export const colourField = (
  channels: readonly [number, number, number, number],
  onCommit: (channels: [number, number, number, number]) => void,
): HTMLSpanElement => {
  const element = document.createElement('span');
  const swatch = document.createElement('span');
  const picker = document.createElement('input');
  const current = [...channels] as [number, number, number, number];
  const paint = () => {
    swatch.style.setProperty(
      '--bk-swatch',
      cssColour(current[0], current[1], current[2], current[3]),
    );
    picker.value = hexColour(current[0], current[1], current[2]);
  };
  const inputs = current.map((value, index) => {
    const each = numberField(
      value,
      (next) => {
        current[index] = Math.max(0, Math.min(255, Math.round(next)));
        each.value = String(current[index]);
        paint();
        onCommit([...current] as [number, number, number, number]);
      },
      'RGBA'[index] + ', 0 to 255',
      'short',
    );

    return each;
  });

  element.className = 'bk-colour';
  swatch.className = 'bk-swatch';
  picker.type = 'color';
  picker.className = 'bk-picker';
  picker.title = 'Pick the colour; alpha is the A box';
  picker.onchange = () => {
    const rgb = parseHexColour(picker.value);

    if (rgb) {
      current.splice(0, 3, ...rgb);
      rgb.forEach((byte, index) => (inputs[index].value = String(byte)));
      paint();
      onCommit([...current] as [number, number, number, number]);
    }
  };
  swatch.append(picker);
  paint();
  element.append(swatch, ...inputs);
  return element;
};

/** One toggle per named bit of a word; a change commits the whole word */
export const flagToggles = (
  names: [string, number][],
  value: number,
  onCommit: (value: number) => void,
  isLocked: (bit: number) => boolean = () => false,
): HTMLSpanElement => {
  const element = document.createElement('span');
  let word = value >>> 0;

  element.className = 'bk-flags';
  element.setAttribute('role', 'group');
  for (const [name, bit] of names) {
    const toggle = document.createElement('button');

    toggle.className = 'bk-flag';
    toggle.textContent = name;
    toggle.setAttribute('aria-pressed', String((word & bit) !== 0));
    toggle.disabled = isLocked(bit);
    toggle.onclick = () => {
      word = (word ^ bit) >>> 0;
      toggle.setAttribute('aria-pressed', String((word & bit) !== 0));
      onCommit(word);
    };
    element.append(toggle);
  }
  return element;
};

/**
 * A character picker: a button showing the choice that opens a list with a
 * search box, filtered as it is typed; arrows and Enter choose.
 */
export const characterPicker = (
  chosen: number | undefined,
  onCommit: (id: number) => void,
): HTMLSpanElement => {
  const element = document.createElement('span');
  const trigger = document.createElement('button');
  const characters = movie().characters;
  const label = (id: number | undefined) =>
    id === undefined
      ? '—'
      : characters[id]
        ? describeCharacter(characters[id])
        : `#${id} (none)`;
  let popup: HTMLDivElement | undefined;

  element.className = 'bk-picker-box';
  trigger.className = 'bk-pick';
  trigger.textContent = label(chosen);
  trigger.title = 'Choose a character';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const close = () => {
    popup?.remove();
    popup = undefined;
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (event: MouseEvent) => {
    if (popup && !element.contains(event.target as Node)) {
      close();
    }
  };
  const open = () => {
    const search = document.createElement('input');
    const list = document.createElement('div');
    let shown: number[] = [];
    let active = 0;

    popup = document.createElement('div');
    popup.className = 'bk-popup';
    search.className = 'bk-input bk-search';
    search.placeholder = 'Search characters';
    list.setAttribute('role', 'listbox');

    const paint = () => {
      shown = characters
        .filter((each) => matchesSearch(describeCharacter(each), search.value))
        .map((each) => each.id);
      active = Math.max(0, Math.min(active, shown.length - 1));
      list.replaceChildren(
        ...shown.map((id, index) => {
          const option = document.createElement('div');

          option.className = 'bk-option' + (index === active ? ' active' : '');
          option.setAttribute('role', 'option');
          option.textContent = describeCharacter(characters[id]);
          option.onmousedown = (event) => {
            event.preventDefault();
            pick(id);
          };
          return option;
        }),
      );
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    const pick = (id: number) => {
      close();
      trigger.textContent = label(id);
      trigger.focus();
      onCommit(id);
    };

    search.oninput = () => {
      active = 0;
      paint();
    };
    search.onkeydown = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        active += event.key === 'ArrowDown' ? 1 : -1;
        paint();
      } else if (event.key === 'Enter' && shown.length) {
        pick(shown[active]);
      } else if (event.key === 'Escape') {
        close();
        trigger.focus();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    popup.append(search, list);
    element.append(popup);
    document.addEventListener('mousedown', outside, true);
    paint();
    search.focus();
  };

  trigger.onclick = () => (popup ? close() : open());
  element.append(trigger);
  return element;
};

/** The change a colour field makes to a placement's multiply or add term */
export const placementColour = (
  term: 'colorTransform' | 'colorAdd',
  word: number,
  onChange: (change: PlacementChange) => void,
): HTMLSpanElement => {
  // Memory order R, G, B, A for the multiply term; the add term is 0x00RRGGBB with A on top
  const shifts = term === 'colorTransform' ? [0, 8, 16, 24] : [16, 8, 0, 24];

  return colourField(
    shifts.map((shift) => (word >>> shift) & 255) as [
      number,
      number,
      number,
      number,
    ],
    (channels) => {
      let next = 0;

      channels.forEach((byte, index) => (next |= byte << shifts[index]));
      onChange({ [term]: next >>> 0 });
    },
  );
};

/** Number inputs for a tuple, each committing the whole tuple */
export const tupleFields = <T extends number[]>(
  values: T,
  names: string[],
  onCommit: (values: T) => void,
): HTMLSpanElement => {
  const current = [...values] as T;
  const element = document.createElement('span');

  element.className = 'bk-tuple';
  element.append(
    ...current.map((value, index) =>
      numberField(
        value,
        (next) => {
          current[index] = next;
          onCommit([...current] as T);
        },
        names[index],
        'short',
      ),
    ),
  );
  return element;
};

/** Reads `index:advance` pairs or plain ids, comma separated */
const parseList = (source: string): number[][] =>
  source
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(':').map(Number));

/** A line input for a list of numbers (`width` per entry, joined by `:`), refusing one that is not */
export const listField = (
  source: string,
  width: number,
  onCommit: (values: number[][]) => void,
): HTMLInputElement => {
  const element = textField(source, (value) => {
    const values = parseList(value);

    if (
      values.some(
        (each) =>
          each.length !== width || each.some((part) => !Number.isInteger(part)),
      )
    ) {
      element.classList.add('invalid');
      return;
    }
    element.classList.remove('invalid');
    onCommit(values);
  });

  return element;
};
