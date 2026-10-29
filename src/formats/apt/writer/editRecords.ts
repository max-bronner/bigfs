import { AptImage } from './aptImage';

/**
 * Adds, changes or removes one record of a counted array of fixed-size
 * records. The array is copied to the end first: another owner may share it.
 */
export const editRecords = (
  image: AptImage,
  countAt: number,
  pointerAt: number,
  size: number,
  change:
    | { add: number[] }
    | { index: number; set: number[] }
    | { index: number; remove: true }
    | { index: number; moveTo: number },
): void => {
  const count = image.u32(countAt);

  if ('add' in change) {
    const at = image.growArray(pointerAt, count * size, size);

    change.add.forEach((word, index) =>
      image.setU32(at + (count * size + index) * 4, word >>> 0),
    );
    image.setU32(countAt, count + 1);
    return;
  }
  if (
    !Number.isInteger(change.index) ||
    change.index < 0 ||
    change.index >= count
  ) {
    throw new Error(`There is no record ${change.index}`);
  }

  const at = image.growArray(pointerAt, count * size, 0);

  if ('moveTo' in change) {
    if (
      !Number.isInteger(change.moveTo) ||
      change.moveTo < 0 ||
      change.moveTo >= count
    ) {
      throw new Error(`There is no record ${change.moveTo}`);
    }

    const records = Array.from({ length: count }, (_, index) =>
      Array.from({ length: size }, (_, word) =>
        image.u32(at + (index * size + word) * 4),
      ),
    );
    const [moved] = records.splice(change.index, 1);

    records.splice(change.moveTo, 0, moved);
    records.flat().forEach((word, index) => image.setU32(at + index * 4, word));
    return;
  }
  if ('set' in change) {
    change.set.forEach((word, index) =>
      image.setU32(at + (change.index * size + index) * 4, word >>> 0),
    );
    return;
  }
  for (let word = change.index * size; word < (count - 1) * size; word++) {
    image.setU32(at + word * 4, image.u32(at + (word + size) * 4));
  }
  image.setU32(countAt, count - 1);
};
