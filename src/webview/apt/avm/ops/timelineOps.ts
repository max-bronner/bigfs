import type { Instance } from '../../instance';
import { toAvmString } from '../calls';
import {
  DISPLAY_PROPERTIES,
  getDisplayProperty,
  getTargetPath,
} from '../displayObjects';
import { setDisplayProperty } from '../memberWrites';
import { isWindowTarget, parseLevel } from '../movieLoad';
import { getClipObject, getClipOf } from '../objects';
import { pop, push } from '../operands';
import { SCRIPT_DEPTH_BIAS, toInt32 } from '../value';
import type { Scope, Value } from '../value';
import { findTargetClip, resolvePath } from '../variables';
import type { Frame, Operation, OperationGroup, VmState } from '../vmState';

/** Goes to a frame by number, label or `clip:label` path, playing on unless `stop` */
export const gotoValue = (
  vm: VmState,
  frame: Frame,
  clip: Instance,
  target: Value,
  stop: boolean,
): void => {
  if (typeof target === 'number' && Number.isInteger(target)) {
    if (target > 0) {
      vm.stage.goTo(clip, target - 1, !stop);
    }
    return;
  }

  const text = toAvmString(vm, target);
  const separator = Math.max(text.lastIndexOf(':'), text.lastIndexOf('.'));
  let on: Instance | undefined = clip;
  let label = text;

  if (separator >= 0) {
    on = getClipOf(
      resolvePath(vm, frame, getClipObject(vm, clip), text.slice(0, separator)),
    );
    label = text.slice(separator + 1);
  }
  if (!on) {
    return;
  }

  const number = Number(label);

  if (label.trim() && !Number.isNaN(number)) {
    if (number > 0) {
      vm.stage.goTo(on, Math.trunc(number) - 1, !stop);
    }
    return;
  }

  const at = vm.stage.labelFrame(on, label);

  if (at !== undefined) {
    vm.stage.goTo(on, at, !stop);
  }
};

const getUrl = (
  vm: VmState,
  frame: Frame,
  url: string,
  target: string,
): void => {
  if (/^fscommand:/i.test(url)) {
    vm.engine.command(url.slice(10), target);
    return;
  }
  vm.engine.call('getURL', [url, target]);

  // A target that names a clip or level is Flash's loadMovie (an empty
  // URL its unloadMovie); a window target is only the call above
  if (!isWindowTarget(target)) {
    const level = parseLevel(target);
    const into =
      level ??
      findTargetClip(vm, frame, frame.target ?? vm.stage.root, target, false);

    if (into === undefined) {
      vm.engine.log(`loadMovie: no clip ${JSON.stringify(target)}`);
    } else {
      vm.loadMovie(into, url);
    }
  }
};

const setTarget = (vm: VmState, frame: Frame, target: Value): void => {
  const empty =
    target === undefined || (typeof target === 'string' && !target);

  frame.target = empty
    ? frame.base
    : frame.base && findTargetClip(vm, frame, frame.base, target, false);

  const values = frame.target ? getClipObject(vm, frame.target) : vm.global;
  const replace = (scope: Scope): Scope =>
    scope.kind === 'target'
      ? { ...scope, values }
      : scope.kind === 'local' && scope.parent
        ? { ...scope, parent: replace(scope.parent) }
        : scope;

  frame.scope = replace(frame.scope);
};

const setPlaying =
  (isPlaying: boolean): Operation =>
  (vm, frame) => {
    if (frame.target) {
      vm.stage.setPlaying(frame.target, isPlaying);
    }
    return undefined;
  };

const stepFrame =
  (by: number): Operation =>
  (vm, frame) => {
    if (frame.target) {
      vm.stage.goTo(frame.target, frame.target.frame + by, false);
    }
    return undefined;
  };

/** Timelines, targets, URLs, display properties and clips made or removed */
export const TIMELINE_OPS: OperationGroup = {
  Stop: setPlaying(false),
  Play: setPlaying(true),
  NextFrame: stepFrame(1),
  PrevFrame: stepFrame(-1),
  GotoFrame: (vm, frame, { operand }) => {
    if (frame.target) {
      vm.stage.goTo(frame.target, operand as number, false);
    }
    return undefined;
  },
  GotoLabel: (vm, frame, { operand }) => {
    if (frame.target) {
      const at = vm.stage.labelFrame(frame.target, operand as string);

      if (at !== undefined) {
        vm.stage.goTo(frame.target, at, false);
      }
    }
    return undefined;
  },
  GotoExpression: (vm, frame, { operand }) => {
    const target = pop(frame);
    const clip = frame.target ?? vm.stage.root;

    gotoValue(vm, frame, clip, target, !((operand as number) & 1));
    return undefined;
  },
  SetTarget: (vm, frame, { operand }) => {
    setTarget(vm, frame, operand as string);
    return undefined;
  },
  SetTargetExpression: (vm, frame) => {
    setTarget(vm, frame, pop(frame));
    return undefined;
  },
  GetUrl: (vm, frame, { operand }) => {
    const [url, target] = operand as [string, string];

    getUrl(vm, frame, url, target);
    return undefined;
  },
  GetUrl2: (vm, frame) => {
    const target = toAvmString(vm, pop(frame));

    getUrl(vm, frame, toAvmString(vm, pop(frame)), target);
    return undefined;
  },
  TargetPath: (_vm, frame) => {
    const clip = getClipOf(pop(frame));

    push(frame, clip ? getTargetPath(clip, '.') : undefined);
    return undefined;
  },
  GetProperty: (vm, frame) => {
    const index = toInt32(pop(frame));
    const path = pop(frame);
    const clip = findTargetClip(
      vm,
      frame,
      frame.target ?? vm.stage.root,
      path,
      true,
    );
    const property = DISPLAY_PROPERTIES[index];

    push(
      frame,
      clip && property ? getDisplayProperty(clip, property) : undefined,
    );
    return undefined;
  },
  SetProperty: (vm, frame) => {
    const value = pop(frame);
    const index = toInt32(pop(frame));
    const path = pop(frame);
    const clip = findTargetClip(
      vm,
      frame,
      frame.target ?? vm.stage.root,
      path,
      true,
    );
    const property = DISPLAY_PROPERTIES[index];

    if (clip && property) {
      setDisplayProperty(vm, clip, property, value);
    }
    return undefined;
  },
  DuplicateClip: (vm, frame) => {
    const depth = toInt32(pop(frame));
    const newName = toAvmString(vm, pop(frame));
    const target = pop(frame);
    const clip = findTargetClip(
      vm,
      frame,
      frame.target ?? vm.stage.root,
      target,
      false,
    );

    if (clip?.parent) {
      vm.stage.attach(
        clip.parent,
        `#${clip.id}`,
        newName,
        depth + SCRIPT_DEPTH_BIAS,
      );
    }
    return undefined;
  },
  RemoveClip: (vm, frame) => {
    const clip = findTargetClip(
      vm,
      frame,
      frame.target ?? vm.stage.root,
      pop(frame),
      true,
    );

    if (clip) {
      vm.stage.remove(clip);
    }
    return undefined;
  },
};
