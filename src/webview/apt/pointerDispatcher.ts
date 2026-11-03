import { UP } from './buttonState';
import { toBoolean } from './avm/value';
import type { Vm } from './avm/vm';
import type { BehaviourRunner } from './createBehaviourRunner';
import { describeInstance } from './describeInstance';
import type { Instance } from './instance';
import { POINTER_CLIP_EVENTS, POINTER_GESTURES } from './pointerGestures';
import type { PointerGesture } from './pointerGestures';
import type { ScriptQueue } from './scriptQueue';

/** What the pointer needs of the player it acts on */
export interface PointerHost {
  queue: ScriptQueue;
  getVm(): Vm | undefined;
  getRoot(): Instance;
  log(line: string): void;
  isAttached(instance: Instance): boolean;
  syncButton(button: Instance): void;
  queueClipEvent(instance: Instance, event: number): void;
  queueMethod(instance: Instance, name: string): void;
  hasHandler(instance: Instance, name: string): boolean;
  runBehaviour: BehaviourRunner;
  drainScripts(): void;
}

/** The pointer's side of a player: what it does to the buttons and clips under it */
export interface PointerDispatcher {
  /**
   * Moves the pointer from one target to another. While a target is held down
   * the others get drag events, never roll events (mint's `update_mouse`,
   * after Ruffle).
   */
  hover(
    previous: Instance | undefined,
    next: Instance | undefined,
    isHeld?: boolean,
  ): void;
  /** Presses the pointer on a target */
  press(target: Instance): void;
  /** Lets the pointer go: over the target pressed, or over `hovered` or nothing */
  release(target: Instance, hovered: Instance | undefined): void;
  /**
   * Whether a clip takes the pointer itself, by a mouse clip event or a mouse
   * handler property (mint's `button_mode`, after Ruffle)
   */
  takesPointer(instance: Instance): boolean;
}

/** Creates the dispatcher a player sends the pointer's gestures through */
export const createPointerDispatcher = (host: PointerHost): PointerDispatcher => {
  /** Whether a script has turned a button off; absent means on */
  const isDisabled = (button: Instance) => {
    const enabled = host.getVm()?.peekObject(button)?.get('enabled');

    return enabled !== undefined && !toBoolean(enabled);
  };

  const sendButtonGesture = (button: Instance, gesture: PointerGesture) => {
    if (button.character?.type !== 'button') {
      return;
    }
    if (isDisabled(button)) {
      // A disabled button changes state but runs nothing
      if (gesture.state !== POINTER_GESTURES.rollOver.state) {
        button.buttonState = UP;
        host.syncButton(button);
      }
      return;
    }

    // A button's actions run on the timeline it is placed in
    const owner = button.parent ?? host.getRoot();
    const name =
      Object.entries(POINTER_GESTURES).find(([, each]) => each === gesture)?.[0] ??
      'event';
    const label = `${name} on ${describeInstance(button)}`;
    const vm = host.getVm();

    for (const action of button.character.actions) {
      if (action.condition & gesture.condition) {
        if (vm) {
          host.log(label);
          host.queue.add(() => {
            if (!button.removed) {
              vm.runBlock(owner, action.block, button);
            }
          });
        } else {
          host.runBehaviour(owner, button.movie.behaviours[action.block], label);
        }
      }
    }

    // A handler a script gave the button (`btn.onRelease = function () {}`)
    host.queueMethod(button, gesture.handler);

    // After its actions are queued, so what the new state shows runs after them
    button.buttonState = gesture.state;
    host.syncButton(button);
  };

  const sendGesture = (target: Instance, gesture: PointerGesture) => {
    if (target.removed) {
      return;
    }
    host.queue.hold(() => {
      if (target.character?.type === 'button') {
        sendButtonGesture(target, gesture);
      } else {
        host.queueClipEvent(target, gesture.clipEvent);
        host.queueMethod(target, gesture.handler);
      }
    });
    host.drainScripts();
  };

  return {
    hover: (previous, next, isHeld) => {
      if (previous === next) {
        return;
      }
      if (previous && host.isAttached(previous)) {
        sendGesture(
          previous,
          isHeld ? POINTER_GESTURES.dragOut : POINTER_GESTURES.rollOut,
        );
      }
      if (next) {
        sendGesture(
          next,
          isHeld ? POINTER_GESTURES.dragOver : POINTER_GESTURES.rollOver,
        );
      }
    },
    press: (target) => sendGesture(target, POINTER_GESTURES.press),
    release: (target, hovered) => {
      if (target.removed) {
        return;
      }
      if (target === hovered) {
        sendGesture(target, POINTER_GESTURES.release);
        return;
      }
      sendGesture(target, POINTER_GESTURES.releaseOutside);
      if (hovered) {
        sendGesture(hovered, POINTER_GESTURES.rollOver);
      }
    },
    takesPointer: (instance) =>
      !!instance.clipActions?.some(({ events }) => events & POINTER_CLIP_EVENTS) ||
      Object.values(POINTER_GESTURES).some(({ handler }) =>
        host.hasHandler(instance, handler),
      ),
  };
};
