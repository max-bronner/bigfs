import { BINDINGS, classifySurface } from '../../formats/apt/aptGadgets';
import type { Binding, GadgetInfo } from '../../formats/apt/aptGadgets';
import { pathKey } from './avm/engine';
import type { Engine } from './avm/engine';
import { parseTyped } from './avm/engine';
import type { Value } from './avm/value';
import { AsObject } from './avm/value';
import type { Instance, Player } from './player';

/**
 * The gadgets a running movie holds, and the variables they are bound to.
 * A gadget is a clip whose own `_type`, `_Load` or `_imageName` say so
 * (ported from mint's apt-viewer `host.rs`); its value is a variable of that
 * clip, so the movie reads what the control holds and the Engine panel can
 * override it like any other value.
 */

/** A gadget found on the stage: its kind and the clip instance that holds it */
export interface Gadget extends GadgetInfo {
  instance: Instance;
  /** The clip's instance names from the root, which an override is keyed by */
  path?: string;
}

const text = (value: Value): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Gets the instance names down from the root, or nothing if one on the way has none */
export const namePath = (instance: Instance, root: Instance): string | undefined => {
  const names: string[] = [];

  for (let at: Instance | undefined = instance; at && at !== root; at = at.parent) {
    if (!at.name) {
      return undefined;
    }
    names.unshift(at.name);
  }
  return names.join('.');
};

/** Finds every surface the player shows now that is a gadget or an image, in tree order */
export const findGadgets = (player: Player): Gadget[] => {
  const { vm } = player;

  if (!vm) {
    return [];
  }

  const found: Gadget[] = [];

  for (const instance of player.all()) {
    if (instance.visible === false || instance === player.root) {
      continue;
    }

    const own = vm.objectOf(instance);
    const info = classifySurface({
      type: text(own.get('_type')),
      load: text(own.get('_Load')),
      init: text(own.get('_Init')),
      windowId: text(own.get('_WindowId')),
      imageName: text(own.get('_imageName')),
      imageMap: text(own.get('_imageMap')),
      mode: text(own.get('_mode')),
    });

    if (info) {
      found.push({ ...info, instance, path: namePath(instance, player.root) });
    }
  }
  return found;
};

const show = (value: string | number | boolean): string => String(value);

/** Reads what a bound variable holds now: the override, else the clip's own value */
export const readBinding = (
  player: Player,
  engine: Engine,
  gadget: Gadget,
  binding: Binding,
): Value => {
  const override =
    gadget.path !== undefined
      ? engine.overrides.get(pathKey(`${gadget.path}.${binding.name}`))
      : undefined;

  if (override !== undefined) {
    return parseTyped(override);
  }

  const held = player.vm?.objectOf(gadget.instance).get(binding.name);

  return held instanceof AsObject || held === undefined ? binding.fallback : held;
};

/**
 * Writes a bound variable as typed: into the clip now, and as an override
 * when the clip has a name path, so it survives the movie writing it again.
 * Empty text clears the override and the clip's own value.
 */
export const writeBinding = (
  player: Player,
  engine: Engine,
  gadget: Gadget,
  name: string,
  typed: string,
): void => {
  const own = player.vm?.objectOf(gadget.instance);

  if (gadget.path !== undefined) {
    engine.override(`${gadget.path}.${name}`, typed);
  }
  if (!typed.trim()) {
    own?.delete(name);
  } else {
    own?.set(name, parseTyped(typed));
  }
};

/** Lists the bound variables of a gadget with what each reads as, for the panel */
export const bindingsOf = (
  player: Player,
  engine: Engine,
  gadget: Gadget,
): { binding: Binding; value: string; overridden: boolean }[] =>
  BINDINGS[gadget.kind].map((binding) => ({
    binding,
    value: show(
      (readBinding(player, engine, gadget, binding) as string | number | boolean) ??
        binding.fallback,
    ),
    overridden:
      gadget.path !== undefined &&
      engine.overrides.has(pathKey(`${gadget.path}.${binding.name}`)),
  }));
