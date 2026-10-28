import { BLOCK_ICONS } from './blockModel';
import type { BlockKind } from './blockModel';
import { state } from '../state';

/**
 * A block: one record as a collapsible card. The header holds a drag
 * handle, the type icon, the id or name and a one-line summary, and the
 * actions that apply to the record; the body holds its fields. Headers
 * take the keyboard: arrows move between them, right and left open and
 * close, Alt with up or down reorders, Delete removes, Ctrl+D duplicates.
 */

export interface BlockOptions {
  /** Keeps the card open or closed across redraws */
  key: string;
  kind: BlockKind;
  title: string;
  summary?: string;
  /** Whether it starts open when the user has not chosen */
  open?: boolean;
  body: () => Node[];
  /** Extra header controls, such as a script's "Open in tab" */
  actions?: HTMLElement[];
  onRemove?: () => void;
  onDuplicate?: () => void;
  /** Moves by one place, -1 or 1; the card gets arrows and drag handling when set */
  onMove?: (by: -1 | 1) => void;
  /** Called when the card is opened, to load what the body shows */
  onOpen?: () => void;
  /** An error to show on the card, such as a script that does not compile */
  problem?: string;
}

const iconButton = (
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement => {
  const element = document.createElement('button');

  element.className = 'bk-icon';
  element.textContent = label;
  element.title = title;
  element.setAttribute('aria-label', title);
  element.tabIndex = -1;
  element.onclick = (event) => {
    event.stopPropagation();
    onClick();
  };
  return element;
};

export const blockCard = (options: BlockOptions): HTMLElement => {
  const card = document.createElement('section');
  const head = document.createElement('div');
  const chevron = document.createElement('span');
  const icon = document.createElement('span');
  const title = document.createElement('span');
  const summary = document.createElement('span');
  const tools = document.createElement('span');
  const body = document.createElement('div');
  let filled = false;

  card.className = `bk bk-${options.kind}`;
  card.dataset.key = options.key;
  head.className = 'bk-head';
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  chevron.className = 'bk-chevron';
  icon.className = 'bk-type';
  icon.textContent = BLOCK_ICONS[options.kind];
  title.className = 'bk-title';
  title.textContent = options.title;
  summary.className = 'bk-summary';
  summary.textContent = options.summary ?? '';
  summary.title = options.summary ?? '';
  tools.className = 'bk-tools';
  body.className = 'bk-body';

  const setOpen = (open: boolean, remember = true) => {
    card.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
    chevron.textContent = open ? '▾' : '▸';
    if (remember) {
      state.cards.set(options.key, open);
    }
    if (open && !filled) {
      filled = true;
      body.replaceChildren(...options.body());
    }
    if (open) {
      options.onOpen?.();
    }
  };
  const move = (by: -1 | 1) => options.onMove?.(by);

  if (options.onMove) {
    const handle = document.createElement('span');

    handle.className = 'bk-handle';
    handle.textContent = '⋮⋮';
    handle.title = 'Drag to reorder; Alt+↑ and Alt+↓ move it from the keyboard';
    handle.draggable = true;
    handle.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', options.key);
      event.dataTransfer?.setDragImage(card, 0, 0);
      card.classList.add('dragging');
      card.parentElement?.setAttribute('data-dragging', options.key);
    });
    handle.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.parentElement?.removeAttribute('data-dragging');
    });
    head.append(handle);
  }
  head.append(chevron, icon, title, summary, tools);
  tools.append(...(options.actions ?? []));
  if (options.onMove) {
    tools.append(
      iconButton('↑', 'Move up (Alt+↑)', () => move(-1)),
      iconButton('↓', 'Move down (Alt+↓)', () => move(1)),
    );
  }
  if (options.onDuplicate) {
    tools.append(iconButton('⧉', 'Duplicate (Ctrl+D)', options.onDuplicate));
  }
  if (options.onRemove) {
    tools.append(iconButton('🗑', 'Remove (Delete)', options.onRemove));
  }
  if (options.problem) {
    card.classList.add('bk-problem');
    summary.title = options.problem;
  }

  head.onclick = () => setOpen(!card.classList.contains('open'));
  head.onkeydown = (event) => {
    if (event.target !== head) {
      return;
    }

    const open = card.classList.contains('open');

    if (event.key === 'Enter' || event.key === ' ') {
      setOpen(!open);
    } else if (event.key === 'ArrowRight' && !open) {
      setOpen(true);
    } else if (event.key === 'ArrowLeft' && open) {
      setOpen(false);
    } else if (event.altKey && event.key === 'ArrowUp' && options.onMove) {
      move(-1);
    } else if (event.altKey && event.key === 'ArrowDown' && options.onMove) {
      move(1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      neighbour(head, event.key === 'ArrowDown' ? 1 : -1)?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      const heads = visibleHeads(head);

      heads[event.key === 'Home' ? 0 : heads.length - 1]?.focus();
    } else if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      options.onRemove
    ) {
      options.onRemove();
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'd' &&
      options.onDuplicate
    ) {
      options.onDuplicate();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  card.append(head, body);
  setOpen(state.cards.get(options.key) ?? options.open ?? false, false);
  return card;
};

/** Every block header that can take focus, in page order, within the same panel */
const visibleHeads = (from: HTMLElement): HTMLElement[] =>
  Array.from(
    (from.closest('#details') ?? document).querySelectorAll<HTMLElement>(
      '.bk-head',
    ),
  ).filter((each) => each.offsetParent !== null);

const neighbour = (from: HTMLElement, by: -1 | 1): HTMLElement | undefined => {
  const heads = visibleHeads(from);

  return heads[heads.indexOf(from) + by];
};

/**
 * Lets the cards of a list be dragged by their handles. `onMove` gets the
 * index of the card dragged and the index it was dropped at.
 */
export const reorderList = (
  list: HTMLElement,
  onMove: (from: number, to: number) => void,
): HTMLElement => {
  const cards = () =>
    Array.from(list.children).filter((each) =>
      each.classList.contains('bk'),
    ) as HTMLElement[];
  const clear = () =>
    cards().forEach((each) =>
      each.classList.remove('drop-before', 'drop-after'),
    );

  list.classList.add('bk-list');
  list.addEventListener('dragover', (event) => {
    const dragged = list.getAttribute('data-dragging');

    if (!dragged) {
      return;
    }
    event.preventDefault();
    clear();

    const over = cards().find((each) => {
      const box = each.getBoundingClientRect();

      return event.clientY < box.top + box.height / 2;
    });

    (over ?? cards()[cards().length - 1])?.classList.add(
      over ? 'drop-before' : 'drop-after',
    );
  });
  list.addEventListener('dragleave', (event) => {
    if (!list.contains(event.relatedTarget as Node | null)) {
      clear();
    }
  });
  list.addEventListener('drop', (event) => {
    const dragged = list.getAttribute('data-dragging');

    event.preventDefault();
    if (!dragged) {
      return;
    }

    const all = cards();
    const from = all.findIndex((each) => each.dataset.key === dragged);
    const before = all.findIndex((each) =>
      each.classList.contains('drop-before'),
    );

    clear();
    if (from < 0) {
      return;
    }
    // Dropping before card N from above N lands one place earlier once it leaves
    const slot =
      before < 0 ? all.length - 1 : before > from ? before - 1 : before;

    if (slot !== from) {
      onMove(from, slot);
    }
  });
  return list;
};
