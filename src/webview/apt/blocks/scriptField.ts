import { checkScript } from '../../../formats/apt/aptScript';
import type { ConstItem } from '../../../formats/apt/aptMovie';
import { movie, state } from '../state';
import { errorSpan, segmentScript } from './scriptHighlight';

/**
 * A script shown as code: highlighted text edited in place. The text is a
 * transparent textarea over a coloured copy of itself. When the field
 * loses focus the text is compiled; an error underlines where it is and
 * nothing is sent, otherwise the edit goes to the extension, which makes
 * it one undoable change.
 */

/** Options for `scriptField`: the text, how it can be edited and where a change goes */
export interface ScriptFieldOptions {
  block: number;
  /** The text as the extension decoded it */
  text: string;
  /** `listing` cannot be compiled back and is read-only */
  mode: 'script' | 'assembly' | 'listing';
  note?: string;
  /** Sends the compiled text on */
  onCommit: (text: string) => void;
}

/** The movie's `.const` items as the compiler takes them; offsets do not matter to a check */
const constItems = (): ConstItem[] =>
  (movie().consts ?? []).map(
    (value): ConstItem =>
      typeof value === 'string'
        ? { kind: 'string', value, offset: 0 }
        : { kind: 'number', value },
  );

const paintInto = (
  layer: HTMLElement,
  text: string,
  error?: { start: number; end: number },
): void => {
  layer.replaceChildren(
    ...segmentScript(text, error).map((segment) => {
      const span = document.createElement('span');

      span.className =
        `tok-${segment.kind}` + (segment.error ? ' tok-error' : '');
      span.textContent = segment.text;
      return span;
    }),
    // A final newline would otherwise not make room for the last empty line
    document.createTextNode('\n'),
  );
};

/** Creates a script field; a text that does not compile is underlined and not committed */
export const scriptField = (options: ScriptFieldOptions): HTMLElement => {
  const wrapper = document.createElement('div');
  const code = document.createElement('div');
  const layer = document.createElement('pre');
  const area = document.createElement('textarea');
  const status = document.createElement('div');
  const editable = options.mode !== 'listing';
  let error: { start: number; end: number } | undefined;

  wrapper.className = 'bk-script';
  code.className = 'bk-code';
  layer.className = 'bk-code-layer';
  layer.setAttribute('aria-hidden', 'true');
  area.className = 'bk-code-input';
  area.spellcheck = false;
  area.readOnly = !editable;
  area.wrap = 'off';
  area.value = state.drafts.get(options.block) ?? options.text;
  area.setAttribute('aria-label', 'Script');
  status.className = 'bk-script-status';

  const resize = () => {
    area.rows = Math.min(30, Math.max(3, area.value.split('\n').length + 1));
  };
  const show = (message?: string) => {
    status.classList.toggle('error', !!message);
    status.textContent =
      message ??
      (options.mode === 'script'
        ? 'script'
        : options.mode === 'assembly'
          ? 'assembly, one instruction a line'
          : 'listing, read-only');
    status.title = options.note ?? '';
  };
  const repaint = () => {
    paintInto(layer, area.value, error);
    resize();
  };

  area.addEventListener('input', () => {
    state.drafts.set(options.block, area.value);
    error = undefined;
    show();
    repaint();
  });
  area.addEventListener('scroll', () => {
    layer.scrollTop = area.scrollTop;
    layer.scrollLeft = area.scrollLeft;
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && editable) {
      event.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
    } else if (event.key === 'Escape') {
      // Leaves the field to the block's header, so the keyboard is not trapped
      event.stopPropagation();
      wrapper.closest('.bk')?.querySelector<HTMLElement>('.bk-head')?.focus();
    } else if (event.key !== 'Tab') {
      // Typing in the code never triggers the block shortcuts
      event.stopPropagation();
    }
  });
  area.addEventListener('blur', () => {
    if (!editable || area.value === options.text) {
      return;
    }

    const problem = checkScript(area.value, constItems());

    if (problem) {
      error = problem.line
        ? errorSpan(area.value, problem.line, problem.column ?? 1)
        : { start: 0, end: Math.min(area.value.length, 1) };
      show(
        problem.line
          ? `line ${problem.line}:${problem.column ?? 1}  ${problem.message}`
          : problem.message,
      );
      repaint();
      return;
    }
    options.onCommit(area.value);
  });

  show();
  repaint();
  code.append(layer, area);
  wrapper.append(code, status);
  if (editable) {
    const reset = document.createElement('button');

    reset.className = 'bk-button';
    reset.textContent = 'Reset';
    reset.title = 'Throw away the unapplied text';
    reset.onclick = () => {
      state.drafts.delete(options.block);
      area.value = options.text;
      error = undefined;
      show();
      repaint();
    };
    wrapper.append(reset);
  }
  return wrapper;
};
