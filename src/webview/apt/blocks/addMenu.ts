import type { AddChoice } from './blockModel';

/**
 * The "+" at the end of a list of blocks: a menu of the record kinds that
 * may be added at that spot. Arrows move through it, Enter chooses, Escape
 * closes.
 */
export const addMenu = (
  label: string,
  choices: AddChoice[],
  onPick: (id: string) => void,
): HTMLElement => {
  const element = document.createElement('div');
  const trigger = document.createElement('button');
  let menu: HTMLDivElement | undefined;

  element.className = 'bk-add';
  trigger.className = 'bk-add-button';
  trigger.textContent = `＋ ${label}`;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.title = 'Add a block here';

  const close = () => {
    menu?.remove();
    menu = undefined;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
  };
  const outside = (event: MouseEvent) => {
    if (menu && !element.contains(event.target as Node)) {
      close();
    }
  };
  const open = () => {
    menu = document.createElement('div');
    menu.className = 'bk-popup bk-menu';
    menu.setAttribute('role', 'menu');
    trigger.setAttribute('aria-expanded', 'true');
    for (const choice of choices) {
      const item = document.createElement('button');
      const icon = document.createElement('span');

      item.className = 'bk-menu-item';
      item.setAttribute('role', 'menuitem');
      icon.className = 'bk-type';
      icon.textContent = choice.icon;
      item.append(icon, choice.label);
      item.onclick = () => {
        close();
        trigger.focus();
        onPick(choice.id);
      };
      menu.append(item);
    }
    menu.onkeydown = (event) => {
      const items = Array.from(
        menu!.querySelectorAll<HTMLElement>('.bk-menu-item'),
      );
      const at = items.indexOf(document.activeElement as HTMLElement);

      if (event.key === 'ArrowDown') {
        items[(at + 1) % items.length].focus();
      } else if (event.key === 'ArrowUp') {
        items[(at - 1 + items.length) % items.length].focus();
      } else if (event.key === 'Escape') {
        close();
        trigger.focus();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    element.append(menu);
    document.addEventListener('mousedown', outside, true);
    menu.querySelector<HTMLElement>('.bk-menu-item')?.focus();
  };

  trigger.onclick = () => (menu ? close() : open());
  element.append(trigger);
  return element;
};
