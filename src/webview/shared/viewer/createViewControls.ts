import { findHidingSources } from '../../../formats/w3d/w3dScene';
import type { SubObjectRule } from '../../../formats/w3d/w3dScene';
import { element } from '../element';
import type { ViewerModel } from './describeModel';

const SKIES: [string, string][] = [
  ['dark', '#1b1c1f'],
  ['day', '#7a8ea6'],
  ['black', '#000000'],
  ['light', '#c8c8c8'],
];

/** What the view controls have chosen to show */
export interface ViewChoices {
  showBones: boolean;
  showMeshes: boolean;
  showHidden: boolean;
  showBoxes: boolean;
  showGrid: boolean;
  /** HLOD level to draw; the finest until one is picked */
  lod: number | undefined;
  /** Clear colour, `#rrggbb` */
  sky: string;
}

/** The viewer's toggles: bones, model, hidden parts, boxes, grid, level of detail and sky */
export interface ViewControls {
  controls: HTMLElement[];
  choices: ViewChoices;
  /** Fits the controls to the model on show and what hides parts of it */
  setModel(model: ViewerModel | undefined, rules: readonly SubObjectRule[]): void;
  toggleBones(): void;
}

const pressedButton = (text: string, title: string, pressed: boolean) => {
  const button = element('button', text);

  button.title = title;
  button.setAttribute('aria-pressed', String(pressed));
  return button;
};

const describeLevel = (
  { meshes, maxScreenSize }: { meshes: unknown[]; maxScreenSize?: number },
  at: number,
) =>
  `LOD ${at}: ${meshes.length} meshes, ${
    maxScreenSize === undefined ? 'finest' : `max screen size ${maxScreenSize}`
  }`;

/** Creates the view controls; `onChange` gets a line for the status as anything changes */
export const createViewControls = (
  onChange: (status: string) => void,
): ViewControls => {
  const choices: ViewChoices = {
    showBones: false,
    showMeshes: true,
    showHidden: false,
    showBoxes: false,
    showGrid: true,
    lod: undefined,
    sky: SKIES[0][1],
  };
  const bones = pressedButton('Bones', 'B: show the skeleton', false);
  const model = pressedButton('Model', 'Draw the meshes', true);
  const hidden = pressedButton('Show hidden', 'Draw the meshes marked hidden', false);
  const boxes = pressedButton('Show boxes', 'Draw the collision boxes as wireframes', false);
  const grid = pressedButton('Grid', 'Draw the ground grid', true);
  const levels = element('select');
  const sky = element('select');
  let hiddenCount = 0;
  let boxCount = 0;

  levels.title = 'HLOD level of detail';
  sky.title = 'Background';
  sky.append(...SKIES.map(([label, value]) => new Option(label, value)));

  const toggle = (
    button: HTMLButtonElement,
    key: 'showBones' | 'showMeshes' | 'showHidden' | 'showBoxes' | 'showGrid',
    describe: (on: boolean) => string,
  ) => {
    const flip = () => {
      choices[key] = !choices[key];
      button.setAttribute('aria-pressed', String(choices[key]));
      onChange(describe(choices[key]));
    };

    button.onclick = flip;
    return flip;
  };
  const toggleBones = toggle(
    bones,
    'showBones',
    (on) => `bones ${on ? 'shown' : 'hidden'}`,
  );

  toggle(model, 'showMeshes', (on) => `model ${on ? 'shown' : 'hidden'}`);
  toggle(
    hidden,
    'showHidden',
    (on) => `hidden meshes ${on ? 'shown' : 'not drawn'} (${hiddenCount})`,
  );
  toggle(boxes, 'showBoxes', (on) => `boxes ${on ? 'shown' : 'hidden'} (${boxCount})`);
  toggle(grid, 'showGrid', (on) => `grid ${on ? 'shown' : 'hidden'}`);
  levels.onchange = () => {
    choices.lod = Number(levels.value);
    onChange(`LOD ${choices.lod}`);
  };
  sky.onchange = () => {
    choices.sky = sky.value;
    onChange('');
  };

  const setLevels = (lods: NonNullable<ViewerModel['hlod']>['lods']) => {
    levels.replaceChildren(
      ...(lods.length
        ? lods.map((lod, at) => new Option(describeLevel(lod, at), String(at)))
        : [new Option('LOD', '')]),
    );
    levels.value = lods.length ? String(lods.length - 1) : '';
    // One level, as in every retail model, leaves nothing to pick
    levels.disabled = lods.length < 2;
    choices.lod = undefined;
  };

  setLevels([]);

  return {
    controls: [bones, model, hidden, boxes, grid, levels, sky],
    choices,
    setModel: (shown, rules) => {
      const meshes = shown?.meshes ?? [];

      hiddenCount = findHidingSources(meshes, rules, shown?.skeleton?.parents).filter(
        Boolean,
      ).length;
      boxCount = shown?.boxes.length ?? 0;
      bones.disabled = !shown?.skeleton;
      model.disabled = !meshes.length;
      hidden.disabled = !hiddenCount;
      boxes.disabled = !boxCount;
      // Bones are all a skeleton without meshes has to show
      if (shown?.skeleton && !meshes.length && !choices.showBones) {
        toggleBones();
      }
      setLevels(shown?.hlod?.lods ?? []);
    },
    toggleBones,
  };
};
