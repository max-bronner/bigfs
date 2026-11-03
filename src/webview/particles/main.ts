import { pageSoundPlayer } from '../shared/pageSoundPlayer';
import { getEffectStateAt } from '../../formats/particles/fxEffects';
import { scaleEffect } from '../../formats/particles/particleScale';
import { STEP_HZ } from '../../formats/particles/particleSimulation';
import { attachment, getModelOrigin, getRootOrigin } from './emitterOrigin';
import { renderCurves } from './curves';
import { renderFields } from './fields';
import { attachHandles, drawHandles } from './handles';
import { resetStats, sampleStats, showStats } from './stats';
import {
  drawTimeline,
  getTimelineSeconds,
  listEffects,
  renderTimeline,
  skipDueSounds,
} from './timeline';
import { drawSystems, hasGraphics, loadTextures } from './graphics';
import { $, library, post, state, viewer, world } from './page';
import {
  getBonePosition,
  listEnabledEffects,
  objectView,
  refreshShownModel,
  setLoadedAnimation,
  showObject,
} from './objectPanel';
import { poseAt } from '../../formats/w3d/w3dPose';
import type { Pose, Vec3 } from '../../formats/w3d/w3dPose';
import type { ViewerCamera } from '../shared/viewer/createViewer';
import type { ToPage } from './protocol';
import { pushRing, estimateReach, pushVolumeLines } from './volume';

/**
 * The particle preview page: a layer on the shared viewer that runs the
 * simulation at 30 Hz on the viewer's clock, draws it, and turns every number
 * of the previewed block into a slider. The extension owns the definitions;
 * the page sends slider values and gets the scene back.
 */

/** Most steps one frame catches up on, so a slow simulation never stalls the page */
const MAX_FRAME_STEPS = 8;
/** Most steps a drag of the time slider runs at once */
const MAX_SEEK_STEPS = 1800;
/** Seconds the view stays empty after the last system ends before the loop goes round */
const LOOP_PAUSE = 0.6;
/** Length of an effect that does not say, as one that runs until stopped: four seconds */
const OPEN_ENDED_FRAMES = STEP_HZ * 4;
/** The shortest time slider an effect gets */
const MIN_EFFECT_FRAMES = STEP_HZ * 2;
/** Distance from the emitter to frame an effect at, in reaches, and in orbit radii */
const REACH_DISTANCE = 2.2;
const DISTANCE_RADII = 2.6;
const DEFAULT_DISTANCE = 260;

const hud = $('hud');
const isChecked = (id: string) => $<HTMLInputElement>(id).checked;
const getSelectedValue = (id: string) => $<HTMLSelectElement>(id).value;

if (!hasGraphics) {
  hud.textContent =
    'WebGL is not available here, so nothing is drawn; the simulation still runs.';
}

/** The systems an object's effects started, with the bone each follows */
let attached: { id: number; bone?: string }[] = [];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Last time on the clock a system was alive */
let lastBusyTime = 0;

/** Starts the previewed block over */
const startEffects = () => {
  world.clear();
  lastBusyTime = 0;
  resetStats();

  const scene = state.scene;

  if (!scene) {
    return;
  }

  if (objectView.scene) {
    attached = listEnabledEffects().flatMap((effect) => {
      const origin = add(getModelOrigin(), getBonePosition(effect.bone));
      const ids =
        effect.kind === 'fxList'
          ? world.fire(effect.name, origin)
          : [world.spawn(effect.name, origin)];

      return ids
        .filter((id): id is number => id !== undefined)
        .map((id) => ({ id, bone: effect.bone }));
    });
    state.roots = attached.map((each) => each.id);
    return;
  }
  if (!scene.root) {
    return;
  }

  const origin = getRootOrigin();

  state.roots =
    scene.root.kind === 'fxList'
      ? world.fire(scene.root.name, origin)
      : [world.spawn(scene.root.name, origin)].filter(
          (id): id is number => id !== undefined,
        );
};

const stepOnce = () => {
  const origin = getRootOrigin();

  if (objectView.scene) {
    // Each effect follows the bone it is on, as the model moves and animates
    for (const { id, bone } of attached) {
      world.setOrigin(id, add(getModelOrigin(), getBonePosition(bone)));
    }
  } else {
    for (const id of state.roots) {
      world.setOrigin(id, origin);
    }
  }
  world.step();
  sampleStats();
};

/** Runs the simulation up to a time on the clock, at most `maxSteps` steps */
const stepTo = (time: number, maxSteps: number) => {
  const due = Math.floor(time * STEP_HZ);

  for (let steps = 0; world.frame < due && steps < maxSteps; steps++) {
    stepOnce();
  }
  if (world.systems.length) {
    lastBusyTime = time;
  }
};

/** Gets the seconds the time slider spans for the effects on show */
const getEffectSeconds = (): number => {
  const scene = state.scene;

  if (!scene || !state.roots.length) {
    return 0;
  }

  const def =
    scene.root?.kind === 'system'
      ? library.systems.get(scene.root.name.toLowerCase())
      : undefined;
  const frames =
    def && def.systemLifetime > 0
      ? def.systemLifetime + Math.max(def.lifetime.low, def.lifetime.high)
      : OPEN_ENDED_FRAMES;

  return getTimelineSeconds() ?? Math.max(frames, MIN_EFFECT_FRAMES) / STEP_HZ;
};

const flash = $('flash');

/** LightPulse, ViewShake and TerrainScorch nuggets, approximated */
let effects = getEffectStateAt([], 0, STEP_HZ);

const prepareFrame = () => {
  effects = objectView.scene
    ? getEffectStateAt([], 0, STEP_HZ)
    : getEffectStateAt(listEffects(), world.frame, STEP_HZ);

  if (effects.flash) {
    const [red, green, blue] = effects.flash.color.map((channel) =>
      Math.round(channel * 255),
    );

    flash.style.background = `rgba(${red}, ${green}, ${blue}, ${effects.flash.alpha})`;
  } else {
    flash.style.background = 'transparent';
  }
  return {
    shake: (effects.shake * Math.PI) / 180,
    modelOffset: getModelOrigin(),
  };
};

const draw = ({ matrix, basis }: ViewerCamera) => {
  const between = viewer.getTime() * STEP_HZ - world.frame;

  drawSystems(
    matrix,
    basis,
    viewer.isPlaying() ? Math.max(0, Math.min(1, between)) : 1,
    isChecked('keys'),
  );
  if (effects.scorches.length) {
    const lines: number[] = [];
    const [x, y, z] = getRootOrigin();

    for (const radius of effects.scorches) {
      pushRing(lines, [x, y, z], radius, [0.85, 0.5, 0.2, 1]);
    }
    viewer.drawLines(lines, matrix, false);
  }
  if (isChecked('showVolume')) {
    const lines: number[] = [];

    for (const system of world.systems) {
      const def = library.systems.get(system.name.toLowerCase());

      if (def && state.roots.includes(system.id)) {
        pushVolumeLines(lines, def, system.origin);
      }
    }
    viewer.drawLines(lines, matrix, false);
  }
  drawHandles();
};

let lastStatus = 0;

const onFrame = (now: number) => {
  drawTimeline();
  showStats(now);
  hud.textContent = [
    ...(hasGraphics ? [] : ['WebGL is not available; nothing is drawn.']),
    `frame ${world.frame}  ${(world.frame / STEP_HZ).toFixed(1)} s`,
    `${world.systems.length} systems  ${world.liveParticles} particles` +
      (world.dropped ? `  dropped ${world.dropped}` : ''),
    `wind ${world.options.wind}  hollow box ${world.options.hollowBox}`,
    ...(state.scene?.comparing ? ['showing the block as written (C)'] : []),
  ].join('\n');
  if (now - lastStatus > 1000) {
    lastStatus = now;
    post({
      kind: 'status',
      frame: world.frame,
      systems: world.systems.length,
      particles: world.liveParticles,
    });
  }
};

// ---- Controls

const syncOptions = () => {
  world.options.wind = getSelectedValue('wind') as typeof world.options.wind;
  world.options.hollowBox = getSelectedValue(
    'hollowBox',
  ) as typeof world.options.hollowBox;
  world.options.compound = isChecked('compound');
  world.options.batchLimit = isChecked('batchLimit');
};
const cycle = (id: string) => {
  const select = $<HTMLSelectElement>(id);

  select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
  select.dispatchEvent(new Event('change'));
};

attachHandles();
for (const id of ['wind', 'hollowBox', 'compound', 'batchLimit']) {
  $(id).onchange = () => {
    syncOptions();
    viewer.restart();
  };
}
$('apply').onclick = () => post({ kind: 'apply' });
const compare = () => post({ kind: 'compare', on: !state.scene?.comparing });
$('compare').onclick = compare;
$('variant').onclick = () => post({ kind: 'variant' });
$('vary').onclick = () => {
  const scene = state.scene;
  const amount = Number($<HTMLInputElement>('varyAmount').value) / 100;

  if (!scene || !(amount > 0)) {
    return;
  }
  post({
    kind: 'setMany',
    values: Object.fromEntries(
      scene.fields
        // Key frames keep their order; everything else may move
        .filter((field) => field.part !== 'frame')
        .map((field) => {
          const current = scene.values[field.id] ?? field.value;
          const next = current * (1 + (Math.random() * 2 - 1) * amount);

          return [
            field.id,
            field.integer ? Math.round(next) : Number(next.toFixed(4)),
          ];
        }),
    ),
  });
};
$('scale').onclick = () => {
  const scene = state.scene;

  if (!scene) {
    return;
  }
  try {
    post({
      kind: 'setMany',
      values: Object.fromEntries(
        scaleEffect(
          scene.fields,
          new Map(Object.entries(scene.values)),
          Number($<HTMLInputElement>('scaleSpace').value),
          Number($<HTMLInputElement>('scaleTime').value),
        ),
      ),
    });
  } catch (error) {
    $('notice').textContent = (error as Error).message;
  }
};
$('reset').onclick = () => post({ kind: 'reset' });

const onKey = (key: string): boolean => {
  if (key === 'w') {
    cycle('wind');
  } else if (key === 'h') {
    cycle('hollowBox');
  } else if (key === 'c') {
    compare();
  } else {
    return false;
  }
  return true;
};

const bones = $<HTMLSelectElement>('bone');
let pose: Pose | undefined;

bones.onchange = () => {
  const bone = Number(bones.value);

  const at = bones.value === '' ? undefined : pose?.world[bone];

  attachment.bone = at ? [...at.t] : [0, 0, 0];
  // Looks at where the effect now starts
  viewer.orbit.setTarget([...attachment.bone]);
  viewer.restart();
};
$('pickModel').onclick = () => post({ kind: 'pickModel' });

window.addEventListener('message', ({ data }: MessageEvent<ToPage>) => {
  if (data.kind === 'sound') {
    void pageSoundPlayer.receive(data);
    return;
  }
  if (data.kind === 'notice') {
    $('notice').textContent = data.message;
    return;
  }
  if (data.kind === 'object') {
    showObject(data.object, data.focus);
    return;
  }
  if (data.kind === 'animation') {
    setLoadedAnimation(data.name, data.animation, data.skeleton);
    return;
  }
  if (data.kind === 'model') {
    const shown = data.model;
    const skeleton = shown?.scene.skeleton;

    viewer.setModel(shown?.scene);
    pose = skeleton && poseAt(skeleton);
    bones.replaceChildren(
      new Option('origin', ''),
      ...(skeleton?.names ?? []).map(
        (bone, at) => new Option(bone, String(at)),
      ),
    );
    bones.hidden = !shown || !!objectView.scene;
    attachment.bone = [0, 0, 0];
    $('pickModel').textContent = shown ? shown.name : 'On a model…';
    if (objectView.scene) {
      refreshShownModel();
      return;
    }
    viewer.restart();
    return;
  }

  const first = !state.scene;

  state.scene = data;
  library.systems = new Map(Object.entries(data.systems));
  library.fxLists = new Map(Object.entries(data.fxLists));
  loadTextures(data.textures);
  if (data.root) {
    $('title').textContent =
      (data.root.kind === 'fxList' ? 'FX list ' : '') + data.root.name;
  }
  $('notice').textContent = '';
  $('notes').replaceChildren(
    ...data.notes.map((note) => {
      const line = document.createElement('div');

      line.textContent = '• ' + note;
      return line;
    }),
  );
  renderFields(data);
  $('compare').classList.toggle('on', data.comparing);
  $('compare').textContent = data.comparing
    ? 'A/B: as written (C)'
    : 'A/B: with changes (C)';
  renderCurves();
  renderTimeline(viewer.restart);
  if (first && !viewer.getModel()) {
    const def = data.root && library.systems.get(data.root.name.toLowerCase());
    const reach = def ? estimateReach(def) : 0;

    viewer.orbit.frame(
      [0, 0, def ? Math.min(80, reach / 3) : 20],
      (def ? reach * REACH_DISTANCE : DEFAULT_DISTANCE) / DISTANCE_RADII,
    );
  }
  if (data.restart || first) {
    viewer.restart();
  }
});

viewer.addLayer({
  getLength: getEffectSeconds,
  isBusy: () =>
    !!state.scene &&
    state.roots.length > 0 &&
    viewer.getTime() - lastBusyTime <= LOOP_PAUSE,
  onAdvance: (time) => {
    if (state.scene) {
      stepTo(time, MAX_FRAME_STEPS);
    }
  },
  onSeek: (time) => {
    if (time * STEP_HZ < world.frame) {
      startEffects();
    }
    stepTo(time, MAX_SEEK_STEPS);
    skipDueSounds();
  },
  onRestart: startEffects,
  onFrame,
  prepareFrame,
  draw,
  onKey,
});
syncOptions();
post({ kind: 'ready' });
