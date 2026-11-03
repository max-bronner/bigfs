import type { Instance } from '../instance';
import type { PageMovie } from '../protocol';
import { AsObject } from './value';
import type { Scope, Value } from './value';
import type { Frame, VmState } from './vmState';

/** Script objects of the machine: making them, and telling clips from values */

/** Gets the script object of a clip, made on first use */
export const getClipObject = (vm: VmState, instance: Instance): AsObject => {
  let object = vm.clips.get(instance);

  if (!object) {
    const type = instance.character?.type;

    object = new AsObject(
      type === 'button'
        ? vm.protos.button
        : type === 'editText'
          ? vm.protos.textField
          : vm.protos.movieClip,
      { type: 'clip', instance },
    );
    vm.clips.set(instance, object);
  }
  return object;
};

/** Gets the clip a value is the script object of, if it is one */
export const getClipOf = (value: Value): Instance | undefined =>
  value instanceof AsObject && value.kind.type === 'clip'
    ? value.kind.instance
    : undefined;

/** Gets the built-in prototype a primitive value reads its members through */
export const getPrimitiveProto = (
  vm: VmState,
  value: Value,
): AsObject | undefined => {
  switch (typeof value) {
    case 'string':
      return vm.protos.string;
    case 'number':
      return vm.protos.number;
    case 'boolean':
      return vm.protos.boolean;
    default:
      return undefined;
  }
};

/** Creates an array object holding the values */
export const createArray = (vm: VmState, values: Value[]): AsObject => {
  const array = new AsObject(vm.protos.array, { type: 'array' });

  values.forEach((value, index) => array.set(String(index), value));
  array.define('length', values.length);
  return array;
};

/** Creates the Target <- Global scope chain of a clip's code */
export const createTargetScope = (vm: VmState, clip: Instance): Scope => ({
  values: getClipObject(vm, clip),
  kind: 'target',
  parent: { values: vm.global, kind: 'global' },
});

/** Creates a frame on a clip with nothing running, for a block or for resolving paths */
export const createClipFrame = (
  vm: VmState,
  clip: Instance,
  movie: PageMovie = clip.movie,
): Frame => ({
  movie,
  scope: createTargetScope(vm, clip),
  pool: [],
  self: getClipObject(vm, clip),
  target: clip,
  base: clip,
  stack: [],
  depth: 0,
});
