/** Small DOM builders for the details panel */

export const byId = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

export type InputKind = 'number' | 'text' | 'line' | 'hex';

/** An input that commits on change: a number, a text, a line or a hex word */
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

/** A labelled row of controls */
export const row = (label: string, ...controls: Node[]): HTMLDivElement => {
  const element = document.createElement('div');
  const name = document.createElement('label');

  element.className = 'field';
  name.textContent = label;
  element.append(name, ...controls);
  return element;
};

export const button = (
  label: string,
  onClick: () => void,
): HTMLButtonElement => {
  const element = document.createElement('button');

  element.textContent = label;
  element.onclick = onClick;
  return element;
};

export const heading = (text: string): HTMLHeadingElement => {
  const element = document.createElement('h3');

  element.textContent = text;
  return element;
};
