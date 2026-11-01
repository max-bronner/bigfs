/** Button up state, as record flags and event dispatch use it */
export const UP = 1;
/** Button over state: the pointer is on it */
export const OVER = 2;
/** Button down state: the pointer is pressed on it */
export const DOWN = 4;
/** Button hit state: the record is the pressable area, never drawn */
export const HIT = 8;

/** One pointer event: the button state it leads to, its action condition, clip event and handler */
export interface PointerEvent {
  state: number;
  /** The SWF button condition bit */
  condition: number;
  /** The SWF clip event bit */
  clipEvent: number;
  handler: string;
}

const pointerEvent = (
  state: number,
  condition: number,
  clipBit: number,
  handler: string,
): PointerEvent => ({ state, condition, clipEvent: 1 << clipBit, handler });

/** Pointer events (mint's apt-player `MouseEvent`, after Ruffle's `event_dispatch`) */
export const POINTER = {
  rollOver: pointerEvent(OVER, 0x1, 13, 'onRollOver'),
  rollOut: pointerEvent(UP, 0x2, 14, 'onRollOut'),
  press: pointerEvent(DOWN, 0x4, 10, 'onPress'),
  release: pointerEvent(OVER, 0x8, 11, 'onRelease'),
  dragOut: pointerEvent(OVER, 0x10, 16, 'onDragOut'),
  dragOver: pointerEvent(DOWN, 0x20, 15, 'onDragOver'),
  releaseOutside: pointerEvent(UP, 0x40, 12, 'onReleaseOutside'),
};

/** Every clip event bit the pointer can fire */
export const POINTER_CLIP_EVENTS = Object.values(POINTER).reduce(
  (bits, { clipEvent }) => bits | clipEvent,
  0,
);
