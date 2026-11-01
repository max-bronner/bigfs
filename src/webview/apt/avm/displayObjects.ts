import type { Rect } from '../../../formats/apt/aptMovie';
import { isTimeline } from '../instance';
import type { Instance } from '../instance';
import { parseLevel } from './movieLoad';
import { getClipObject, getPrimitiveProto } from './objects';
import { AsObject } from './value';
import type { Value } from './value';
import type { VmState } from './vmState';

/** Reading clips as objects: display properties, children by name, levels and members */

/** How deep a clip's size is measured, against a nesting a hostile movie builds */
const MAX_EXTENT_DEPTH = 64;

/** Display properties in `GetProperty`/`SetProperty` index order */
export const DISPLAY_PROPERTIES = [
  '_x',
  '_y',
  '_xscale',
  '_yscale',
  '_currentframe',
  '_totalframes',
  '_alpha',
  '_visible',
  '_width',
  '_height',
  '_rotation',
  '_target',
  '_framesloaded',
  '_name',
  '_droptarget',
  '_url',
  '_highquality',
  '_focusrect',
  '_soundbuftime',
  '_quality',
  '_xmouse',
  '_ymouse',
];

/** Finds a child of a clip by instance name, ignoring casing */
export const findChildByName = (
  instance: Instance,
  name: string,
): Instance | undefined => {
  const lower = name.toLowerCase();

  for (const child of instance.children.values()) {
    if (child.name?.toLowerCase() === lower) {
      return child;
    }
  }
  return undefined;
};

/** Finds the clip a script loaded into a level (`_level1`), if one is there */
export const findLevelClip = (
  vm: VmState,
  lower: string,
): Instance | undefined => {
  const level = parseLevel(lower);

  return level
    ? [...vm.stage.root.children.values()].find(
        (child) => child.name?.toLowerCase() === lower,
      )
    : undefined;
};

/** Gets the target path of a clip, as `_level0.a.b` or `/a/b` */
export const getTargetPath = (
  instance: Instance,
  separator: '.' | '/',
): string => {
  const names: string[] = [];

  for (let at: Instance | undefined = instance; at?.parent; at = at.parent) {
    names.unshift(at.name ?? '');
  }

  // A level is not below `_level0`: its path starts at itself
  const level = names[0] && parseLevel(names[0]) ? names[0] : undefined;

  return separator === '/'
    ? `/${names.join('/')}`
    : [level ? '' : '_level0', ...names].filter(Boolean).join('.');
};

/** Gets the box around where a matrix puts a rectangle */
const transformExtent = (
  [a, b, c, d]: Instance['matrix'],
  [tx, ty]: Instance['translate'],
  [left, top, right, bottom]: Rect,
): Rect => {
  const xs = [left, right].flatMap((x) => [a * x + c * top, a * x + c * bottom]);
  const ys = [left, right].flatMap((x) => [b * x + d * top, b * x + d * bottom]);

  return [
    Math.min(...xs) + tx,
    Math.min(...ys) + ty,
    Math.max(...xs) + tx,
    Math.max(...ys) + ty,
  ];
};

/**
 * Gets what a clip covers in its own space: a clip or button by what it shows
 * now, anything else by its stored bounds (mint's `local_bounds`)
 */
export const getLocalExtent = (
  instance: Instance,
  depth = 0,
): Rect | undefined => {
  const { character } = instance;

  if (depth > MAX_EXTENT_DEPTH) {
    return undefined;
  }
  if (!isTimeline(instance) && character?.type !== 'button') {
    return character && 'bounds' in character ? character.bounds : undefined;
  }

  let extent: Rect | undefined;

  for (const child of instance.children.values()) {
    const inner = getLocalExtent(child, depth + 1);

    if (inner) {
      const box = transformExtent(child.matrix, child.translate, inner);

      extent = extent
        ? [
            Math.min(extent[0], box[0]),
            Math.min(extent[1], box[1]),
            Math.max(extent[2], box[2]),
            Math.max(extent[3], box[3]),
          ]
        : box;
    }
  }
  return extent;
};

/** Reads a display property of a clip by its lowercased name */
export const getDisplayProperty = (instance: Instance, name: string): Value => {
  const [a, b, c, d] = instance.matrix;

  switch (name) {
    case '_x':
      return instance.translate[0];
    case '_y':
      return instance.translate[1];
    case '_xscale':
      return Math.hypot(a, b) * 100;
    case '_yscale':
      return Math.hypot(c, d) * 100;
    case '_rotation':
      return (Math.atan2(b, a) * 180) / Math.PI;
    case '_alpha':
      return instance.alpha * 100;
    case '_visible':
      return instance.visible !== false;
    case '_currentframe':
      return instance.frame + 1;
    case '_totalframes':
    case '_framesloaded':
      return instance.frames.length;
    case '_name':
      return instance.name ?? '';
    case '_target':
      return getTargetPath(instance, '/');
    case '_width':
    case '_height': {
      const extent = getLocalExtent(instance);
      const box = extent && transformExtent(instance.matrix, [0, 0], extent);

      return box ? (name === '_width' ? box[2] - box[0] : box[3] - box[1]) : 0;
    }
    case '_url':
      return '';
    case '_quality':
      return 'HIGH';
    case '_highquality':
      return 1;
    default:
      return 0;
  }
};

/** Answers a name a clip's object does not hold: roots, levels, children, display properties, text */
const lookupOnClip = (
  vm: VmState,
  instance: Instance,
  name: string,
): { found: boolean; value?: Value } => {
  const lower = name.toLowerCase();

  if (lower === '_root' || lower === '_level0') {
    return { found: true, value: getClipObject(vm, vm.stage.root) };
  }
  if (lower === '_parent') {
    return {
      found: true,
      value: instance.parent && getClipObject(vm, instance.parent),
    };
  }

  const level = findLevelClip(vm, lower);

  if (level) {
    return { found: true, value: getClipObject(vm, level) };
  }
  if (lower === '_global') {
    return { found: true, value: vm.global };
  }

  const child = findChildByName(instance, name);

  if (child) {
    return { found: true, value: getClipObject(vm, child) };
  }
  if (DISPLAY_PROPERTIES.includes(lower)) {
    return { found: true, value: getDisplayProperty(instance, lower) };
  }
  if (
    instance.character?.type === 'editText' &&
    (lower === 'text' || lower === 'htmltext')
  ) {
    return {
      found: true,
      value: instance.text ?? instance.character.text ?? '',
    };
  }
  return { found: false };
};

/** Gets a member of a value, through prototypes, clip children and display properties */
export const getMember = (vm: VmState, object: Value, name: string): Value => {
  if (typeof object === 'string' && name.toLowerCase() === 'length') {
    return object.length;
  }
  if (object === vm.externObject) {
    return vm.engine.extern(name);
  }

  let current: AsObject | undefined =
    object instanceof AsObject ? object : getPrimitiveProto(vm, object);

  for (let hops = 0; current && hops < 256; hops++) {
    if (current.has(name)) {
      return current.get(name);
    }
    if (current.kind.type === 'clip') {
      const found = lookupOnClip(vm, current.kind.instance, name);

      if (found.found) {
        return found.value;
      }
    }
    current = current.proto;
  }
  return undefined;
};

/** Whether an object answers a name, through prototypes and what its clip shows */
export const hasProperty = (
  vm: VmState,
  object: AsObject,
  name: string,
): boolean => {
  let current: AsObject | undefined = object;

  for (let hops = 0; current && hops < 256; hops++) {
    if (current.has(name)) {
      return true;
    }
    if (
      current.kind.type === 'clip' &&
      lookupOnClip(vm, current.kind.instance, name).found
    ) {
      return true;
    }
    current = current.proto;
  }
  return false;
};
