import { PLACE_FLAGS } from '../aptMovie';
import type { PlacementChange, PlacementField } from './aptEdit';
import { AptImage } from './aptImage';

/** The flag bit each optional PlaceObject field is gated on */
const PLACEMENT_FLAGS: Record<PlacementField, number> = {
  character: PLACE_FLAGS.hasCharacter,
  matrix: PLACE_FLAGS.hasMatrix,
  colorTransform: PLACE_FLAGS.hasColorTransform,
  ratio: PLACE_FLAGS.hasRatio,
  name: PLACE_FLAGS.hasName,
  clipDepth: PLACE_FLAGS.hasClipDepth,
};

/** Applies a change to a PlaceObject record in place, setting its flags to match */
export const changePlacement = (
  image: AptImage,
  offset: number,
  change: PlacementChange,
): void => {
  if (image.u32(offset) !== 3) {
    throw new Error(`No PlaceObject at ${offset}`);
  }

  let flags = image.u32(offset + 4);
  const set = (bit: number, isOn: boolean) => {
    flags = isOn ? flags | bit : flags & ~bit;
  };

  for (const field of change.clear ?? []) {
    set(PLACEMENT_FLAGS[field], false);
  }

  if (change.character !== undefined) {
    image.setU32(offset + 12, change.character);
    set(PLACE_FLAGS.hasCharacter, true);
  }

  if (change.depth !== undefined) {
    image.setI32(offset + 8, change.depth);
  }

  if (change.matrix || change.translate) {
    // A matrix not given keeps the stored one, or identity when there was none
    const hadMatrix = (flags & PLACE_FLAGS.hasMatrix) !== 0;

    if (change.matrix) {
      change.matrix.forEach((value, index) =>
        image.setF32(offset + 16 + index * 4, value),
      );
    } else if (!hadMatrix) {
      [1, 0, 0, 1].forEach((value, index) =>
        image.setF32(offset + 16 + index * 4, value),
      );
    }

    if (change.translate) {
      image.setF32(offset + 32, change.translate[0]);
      image.setF32(offset + 36, change.translate[1]);
    } else if (!hadMatrix) {
      image.setF32(offset + 32, 0);
      image.setF32(offset + 36, 0);
    }

    set(PLACE_FLAGS.hasMatrix, true);
  }

  if (change.colorTransform !== undefined || change.colorAdd !== undefined) {
    if (!(flags & PLACE_FLAGS.hasColorTransform)) {
      image.setU32(offset + 40, 0xffffffff);
      image.setU32(offset + 44, 0);
    }

    if (change.colorTransform !== undefined) {
      image.setU32(offset + 40, change.colorTransform);
    }

    if (change.colorAdd !== undefined) {
      image.setU32(offset + 44, change.colorAdd);
    }

    set(PLACE_FLAGS.hasColorTransform, true);
  }

  if (change.ratio !== undefined) {
    image.setF32(offset + 48, change.ratio);
    set(PLACE_FLAGS.hasRatio, true);
  }

  if (change.name !== undefined) {
    image.setU32(
      offset + 52,
      change.name ? image.appendString(change.name) : 0,
    );
    set(PLACE_FLAGS.hasName, Boolean(change.name));
  }

  if (change.clipDepth !== undefined) {
    image.setI32(offset + 56, change.clipDepth);
    set(PLACE_FLAGS.hasClipDepth, true);
  }

  if (change.isMove !== undefined) {
    set(PLACE_FLAGS.move, change.isMove);
  }

  image.setU32(offset + 4, flags);
};
