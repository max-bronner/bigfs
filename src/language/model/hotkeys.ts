/**
 * Hotkeys as the game reads them from button text: the character after a
 * single `&` (`&&` is a literal ampersand). Two buttons of one CommandSet
 * on the same key leave one of them unreachable from the keyboard.
 */

export const hotkeyOf = (text: string): string | undefined => {
  for (let index = 0; index < text.length - 1; index++) {
    if (text[index] !== '&') {
      continue;
    }
    if (text[index + 1] === '&') {
      index++;
      continue;
    }
    return text[index + 1].toUpperCase();
  }
  return undefined;
};

export interface KeyedSlot {
  slot: number;
  hotkey?: string;
}

/** For each slot sharing its hotkey with others, the slots it clashes with */
export const hotkeyClashes = (slots: KeyedSlot[]): Map<number, number[]> => {
  const byKey = new Map<string, number[]>();

  for (const { slot, hotkey } of slots) {
    if (hotkey && hotkey.trim()) {
      byKey.set(hotkey, [...(byKey.get(hotkey) ?? []), slot]);
    }
  }

  const clashes = new Map<number, number[]>();

  for (const group of byKey.values()) {
    if (group.length > 1) {
      for (const slot of group) {
        clashes.set(
          slot,
          group.filter((other) => other !== slot),
        );
      }
    }
  }
  return clashes;
};
