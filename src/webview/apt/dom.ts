/** Small DOM builders for the details panel */

/** Gets a page element by id, typed as the caller expects it to be */
export const byId = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** Escapes text for use in HTML markup or a double-quoted attribute */
export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

/** Kind of value an `input` edits: `text` is multi-line, `hex` a 32-bit word */
export type InputKind = 'number' | 'text' | 'line' | 'hex';

/**
 * Creates an input that commits on change: a number, a text, a line or a hex
 * word. A number that does not parse marks the input invalid and is not committed.
 */
export function input(
  value: unknown,
  onCommit: (value: number) => void,
  kind?: 'number' | 'hex',
): HTMLInputElement;
export function input(
  value: unknown,
  onCommit: (value: string) => void,
  kind: 'text' | 'line',
): HTMLInputElement | HTMLTextAreaElement;
export function input(
  value: unknown,
  onCommit: (value: never) => void,
  kind: InputKind = 'number',
): HTMLInputElement | HTMLTextAreaElement {
  const element = document.createElement(
    kind === 'text' ? 'textarea' : 'input',
  );

  if (element instanceof HTMLInputElement) {
    element.type = 'text';
  }
  element.value =
    value === undefined
      ? ''
      : kind === 'hex'
        ? '0x' + (Number(value) >>> 0).toString(16).padStart(8, '0')
        : String(value);
  element.className = kind;
  element.onchange = () => {
    const raw = element.value.trim();

    if (kind === 'text' || kind === 'line') {
      (onCommit as (value: string) => void)(element.value);
      return;
    }

    const parsed = kind === 'hex' ? parseInt(raw, 16) >>> 0 : Number(raw);

    if (!Number.isFinite(parsed)) {
      element.classList.add('invalid');
      return;
    }
    (onCommit as (value: number) => void)(parsed);
  };
  return element;
}

/** Creates a labelled row of controls */
export const row = (label: string, ...controls: Node[]): HTMLDivElement => {
  const element = document.createElement('div');
  const name = document.createElement('label');

  element.className = 'field';
  name.textContent = label;
  element.append(name, ...controls);
  return element;
};

/** Creates a button that runs `onClick` when pressed */
export const button = (
  label: string,
  onClick: () => void,
): HTMLButtonElement => {
  const element = document.createElement('button');

  element.textContent = label;
  element.onclick = onClick;
  return element;
};

/** Creates a section heading for the details panel */
export const heading = (text: string): HTMLHeadingElement => {
  const element = document.createElement('h3');

  element.textContent = text;
  return element;
};
