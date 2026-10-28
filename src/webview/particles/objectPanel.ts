import { poseAt } from '../../formats/w3d/w3dPose';
import type { Pose, Vec3 } from '../../formats/w3d/w3dPose';
import type { W3dAnimation } from '../../formats/w3d/w3dAnimation';
import type { SceneSkeleton } from '../../formats/w3d/w3dScene';
import type {
  ObjectScene,
  SceneFocus,
  SceneState,
} from '../../language/model/objectScene';
import { $, post } from './page';

/**
 * The object a preview shows: its states to pick from, the animations the
 * picked state plays, and every element on it - the model, its bones, the
 * FX the state starts and the particle systems it keeps on bones - each
 * with a toggle. What the preview was asked from is on; the rest of the
 * level it sits on is shown too, and the object's other FX are listed off.
 */

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

export const objectView = {
  scene: undefined as ObjectScene | undefined,
  state: undefined as SceneState | undefined,
  showModel: true,
  showBones: false,
  elements: [] as Element[],
  skeleton: undefined as SceneSkeleton | undefined,
  animation: undefined as W3dAnimation | undefined,
  frame: 0,
  pose: undefined as Pose | undefined,
};

/** Restarts the effects, and poses the model; set by the page */
let restart = () => {};
let showPose = (_pose: Pose | undefined) => {};

export const attachObjectPanel = (
  onRestart: () => void,
  onPose: (pose: Pose | undefined) => void,
): void => {
  restart = onRestart;
  showPose = onPose;
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), properties);

const same = (a: string | undefined, b: string | undefined) =>
  a?.toLowerCase() === b?.toLowerCase();

/** Effects switched on, in order */
export const enabledEffects = (): Effect[] =>
  objectView.elements.filter((each) => each.on);

/** Where a bone of the shown model stands now, relative to the model */
export const bonePosition = (name: string | undefined): Vec3 => {
  const { skeleton, pose } = objectView;
  const at = name
    ? (skeleton?.names.findIndex((each) => same(each, name)) ?? -1)
    : -1;

  return at >= 0 && pose ? ([...pose.world[at].t] as Vec3) : [0, 0, 0];
};

const setPose = () => {
  const { skeleton, animation, frame } = objectView;

  objectView.pose = skeleton && poseAt(skeleton, animation, frame);
  showPose(objectView.pose);
};

/** Moves the animation on by `seconds` of playback */
export const advanceAnimation = (seconds: number): void => {
  const animation = objectView.animation;

  if (!animation) {
    return;
  }
  objectView.frame =
    (objectView.frame + seconds * animation.frameRate) %
    Math.max(1, animation.frameCount - 1);
  setPose();
};

/** The model the page now shows, or none */
export const modelShown = (skeleton: SceneSkeleton | undefined): void => {
  objectView.skeleton = skeleton;
  setPose();
  restart();
};

export const animationLoaded = (
  name: string,
  animation: W3dAnimation | undefined,
): void => {
  const notice = $('objectNotice');

  objectView.animation = animation;
  objectView.frame = 0;
  notice.textContent = animation
    ? ''
    : `The animation ${name} was not found or holds no animation`;
  if (
    animation &&
    objectView.skeleton &&
    !same(animation.hierarchyName, objectView.skeleton.name)
  ) {
    notice.textContent = `${name} is made for ${animation.hierarchyName}, not ${objectView.skeleton.name}; it may look wrong`;
  }
  setPose();
};

const playAnimation = (name: string | undefined) => {
  if (name) {
    post({ kind: 'loadAnimation', name });
  } else {
    animationLoaded('', undefined);
    $('objectNotice').textContent = '';
  }
};

/** The elements a state shows, with what was asked for switched on */
const elementsOf = (
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
            same(each.model, state.model),
        )
      : undefined;
  const own: Element[] = [
    ...[...(carrier?.particles ?? []), ...(state?.particles ?? [])].map((each): Element => ({
      kind: 'system',
      name: each.system,
      bone: each.bone,
      label: `${each.system} on ${each.bone}`,
      on: !focus.system || same(focus.system, each.system),
    })),
    ...(state?.fx ?? []).map((name): Element => ({
      kind: 'fxList',
      name,
      label: `${name} (entering the state)`,
      on: !focus.fx || same(focus.fx, name),
    })),
  ];
  // The object's other FX play on events, so they wait to be switched on
  const others = scene.fx
    .filter((each) => !own.some((mine) => same(mine.name, each.name)))
    .map((each): Element => ({
      kind: 'fxList',
      name: each.name,
      label: `${each.name} (${each.field})`,
      on: same(focus.fx, each.name),
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
    toggle('Model', objectView.showModel, (on) => (objectView.showModel = on)),
    toggle('Bones', objectView.showBones, (on) => (objectView.showBones = on)),
    ...objectView.elements.map((each) =>
      toggle(each.label, each.on, (on) => {
        each.on = on;
        restart();
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
  const animations = $<HTMLSelectElement>('objectAnimation');
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
  objectView.elements = elementsOf(scene, state ?? shown, focus);
  animations.replaceChildren(
    new Option('Bind pose', ''),
    ...[...new Set(choices)].map((name) => new Option(name, name)),
  );
  animations.value = first ?? '';
  if (shown?.model) {
    post({ kind: 'loadModel', name: shown.model });
  }
  playAnimation(first);
  renderElements();
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
  $<HTMLSelectElement>('objectAnimation').onchange = (event) =>
    playAnimation((event.target as HTMLSelectElement).value || undefined);
  pickState(focus);
};
