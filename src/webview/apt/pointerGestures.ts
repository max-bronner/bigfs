import { DOWN, OVER, UP } from './buttonState';

/** One thing the pointer does to a target: the button state it leads to and what it fires */
export interface PointerGesture {
  state: number;
  /** The SWF button condition bit */
  condition: number;
  /** The SWF clip event bit */
  clipEvent: number;
  /** The script property it calls */
  handler: string;
}

const defineGesture = (
  state: number,
  condition: number,
  clipEventBit: number,
  handler: string,
): PointerGesture => ({
  state,
  condition,
  clipEvent: 1 << clipEventBit,
  handler,
});

/** The pointer's gestures (mint's apt-player `MouseEvent`, after Ruffle's `event_dispatch`) */
export const POINTER_GESTURES = {
  rollOver: defineGesture(OVER, 0x1, 13, 'onRollOver'),
  rollOut: defineGesture(UP, 0x2, 14, 'onRollOut'),
  press: defineGesture(DOWN, 0x4, 10, 'onPress'),
  release: defineGesture(OVER, 0x8, 11, 'onRelease'),
  dragOut: defineGesture(OVER, 0x10, 16, 'onDragOut'),
  dragOver: defineGesture(DOWN, 0x20, 15, 'onDragOver'),
  releaseOutside: defineGesture(UP, 0x40, 12, 'onReleaseOutside'),
};

/** Every clip event bit the pointer can fire */
export const POINTER_CLIP_EVENTS = Object.values(POINTER_GESTURES).reduce(
  (bits, { clipEvent }) => bits | clipEvent,
  0,
);
