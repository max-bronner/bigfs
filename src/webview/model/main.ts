import { poseAt } from '../../formats/w3dPose';
import type { Pose, Vec3 } from '../../formats/w3dPose';
import type { W3dAnimation } from '../../formats/w3dAnimation';
import type { ModelScene } from '../../formats/w3dScene';
import { createModelRenderer } from '../scene/modelRenderer';
import { createOrbit } from '../scene/orbit';

/**
 * The W3D viewer's model view: the model textured and skinned, its
 * skeleton's animations to play on it, and its bones as a toggle (B), off
 * whenever there are meshes to show. The preview page calls `showModel`
 * with the extension's message and gets back the controls later messages
 * drive.
 */

export interface ModelMessage extends ModelScene {
  /** The model an animation file is shown on, found by its skeleton */
  shownOn?: string;
}

interface Host {
  main: HTMLElement;
  post: (message: { kind: 'animation'; file: string }) => void;
}

export interface ModelControl {
  setAnimations(names: string[]): void;
  play(message: { file: string; animation: W3dAnimation }): void;
  notice(text: string): void;
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), properties);

const OWN = '#own';

const showModel = (
  message: ModelMessage,
  { main, post }: Host,
): ModelControl | undefined => {
  const { meshes, missing, hierarchy, bounds, skeleton } = message;
  const canvas = element('canvas', { className: 'model' });
  const info = element('p');
  const controls = element('div', { className: 'controls' });
  const triangles = meshes.reduce(
    (total, mesh) => total + mesh.indices.length / 3,
    0,
  );

  info.textContent = [
    ...(message.shownOn
      ? [`shown on ${message.shownOn}, the model drawn on its skeleton`]
      : []),
    `${meshes.length} meshes`,
    `${triangles} triangles`,
    ...(hierarchy && skeleton
      ? [`skeleton ${hierarchy} (${skeleton.parents.length} bones)`]
      : []),
    ...(missing.length ? [`textures not found: ${missing.join(', ')}`] : []),
    'drag to orbit, scroll to zoom, double-click to reset, B for bones',
  ].join(' · ');
  main.replaceChildren(controls, canvas, info);

  const gl = canvas.getContext('webgl', { antialias: true });

  if (!gl) {
    info.textContent = 'This view needs WebGL, which is not available here.';
    return undefined;
  }

  const renderer = createModelRenderer(gl);
  const centre = [0, 1, 2].map(
    (axis) => (bounds.min[axis] + bounds.max[axis]) / 2,
  ) as Vec3;
  const radius = Math.max(
    1e-3,
    Math.hypot(
      ...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]),
    ) / 2,
  );
  const player = {
    animation: undefined as W3dAnimation | undefined,
    frame: 0,
    playing: false,
    showBones: !meshes.length,
    pose: undefined as Pose | undefined,
    last: 0,
  };

  const draw = () => {
    const width = Math.max(1, Math.floor(main.clientWidth - 24));
    const height = Math.max(240, Math.floor(window.innerHeight - 170));
    const ratio = window.devicePixelRatio || 1;

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.16, 0.17, 0.19, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    renderer.draw(orbit.viewProjection(canvas.width / canvas.height), {
      light: orbit.towardsEye(),
      showBones: player.showBones,
    });
  };
  const orbit = createOrbit(canvas, centre, radius, draw);

  renderer.setModel(message);

  const select = element('select');
  const play = element('button', { textContent: 'Play', disabled: true });
  const slider = element('input', {
    type: 'range',
    min: '0',
    step: 'any',
    disabled: true,
  });
  const bones = element('button', {
    textContent: 'Bones',
    title: 'B: show the skeleton',
  });
  const label = element('span', { className: 'status' });

  select.append(new Option(skeleton ? 'Bind pose' : 'No skeleton', ''));
  if (skeleton) {
    controls.append(select, play, slider, bones, label);
  }

  const showFrame = () => {
    if (skeleton) {
      player.pose = poseAt(skeleton, player.animation, player.frame);
      renderer.setPose(player.pose);
    }
    slider.value = String(player.frame);
    label.textContent = player.animation
      ? `${player.animation.name} · frame ${player.frame.toFixed(1)} / ${player.animation.frameCount} · ${player.animation.frameRate} fps`
      : '';
    draw();
  };

  const tick = (time: number) => {
    const animation = player.animation;

    if (!player.playing || !animation) {
      return;
    }

    const elapsed = player.last ? (time - player.last) / 1000 : 0;

    player.last = time;
    player.frame =
      (player.frame + elapsed * animation.frameRate) %
      Math.max(1, animation.frameCount - 1);
    showFrame();
    requestAnimationFrame(tick);
  };

  const setPlaying = (playing: boolean) => {
    player.playing = playing && !!player.animation;
    play.textContent = player.playing ? 'Pause' : 'Play';
    player.last = 0;
    if (player.playing) {
      requestAnimationFrame(tick);
    }
  };

  const toggleBones = () => {
    player.showBones = !player.showBones;
    bones.setAttribute('aria-pressed', String(player.showBones));
    label.textContent = `bones ${player.showBones ? 'shown' : 'hidden'}`;
    draw();
  };

  bones.setAttribute('aria-pressed', String(player.showBones));
  play.onclick = () => setPlaying(!player.playing);
  slider.oninput = () => {
    setPlaying(false);
    player.frame = Number(slider.value);
    showFrame();
  };
  bones.onclick = toggleBones;
  select.onchange = () => {
    if (!select.value) {
      player.animation = undefined;
      setPlaying(false);
      play.disabled = slider.disabled = true;
      player.frame = 0;
      showFrame();
    } else if (select.value === OWN && message.animation) {
      control.play({ file: OWN, animation: message.animation });
    } else {
      label.textContent = `Loading ${select.value}…`;
      post({ kind: 'animation', file: select.value });
    }
  };
  document.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.key.toLowerCase() === 'b' && skeleton) {
      toggleBones();
    } else if (event.key === ' ') {
      event.preventDefault();
      setPlaying(!player.playing);
    }
  });
  window.addEventListener('resize', draw);

  const control: ModelControl = {
    setAnimations: (names) =>
      select.append(
        ...names.map((name) => new Option(name.replace(/\.w3d$/i, ''), name)),
      ),
    play: ({ file, animation }) => {
      if (!skeleton) {
        return;
      }
      if (
        animation.hierarchyName.toLowerCase() !== skeleton.name.toLowerCase()
      ) {
        info.textContent = `${animation.name} is made for ${animation.hierarchyName}, not ${skeleton.name}; it may look wrong.`;
      }
      player.animation = animation;
      player.frame = 0;
      select.value = file;
      play.disabled = slider.disabled = false;
      slider.max = String(Math.max(0, animation.frameCount - 1));
      showFrame();
      setPlaying(true);
    },
    notice: (text) => {
      label.textContent = text;
    },
  };

  if (message.animation && skeleton) {
    select.append(new Option(`${message.animation.name} (this file)`, OWN));
    control.play({ file: OWN, animation: message.animation });
  } else {
    showFrame();
  }
  return control;
};

// The preview page's own script calls it
(globalThis as { showModel?: typeof showModel }).showModel = showModel;
