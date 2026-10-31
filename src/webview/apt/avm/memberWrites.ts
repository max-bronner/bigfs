import type { Instance } from '../instance';
import { toAvmString } from './calls';
import { DISPLAY_PROPERTIES } from './displayObjects';
import { AsObject, toBoolean, toInt32, toNumber } from './value';
import type { Value } from './value';
import type { VmState } from './vmState';

/** Writes a display property of a clip by its lowercased name */
export const setDisplayProperty = (
  vm: VmState,
  instance: Instance,
  name: string,
  value: Value,
): void => {
  const n = toNumber(value);
  const [a, b, c, d] = instance.matrix;
  const xScale = Math.hypot(a, b);
  const yScale = Math.hypot(c, d);
  const rotation = Math.atan2(b, a);
  const compose = (sx: number, sy: number, angle: number) => {
    instance.matrix = [
      sx * Math.cos(angle),
      sx * Math.sin(angle),
      -sy * Math.sin(angle),
      sy * Math.cos(angle),
    ];
  };

  // Once a script moves a clip, its timeline no longer does
  instance.scripted = true;
  switch (name) {
    case '_x':
      if (!Number.isNaN(n)) {
        instance.translate = [n, instance.translate[1]];
      }
      break;
    case '_y':
      if (!Number.isNaN(n)) {
        instance.translate = [instance.translate[0], n];
      }
      break;
    case '_xscale':
      if (!Number.isNaN(n)) {
        compose(n / 100, yScale, rotation);
      }
      break;
    case '_yscale':
      if (!Number.isNaN(n)) {
        compose(xScale, n / 100, rotation);
      }
      break;
    case '_rotation':
      if (!Number.isNaN(n)) {
        compose(xScale, yScale, (n * Math.PI) / 180);
      }
      break;
    case '_alpha':
      if (!Number.isNaN(n)) {
        instance.alpha = n / 100;
      }
      break;
    case '_visible':
      instance.visible = toBoolean(value);
      break;
    case '_name':
      instance.name = toAvmString(vm, value);
      break;
    case '_width':
    case '_height': {
      const bounds =
        instance.character && 'bounds' in instance.character
          ? instance.character.bounds
          : undefined;
      const size = bounds
        ? name === '_width'
          ? bounds[2] - bounds[0]
          : bounds[3] - bounds[1]
        : 0;

      if (size && !Number.isNaN(n)) {
        compose(
          name === '_width' ? n / size : xScale,
          name === '_height' ? n / size : yScale,
          rotation,
        );
      }
      break;
    }
  }
};

/** Sets a member of an object; a clip's display property moves the clip */
export const setMember = (
  vm: VmState,
  object: Value,
  name: string,
  value: Value,
): void => {
  if (!(object instanceof AsObject) || !name) {
    return;
  }
  if (object === vm.externObject) {
    vm.engine.setExtern(name, value);
    return;
  }
  if (object.kind.type === 'clip' && !object.has(name)) {
    const instance = object.kind.instance;
    const lower = name.toLowerCase();

    if (DISPLAY_PROPERTIES.includes(lower)) {
      setDisplayProperty(vm, instance, lower, value);
      return;
    }
    if (
      instance.character?.type === 'editText' &&
      (lower === 'text' || lower === 'htmltext')
    ) {
      instance.text = toAvmString(vm, value);
      return;
    }
  }
  if (object.kind.type === 'array') {
    if (name.toLowerCase() === 'length') {
      const length = Math.max(0, Math.trunc(toNumber(value)) || 0);

      for (let at = length; at < toInt32(object.get('length')); at++) {
        object.delete(String(at));
      }
      object.define('length', length);
      return;
    }
    if (/^\d+$/.test(name) && Number(name) >= toInt32(object.get('length'))) {
      object.define('length', Number(name) + 1);
    }
  }
  if (value instanceof AsObject && value.kind.type === 'function') {
    vm.engine.defined(object, name, value);
  }
  object.set(name, value);
};
