import type { Vec3 } from '../../formats/w3d/w3dPose';
import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import { findHidingSources } from '../../formats/w3d/w3dScene';
import type { SceneSkeleton } from '../../formats/w3d/w3dScene';
import type {
  ObjectScene,
  SceneFocus,
  SceneState,
} from '../../game/objects/objectScene';
import {
  listConditionalSubObjects,
  listSubObjectRules,
} from '../../game/objects/subObjectRules';
import { $, post, viewer } from './page';

/**
 * The object a preview shows: its states to pick from, the animations the
 * picked state plays in the viewer's list, and the FX the state starts and
 * the particle systems it keeps on bones, each with a toggle. What the
 * preview was asked from is on; the rest of the level it sits on is shown
 * too, and the object's other FX are listed off.
 * The parts the object's INI and scripts hide in the state are not drawn,
 * and the panel names them with what hides them.
 */

/** One effect an object preview can start: an FX list or a particle system */
export interface Effect {
  kind: 'fxList' | 'system';
  name: string;
  /** The bone it starts on and follows */
  bone?: string;
}

interface Element extends Effect {
  label: string;
  on: boolean;
}

/** State of the object panel: the object, its picked state and its effects */
export const objectView = {
  scene: undefined as ObjectScene | undefined,
  state: undefined as SceneState | undefined,
  elements: [] as Element[],
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), properties);

const isSameName = (a: string | undefined, b: string | undefined) =>
  a?.toLowerCase() === b?.toLowerCase();

/** Lists the effects switched on, in order */
export const listEnabledEffects = (): Effect[] =>
  objectView.elements.filter((each) => each.on);

/** Gets where a bone of the shown model stands now, relative to the model; the origin for an unknown bone */
export const getBonePosition = (name: string | undefined): Vec3 => {
  const skeleton = viewer.getModel()?.skeleton;
  const pose = viewer.getPose();
  const at = name
    ? (skeleton?.names.findIndex((each) => isSameName(each, name)) ?? -1)
    : -1;

  return at >= 0 && pose ? ([...pose.world[at].t] as Vec3) : [0, 0, 0];
};

/** Says which parts of the shown model are not drawn and why, and what could not be decided */
const renderHiddenParts = () => {
  const { scene, state } = objectView;
  const model = viewer.getModel();
  const meshes = model?.meshes ?? [];
  const hiding = findHidingSources(
    meshes,
    state && scene ? listSubObjectRules(scene, state) : [],
    model?.skeleton?.parents,
  );
  const hidden = meshes.flatMap((mesh, at) =>
    hiding[at] ? [`${mesh.name} (${hiding[at]})`] : [],
  );
  const conditional = scene ? listConditionalSubObjects(scene, state) : [];

  $('objectParts').textContent = [
    ...(hidden.length ? [`Hidden parts: ${hidden.join(', ')}`] : []),
    ...(conditional.length
      ? [`Not applied, depends on the running game: ${conditional.join(', ')}`]
      : []),
  ].join('. ');
};

/** Takes the model the page now shows, then restarts the effects */
export const refreshShownModel = (): void => {
  renderHiddenParts();
  viewer.restart();
};

/** Takes a loaded animation with the skeleton it names, or none when it was not found */
export const setLoadedAnimation = (
  name: string,
  animation: W3dAnimation | undefined,
  skeleton?: SceneSkeleton,
): void => {
  if (animation) {
    viewer.playClip({ id: name, animation, skeleton });
  } else {
    viewer.clearClip(`The animation ${name} was not found or holds no animation`);
  }
};

const playAnimation = (name: string | undefined) => {
  if (name) {
    post({ kind: 'loadAnimation', name });
  } else {
    viewer.clearClip();
  }
};

/** Lists the elements a state shows, with what was asked for switched on */
const listElements = (
  scene: ObjectScene,
  state: SceneState | undefined,
  focus: SceneFocus,
): Element[] => {
  // An animation state plays on a model state, whose bone systems stay on
  const carrier =
    state?.kind === 'animation'
      ? scene.states.find(
          (each) =>
            each.kind === 'model' &&
            each.draw === state.draw &&
            isSameName(each.model, state.model),
        )
      : undefined;
  const own: Element[] = [
    ...[...(carrier?.particles ?? []), ...(state?.particles ?? [])].map((each): Element => ({
      kind: 'system',
      name: each.system,
      bone: each.bone,
      label: `${each.system} on ${each.bone}`,
      on: !focus.system || isSameName(focus.system, each.system),
    })),
    ...(state?.fx ?? []).map((name): Element => ({
      kind: 'fxList',
      name,
      label: `${name} (entering the state)`,
      on: !focus.fx || isSameName(focus.fx, name),
    })),
  ];
  // The object's other FX play on events, so they wait to be switched on
  const others = scene.fx
    .filter((each) => !own.some((mine) => isSameName(mine.name, each.name)))
    .map((each): Element => ({
      kind: 'fxList',
      name: each.name,
      label: `${each.name} (${each.field})`,
      on: isSameName(focus.fx, each.name),
    }));

  return [...own, ...others];
};

const renderElements = () => {
  const list = $('objectElements');
  const toggle = (
    label: string,
    checked: boolean,
    change: (on: boolean) => void,
  ) => {
    const box = element('input', { type: 'checkbox', checked });
    const row = element('label');

    box.onchange = () => change(box.checked);
    const line = element('div', { className: 'row' });

    row.append(box, ` ${label}`);
    line.append(row);
    return line;
  };

  list.replaceChildren(
    ...objectView.elements.map((each) =>
      toggle(each.label, each.on, (on) => {
        each.on = on;
        viewer.restart();
      }),
    ),
  );
};

/** The sounds the object names, each played only by its own button */
const renderVoices = (scene: ObjectScene) => {
  const list = $('objectVoices');

  list.hidden = !scene.voices.length;
  list.replaceChildren(
    ...(scene.voices.length
      ? [element('div', { className: 'muted', textContent: 'Voices' })]
      : []),
    ...scene.voices.map((voice) => {
      const play = element('button', {
        textContent: '▶',
        title: `Play ${voice.name}`,
      });
      const line = element('div', { className: 'row' });

      play.onclick = () => post({ kind: 'playSound', name: voice.name });
      line.append(play, ` ${voice.field} = ${voice.name}`);
      return line;
    }),
  );
};

/** Shows a state: asks for its model, plays its first animation */
const pickState = (focus: SceneFocus) => {
  const scene = objectView.scene!;
  const state =
    focus.state === undefined ? undefined : scene.states[focus.state];
  const shown =
    state ??
    scene.states.find((each) => each.kind === 'model' && each.model) ??
    scene.states[0];
  // A state of its own plays its animation; the object as a whole idles
  const choices = state
    ? state.animations
    : scene.states.flatMap((each) => each.animations);
  const first =
    focus.animation ??
    (state
      ? state.animations[0]
      : scene.states.find((each) => /idle/i.test(each.label))?.animations[0]);

  objectView.state = shown;
  viewer.setSubObjectRules(listSubObjectRules(scene, shown));
  objectView.elements = listElements(scene, state ?? shown, focus);
  viewer.setClips({
    own: [...new Set(choices)].map((name) => ({ id: name, label: name })),
  });
  viewer.showClipChoice(first);
  if (shown?.model) {
    post({ kind: 'loadModel', name: shown.model });
  }
  playAnimation(first);
  renderElements();
  renderHiddenParts();
};

/** Opens the panel on an object, focused on what the preview came from */
export const showObject = (scene: ObjectScene, focus: SceneFocus): void => {
  const states = $<HTMLSelectElement>('objectState');

  objectView.scene = scene;
  $('object').hidden = false;
  $('editing').hidden = true;
  // The object places its effects itself
  $('pickModel').hidden = true;
  $('bone').hidden = true;
  $('title').textContent = scene.name;
  renderVoices(scene);
  states.replaceChildren(
    new Option('Object', ''),
    ...scene.states.map(
      (each, at) =>
        new Option(
          `${each.label}${scene.states.some((other) => other !== each && other.draw !== each.draw) ? ` (${each.draw})` : ''}`,
          String(at),
        ),
    ),
  );
  states.value = focus.state === undefined ? '' : String(focus.state);
  states.onchange = () =>
    pickState({
      state: states.value === '' ? undefined : Number(states.value),
    });
  pickState(focus);
};
