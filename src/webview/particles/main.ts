import { STEP_HZ } from '../../formats/particles/particleSimulation';
import {
  attachCamera,
  cameraBasis,
  rootOrigin,
  viewProjection,
} from './camera';
import { renderCurves } from './curves';
import { renderFields } from './fields';
import {
  beginFrame,
  canvas,
  drawLines,
  drawSystems,
  hasGraphics,
  loadTextures,
} from './graphics';
import { $, library, post, state, world } from './page';
import type { ToPage } from './protocol';
import { GRID, reach, volumeLines } from './volume';

/**
 * The particle preview page: runs the simulation at 30 Hz, draws it, and
 * turns every number of the previewed block into a slider. The extension
 * owns the definitions; the page sends slider values and gets the scene
 * back.
 */

const hud = $('hud');
const checked = (id: string) => $<HTMLInputElement>(id).checked;
const selected = (id: string) => $<HTMLSelectElement>(id).value;

if (!hasGraphics) {
  hud.textContent =
    'WebGL is not available here, so nothing is drawn; the simulation still runs.';
}

/** Starts the previewed block over */
const start = () => {
  world.clear();
  state.time = 0;
  state.accumulator = 0;
  state.idle = 0;

  const scene = state.scene;

  if (!scene) {
    return;
  }

  const origin = rootOrigin();

  state.roots =
    scene.root.kind === 'fxList'
      ? world.fire(scene.root.name, origin)
      : [world.spawn(scene.root.name, origin)].filter(
          (id): id is number => id !== undefined,
        );
};

const stepOnce = () => {
  const origin = rootOrigin();

  for (const id of state.roots) {
    world.setOrigin(id, origin);
  }
  world.step();
  state.time += 1 / STEP_HZ;
};

const draw = () => {
  beginFrame(selected('sky'));

  const basis = cameraBasis();
  const matrix = viewProjection(basis, canvas);

  if (checked('showGrid')) {
    drawLines(GRID, matrix, true);
  }
  drawSystems(
    matrix,
    basis,
    state.playing ? Math.min(1, state.accumulator * STEP_HZ) : 1,
    checked('keys'),
  );
  if (checked('showVolume')) {
    const lines: number[] = [];

    for (const system of world.systems) {
      const def = library.systems.get(system.name.toLowerCase());

      if (def && state.roots.includes(system.id)) {
        volumeLines(lines, def, system.origin);
      }
    }
    drawLines(lines, matrix, false);
  }
};

let last = performance.now();
let lastStatus = 0;

const frame = (now: number) => {
  const seconds = Math.min(0.25, (now - last) / 1000);

  last = now;
  if (state.playing && state.scene) {
    state.accumulator += seconds * state.speed;

    let steps = 0;

    while (state.accumulator >= 1 / STEP_HZ && steps++ < 8) {
      state.accumulator -= 1 / STEP_HZ;
      stepOnce();
    }
    if (!world.systems.length) {
      state.idle += seconds;
      if (checked('loop') && state.idle > 0.6) {
        start();
      }
    }
  }
  if (hasGraphics) {
    draw();
  }
  hud.textContent = [
    ...(hasGraphics ? [] : ['WebGL is not available; nothing is drawn.']),
    `frame ${world.frame}  ${(world.frame / STEP_HZ).toFixed(1)} s`,
    `${world.systems.length} systems  ${world.liveParticles} particles` +
      (world.dropped ? `  dropped ${world.dropped}` : ''),
    `wind ${world.options.wind}  hollow box ${world.options.hollowBox}`,
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
  requestAnimationFrame(frame);
};

// ---- Controls

const setPlaying = (playing: boolean) => {
  state.playing = playing;
  $('play').textContent = playing ? 'Pause' : 'Play';
};
const syncOptions = () => {
  world.options.wind = selected('wind') as typeof world.options.wind;
  world.options.hollowBox = selected(
    'hollowBox',
  ) as typeof world.options.hollowBox;
  world.options.compound = checked('compound');
  world.options.batchLimit = checked('batchLimit');
};
const cycle = (id: string) => {
  const select = $<HTMLSelectElement>(id);

  select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
  select.dispatchEvent(new Event('change'));
};

attachCamera(canvas);
$('play').onclick = () => setPlaying(!state.playing);
$('restart').onclick = () => start();
$('step').onclick = () => {
  setPlaying(false);
  stepOnce();
};
$('speed').onchange = () => (state.speed = Number(selected('speed')));
for (const id of ['wind', 'hollowBox', 'compound', 'batchLimit']) {
  $(id).onchange = () => {
    syncOptions();
    start();
  };
}
$('apply').onclick = () => post({ kind: 'apply' });
$('reset').onclick = () => post({ kind: 'reset' });

window.addEventListener('keydown', (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === ' ') {
    event.preventDefault();
    setPlaying(!state.playing);
  } else if (key === 'r') {
    start();
  } else if (key === '.') {
    setPlaying(false);
    stepOnce();
  } else if (key === 'w') {
    cycle('wind');
  } else if (key === 'h') {
    cycle('hollowBox');
  }
});

window.addEventListener('message', ({ data }: MessageEvent<ToPage>) => {
  if (data.kind === 'notice') {
    $('notice').textContent = data.message;
    return;
  }

  const first = !state.scene;

  state.scene = data;
  library.systems = new Map(Object.entries(data.systems));
  library.fxLists = new Map(Object.entries(data.fxLists));
  loadTextures(data.textures);
  $('title').textContent =
    (data.root.kind === 'fxList' ? 'FX list ' : '') + data.root.name;
  $('notice').textContent = '';
  $('notes').replaceChildren(
    ...data.notes.map((note) => {
      const line = document.createElement('div');

      line.textContent = '• ' + note;
      return line;
    }),
  );
  renderFields(data);
  renderCurves();
  if (first) {
    const def = library.systems.get(data.root.name.toLowerCase());

    state.distance = def ? reach(def) * 2.2 : 260;
    state.target = [0, 0, def ? Math.min(80, reach(def) / 3) : 20];
  }
  if (data.restart || first) {
    start();
  }
});

syncOptions();
requestAnimationFrame(frame);
post({ kind: 'ready' });
