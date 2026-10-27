/**
 * Hotkeys as the game reads them from button text: the character after a
 * single `&` (`&&` is a literal ampersand). Two buttons of one CommandSet
 * on the same key leave one of them unreachable from the keyboard, when the
 * two can be on the command bar at once. A button that buys an upgrade or a
 * science goes once it is bought, and the ability it unlocks is gated on
 * that upgrade (`Options = NEED_UPGRADE`, `NeededUpgrade`), so the pair is
 * never shown together and may share a key.
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
  /** Lower case names the button buys: its `Upgrade` and `Science` */
  grants?: readonly string[];
  /** Lower case `NeededUpgrade` names, when `Options` has `NEED_UPGRADE` */
  needs?: readonly string[];
  /** `NeededUpgradeAny`: one of the needs is enough, not all */
  needsAny?: boolean;
}

/** Whether `unlocked` only shows once `purchase` has been bought and has gone */
const unlockedBy = (unlocked: KeyedSlot, purchase: KeyedSlot): boolean => {
  const needs = unlocked.needs ?? [];
  const grants = purchase.grants ?? [];

  return (
    needs.length > 0 &&
    grants.length > 0 &&
    (unlocked.needsAny
      ? needs.every((name) => grants.includes(name))
      : needs.some((name) => grants.includes(name)))
  );
};

const canShowTogether = (a: KeyedSlot, b: KeyedSlot): boolean =>
  !unlockedBy(a, b) && !unlockedBy(b, a);

/** For each slot sharing its hotkey with others, the slots it clashes with */
export const hotkeyClashes = (slots: KeyedSlot[]): Map<number, number[]> => {
  const byKey = new Map<string, KeyedSlot[]>();

  for (const keyed of slots) {
    if (keyed.hotkey && keyed.hotkey.trim()) {
      byKey.set(keyed.hotkey, [...(byKey.get(keyed.hotkey) ?? []), keyed]);
    }
  }

  const clashes = new Map<number, number[]>();

  for (const group of byKey.values()) {
    for (const keyed of group) {
      const others = group
        .filter(
          (other) => other.slot !== keyed.slot && canShowTogether(keyed, other),
        )
        .map((other) => other.slot);

      if (others.length) {
        clashes.set(keyed.slot, others);
      }
    }
  }
  return clashes;
};
