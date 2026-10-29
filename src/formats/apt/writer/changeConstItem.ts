import { parseConst } from '../aptMovie';
import type { ConstItemChange } from './aptEdit';
import { AptImage } from './aptImage';

/**
 * Changes one item of a `.const` file and returns the new bytes. A number is
 * written in place; a string is appended and its item repointed, so every
 * other byte stays where it was.
 */
export const changeConstItem = (
  bytes: Uint8Array,
  change: ConstItemChange,
): Uint8Array => {
  const parsed = parseConst(bytes);

  if (
    !Number.isInteger(change.index) ||
    change.index < 0 ||
    change.index >= parsed.items.length
  ) {
    throw new Error(`The .const has no item ${change.index}`);
  }

  const image = new AptImage(bytes);
  const at = parsed.itemsOffset + change.index * 8;

  if (typeof change.value === 'string') {
    image.setU32(at + 4, image.appendString(change.value));
    image.setU32(at, 1);
  } else {
    if (!Number.isInteger(change.value)) {
      throw new Error('A .const number is a whole 32-bit word');
    }
    image.setU32(at + 4, change.value);
    image.setU32(at, 4);
  }

  return image.bytes;
};
