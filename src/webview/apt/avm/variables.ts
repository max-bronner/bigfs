import type { Instance } from '../instance';
import { toAvmString } from './calls';
import {
  findChildByName,
  findLevelClip,
  getMember,
  hasProperty,
} from './displayObjects';
import { setMember } from './memberWrites';
import { getClipObject, getClipOf } from './objects';
import { AsObject } from './value';
import type { Scope, Value } from './value';
import type { Frame, VmState } from './vmState';

/** Variables and target paths, read and written through a frame's scope chain */

/** Paths that name their start, so no local variable is the way in */
const ROOTED = /^(\/|_root[.:]|_level\d+[.:]|_global[.:]|this[.:])/i;

/** Resolves a plain name through the scope chain */
export const resolveName = (
  vm: VmState,
  frame: Frame,
  name: string,
): { value: Value; on?: AsObject; local?: boolean } => {
  if (name.toLowerCase() === 'this') {
    return { value: frame.self };
  }
  for (
    let scope: Scope | undefined = frame.scope;
    scope;
    scope = scope.parent
  ) {
    if (hasProperty(vm, scope.values, name)) {
      return {
        value: getMember(vm, scope.values, name),
        on: scope.values,
        local: scope.kind === 'local',
      };
    }
  }
  return { value: undefined };
};

/** Follows a target path through the clips: `_root.a.b`, `/a/b`, `../x`, `a:b` */
export const resolvePath = (
  vm: VmState,
  frame: Frame,
  start: AsObject,
  path: string,
): AsObject | undefined => {
  if (!path) {
    return start;
  }

  let object: AsObject | undefined = start;
  let rest = path;
  let slash = false;
  let first = true;

  if (rest.startsWith('/')) {
    object = getClipObject(vm, vm.stage.root);
    rest = rest.slice(1);
    slash = true;
    first = false;
  }
  for (let hops = 0; rest && object && hops < 256; hops++) {
    rest = rest.replace(/^:+/, '');
    if (rest.startsWith('..')) {
      const after = rest.slice(2);

      slash ||= after.startsWith('/');
      rest = after.slice(1);

      const parent: Instance | undefined = getClipOf(object)?.parent;

      object = parent && getClipObject(vm, parent);
      first = false;
      continue;
    }

    let end = rest.length;

    for (let at = 0; at < rest.length; at++) {
      const char = rest[at];

      if (char === ':' || (char === '.' && !slash)) {
        end = at;
        break;
      }
      if (char === '/') {
        slash = true;
        end = at;
        break;
      }
    }

    const name = rest.slice(0, end);
    const lower = name.toLowerCase();

    rest = rest.slice(end + 1);

    let value: Value;

    if (lower === 'this') {
      value = frame.self;
    } else if (first && (lower === '_root' || lower === '_level0')) {
      value = getClipObject(vm, vm.stage.root);
    } else if (first && findLevelClip(vm, lower)) {
      value = getClipObject(vm, findLevelClip(vm, lower)!);
    } else {
      const clip = getClipOf(object);
      const child = clip && findChildByName(clip, name);

      value = child ? getClipObject(vm, child) : getMember(vm, object, name);
    }
    first = false;
    object = value instanceof AsObject ? value : undefined;
  }
  return object;
};

/** Reads a variable: `a.b:c` paths through the clips, else a plain name */
export const lookupVariable = (
  vm: VmState,
  frame: Frame,
  path: string,
): { value: Value; on?: AsObject; local?: boolean } => {
  const separator = Math.max(path.lastIndexOf(':'), path.lastIndexOf('.'));

  if (separator >= 0) {
    const target = path.slice(0, separator);
    const name = path.slice(separator + 1);

    if (!target) {
      return { value: undefined };
    }
    for (
      let scope: Scope | undefined = frame.scope;
      scope;
      scope = scope.parent
    ) {
      const object = resolvePath(vm, frame, scope.values, target);

      if (object && hasProperty(vm, object, name)) {
        return {
          value: getMember(vm, object, name),
          on: object,
          // A path from a function's own variable is not the movie's
          local: scope.kind === 'local' && !ROOTED.test(path),
        };
      }
    }
    return { value: undefined };
  }
  if (path.includes('/')) {
    for (
      let scope: Scope | undefined = frame.scope;
      scope;
      scope = scope.parent
    ) {
      const object = resolvePath(vm, frame, scope.values, path);

      if (object) {
        return { value: object, on: object };
      }
    }
  }

  return resolveName(vm, frame, path);
};

/** Reads a variable as `GetVariable` does, as the engine may override it */
export const getVariable = (
  vm: VmState,
  frame: Frame,
  path: string,
  counted = true,
): { value: Value; on?: AsObject } => {
  const found = lookupVariable(vm, frame, path);

  return path.toLowerCase() === 'this'
    ? found
    : {
        value: vm.engine.read(
          path,
          found.value,
          found.on !== undefined,
          counted,
          found.local === true,
        ),
        on: found.on,
      };
};

/** Writes a variable: `a.b:c` paths through the clips, else where the scope chain holds it */
export const setVariable = (
  vm: VmState,
  frame: Frame,
  path: string,
  value: Value,
): void => {
  if (!path) {
    return;
  }

  const separator = Math.max(path.lastIndexOf(':'), path.lastIndexOf('.'));

  if (separator >= 0) {
    for (
      let scope: Scope | undefined = frame.scope;
      scope;
      scope = scope.parent
    ) {
      const object = resolvePath(
        vm,
        frame,
        scope.values,
        path.slice(0, separator),
      );

      if (object) {
        setMember(vm, object, path.slice(separator + 1), value);
        return;
      }
    }
    return;
  }

  let last = vm.global;

  for (
    let scope: Scope | undefined = frame.scope;
    scope;
    scope = scope.parent
  ) {
    if (scope.kind === 'target' || hasProperty(vm, scope.values, path)) {
      setMember(vm, scope.values, path, value);
      return;
    }
    last = scope.values;
  }
  setMember(vm, last, path, value);
};

/** Defines a variable in the frame's own scope; a path outside a function writes through it */
export const defineLocal = (
  vm: VmState,
  frame: Frame,
  name: string,
  value: Value,
): void => {
  if (frame.scope.kind !== 'local' && /[.:]/.test(name)) {
    setVariable(vm, frame, name, value);
    return;
  }
  setMember(vm, frame.scope.values, name, value);
};

/** Finds the clip a target names: an object, or a path from `start` */
export const findTargetClip = (
  vm: VmState,
  frame: Frame,
  start: Instance,
  target: Value,
  allowEmpty: boolean,
): Instance | undefined => {
  const clip = getClipOf(target);

  if (clip) {
    return clip;
  }

  const path = toAvmString(vm, target);

  if (!allowEmpty && !path) {
    return undefined;
  }
  return getClipOf(resolvePath(vm, frame, getClipObject(vm, start), path));
};
