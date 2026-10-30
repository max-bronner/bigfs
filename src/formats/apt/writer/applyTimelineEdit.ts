import { AptReader, parseFrames } from '../aptMovie';
import type { AptMovie } from '../aptMovie';
import { applyOperation, decodeTimeline, encodeTimeline } from '../aptTimeline';
import type { FrameSpec } from '../aptTimeline';
import type { AptEdit, EditResult } from './aptEdit';
import { AptImage } from './aptImage';
import { getTimelineFields } from './frameItems';
import { encodePlaceSpec } from './placeObjectWords';

/** An edit to a whole timeline */
export type TimelineEdit = Extract<
  AptEdit,
  { kind: 'swapDepths' | 'setTimeline' | 'addFrame' }
>;

/** Applies an edit that rewrites a timeline's frames or the depths its items use */
export const applyTimelineEdit = (
  image: AptImage,
  movie: AptMovie,
  edit: TimelineEdit,
): EditResult => {
  switch (edit.kind) {
    case 'swapDepths': {
      const { countAt, pointerAt } = getTimelineFields(movie, edit.timeline);
      const frames = parseFrames(
        new AptReader(image.bytes),
        image.u32(countAt),
        image.u32(pointerAt),
      );
      const seen = new Set<number>();

      for (const item of frames.flatMap((frame) => frame.items)) {
        // Frames can share an item; it is swapped once
        if (seen.has(item.offset)) {
          continue;
        }
        seen.add(item.offset);

        const at =
          item.type === 'placeObject'
            ? item.offset + 8
            : item.type === 'removeObject'
              ? item.offset + 4
              : undefined;

        if (
          at !== undefined &&
          'depth' in item &&
          (item.depth === edit.a || item.depth === edit.b)
        ) {
          image.setI32(at, item.depth === edit.a ? edit.b : edit.a);
        }
      }
      return {};
    }
    case 'setTimeline': {
      const { countAt, pointerAt } = getTimelineFields(movie, edit.timeline);
      const count = image.u32(countAt);
      const old = image.u32(pointerAt);
      const words = edit.frames.flatMap((frame, index) => {
        if ('reuse' in frame) {
          if (
            !Number.isInteger(frame.reuse) ||
            frame.reuse < 0 ||
            frame.reuse >= count
          ) {
            throw new Error(`#${edit.timeline} has no frame ${frame.reuse}`);
          }
          return [
            image.u32(old + frame.reuse * 8),
            image.u32(old + frame.reuse * 8 + 4),
          ];
        }

        const items = frame.items.map((item) =>
          'reuse' in item
            ? item.reuse
            : 'remove' in item
              ? image.appendWords([4, item.remove >>> 0])
              : 'label' in item
                ? image.appendWords([
                    2,
                    image.appendString(item.label),
                    item.flags >>> 0,
                    index,
                  ])
                : image.appendWords(encodePlaceSpec(image, item.place)),
        );

        return [items.length, items.length ? image.appendWords(items) : 0];
      });

      if (!edit.frames.length) {
        throw new Error('A timeline keeps at least one frame');
      }
      image.setU32(pointerAt, image.appendWords(words));
      image.setU32(countAt, edit.frames.length);
      return {};
    }
    case 'addFrame': {
      const { countAt, pointerAt } = getTimelineFields(movie, edit.timeline);
      const count = image.u32(countAt);
      const frames = image.appendWords(
        Array.from({ length: count * 2 }, (_, index) =>
          image.u32(image.u32(pointerAt) + index * 4),
        ).concat([0, 0]),
      );

      image.setU32(pointerAt, frames);
      image.setU32(countAt, count + 1);
      return {};
    }
  }
};

/** Computes the frames a timeline has once an operation, or a script of them, is applied to it */
export const computeEditedTimelineFrames = (
  image: AptImage,
  movie: AptMovie,
  edit: Extract<AptEdit, { kind: 'timeline' | 'timelineScript' }>,
): FrameSpec[] => {
  const { countAt, pointerAt } = getTimelineFields(movie, edit.timeline);
  const states = decodeTimeline(
    image.bytes,
    parseFrames(
      new AptReader(image.bytes),
      image.u32(countAt),
      image.u32(pointerAt),
    ),
  );

  return encodeTimeline(
    states,
    (edit.kind === 'timeline' ? [edit.operation] : edit.operations).reduce(
      applyOperation,
      states,
    ),
  );
};
