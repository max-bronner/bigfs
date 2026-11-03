import { PLACE_FLAGS } from '../aptMovie';
import type { AptMovie } from '../aptMovie';
import type { AptEdit, EditResult } from './aptEdit';
import { AptImage } from './aptImage';
import { changePlacement } from './changePlacement';
import { editRecords } from './editRecords';
import { addFrameItem, expectItem, getTimelineFields } from './frameItems';
import { encodePlaceObject } from './placeObjectWords';

/** An edit to the items of a frame, or to one item in place */
export type FrameItemEdit = Extract<
  AptEdit,
  {
    kind:
      | 'placement'
      | 'frameLabel'
      | 'backgroundColor'
      | 'addBackgroundColor'
      | 'initAction'
      | 'removeObjectDepth'
      | 'placeObject'
      | 'removeObject'
      | 'addFrameLabel'
      | 'removeItem'
      | 'moveItem'
      | 'addFrameScript'
      | 'addClipAction'
      | 'clipAction'
      | 'removeClipAction';
  }
>;

/** Applies an edit that adds, changes, moves or removes one item of a frame */
export const applyFrameItemEdit = (
  image: AptImage,
  movie: AptMovie,
  edit: FrameItemEdit,
): EditResult => {
  switch (edit.kind) {
    case 'placement':
      changePlacement(image, edit.offset, edit.change);
      return {};
    case 'frameLabel':
      expectItem(image, edit.offset, 2, 'frame label');
      if (edit.label !== undefined) {
        image.setU32(edit.offset + 4, image.appendString(edit.label));
      }
      if (edit.flags !== undefined) {
        image.setU32(edit.offset + 8, edit.flags);
      }
      if (edit.frame !== undefined) {
        image.setU32(edit.offset + 12, edit.frame);
      }
      return {};
    case 'backgroundColor':
      expectItem(image, edit.offset, 5, 'background colour');
      image.setU32(edit.offset + 4, edit.color);
      return {};
    case 'addBackgroundColor':
      addFrameItem(image, movie, edit.timeline, edit.frame, [5, edit.color]);
      return {};
    case 'initAction':
      expectItem(image, edit.offset, 8, 'InitAction');
      image.setU32(edit.offset + 4, edit.sprite);
      return {};
    case 'removeObjectDepth':
      expectItem(image, edit.offset, 4, 'RemoveObject');
      image.setI32(edit.offset + 4, edit.depth);
      return {};
    case 'placeObject': {
      const name = edit.name ? image.appendString(edit.name) : 0;
      const flags =
        PLACE_FLAGS.hasCharacter |
        PLACE_FLAGS.hasMatrix |
        (name ? PLACE_FLAGS.hasName : 0);

      addFrameItem(
        image,
        movie,
        edit.timeline,
        edit.frame,
        encodePlaceObject(
          flags,
          edit.depth,
          edit.character,
          edit.matrix ?? [1, 0, 0, 1],
          edit.translate ?? [0, 0],
          name,
        ),
      );
      return {};
    }
    case 'removeObject':
      addFrameItem(image, movie, edit.timeline, edit.frame, [
        4,
        edit.depth >>> 0,
      ]);
      return {};
    case 'addFrameLabel':
      addFrameItem(image, movie, edit.timeline, edit.frame, [
        2,
        image.appendString(edit.label),
        0,
        edit.frame,
      ]);
      return {};
    case 'removeItem': {
      const { countAt, pointerAt } = getTimelineFields(movie, edit.timeline);

      if (edit.frame < 0 || edit.frame >= image.u32(countAt)) {
        throw new Error(`#${edit.timeline} has no frame ${edit.frame}`);
      }

      const frameAt = image.u32(pointerAt) + edit.frame * 8;
      const count = image.u32(frameAt);
      // Copied before it shrinks: another frame may share the array
      const items = image.growArray(frameAt + 4, count, 0);
      const position = Array.from({ length: count }, (_, index) =>
        image.u32(items + index * 4),
      ).indexOf(edit.offset);

      if (position < 0) {
        throw new Error(`Frame ${edit.frame} has no item at ${edit.offset}`);
      }

      for (let index = position; index < count - 1; index++) {
        image.setU32(items + index * 4, image.u32(items + (index + 1) * 4));
      }

      image.setU32(frameAt, count - 1);
      return {};
    }
    case 'moveItem': {
      const { countAt, pointerAt } = getTimelineFields(movie, edit.timeline);

      if (edit.frame < 0 || edit.frame >= image.u32(countAt)) {
        throw new Error(`#${edit.timeline} has no frame ${edit.frame}`);
      }

      const frameAt = image.u32(pointerAt) + edit.frame * 8;

      editRecords(image, frameAt, frameAt + 4, 1, {
        index: edit.from,
        moveTo: edit.to,
      });
      return {};
    }
    case 'addFrameScript':
      addFrameItem(image, movie, edit.timeline, edit.frame, [1, edit.block]);
      return {};
    case 'addClipAction':
    case 'clipAction':
    case 'removeClipAction': {
      if (image.u32(edit.offset) !== 3) {
        throw new Error(`No PlaceObject at ${edit.offset}`);
      }

      const flags = image.u32(edit.offset + 4);
      let list =
        flags & PLACE_FLAGS.hasClipActions ? image.u32(edit.offset + 60) : 0;

      if (!list) {
        if (edit.kind !== 'addClipAction') {
          throw new Error('The placement has no clip actions');
        }
        list = image.appendWords([0, 0]);
        image.setU32(edit.offset + 60, list);
        image.setU32(edit.offset + 4, flags | PLACE_FLAGS.hasClipActions);
      }
      // Each record is events, a word that is always 0, and the block
      editRecords(
        image,
        list,
        list + 4,
        3,
        edit.kind === 'addClipAction'
          ? { add: [edit.events, 0, edit.block] }
          : edit.kind === 'clipAction'
            ? { index: edit.index, set: [edit.events] }
            : { index: edit.index, remove: true },
      );
      return {};
    }
  }
};
