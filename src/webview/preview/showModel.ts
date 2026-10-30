import { poseAt } from "../../formats/w3d/w3dPose";
import type { Pose, Vec3 } from "../../formats/w3d/w3dPose";
import type { W3dAnimation } from "../../formats/w3d/w3dAnimation";
import { createModelRenderer } from "../shared/modelRenderer";
import { createOrbit } from "../shared/orbit";
import type { FileUse, ModelMessage } from "./protocol";

/**
 * The W3D viewer's model view: the model textured and skinned, its
 * skeleton's animations to play on it, its bones as a toggle (B), off
 * whenever there are meshes to show, the HLOD level of detail to draw, a
 * toggle for the meshes marked hidden and one for collision boxes. The
 * preview page calls `showModel` with the extension's message and gets back
 * the controls later messages drive.
 */

interface Host {
  main: HTMLElement;
  post: (
    message:
      | { kind: "animation"; file: string }
      | { kind: "reveal"; uri: string; line: number },
  ) => void;
}

/** Controls the preview page's message handler drives the model view through */
export interface ModelControl {
  /** Adds the animation files that fit the skeleton to the animation list */
  setAnimations(names: string[]): void;
  /** Plays an animation on the skeleton, warning when it was made for another one */
  play(message: { file: string; animation: W3dAnimation }): void;
  /** Shows a short message in the status line */
  notice(text: string): void;
  /** Where the INI files use the file, each a link to the line */
  setUses(uses: FileUse[]): void;
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  properties: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), properties);

/** Animation list value standing for the animation the shown file holds itself */
const OWN = "#own";

/** Shows a W3D model in 3D; returns undefined when WebGL is not available */
export const showModel = (
  message: ModelMessage,
  { main, post }: Host,
): ModelControl | undefined => {
  const { meshes, missing, hierarchy, bounds, skeleton } = message;
  const canvas = element("canvas", { className: "model" });
  const info = element("p");
  const usedIn = element("p");
  const controls = element("div", { className: "controls" });
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
    ...(missing.length ? [`textures not found: ${missing.join(", ")}`] : []),
    "drag to orbit, scroll to zoom, double-click to reset, B for bones",
  ].join(" · ");
  main.replaceChildren(controls, canvas, info, usedIn);

  const gl = canvas.getContext("webgl", { antialias: true });

  if (!gl) {
    info.textContent = "This view needs WebGL, which is not available here.";
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
    showHidden: false,
    showBoxes: false,
    // The finest level, which the HLOD stores last
    lod: undefined as number | undefined,
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
      lod: player.lod,
      showHidden: player.showHidden,
      showBoxes: player.showBoxes,
    });
  };
  const orbit = createOrbit(canvas, centre, radius, draw);

  renderer.setModel(message);

  const select = element("select");
  const play = element("button", { textContent: "Play", disabled: true });
  const slider = element("input", {
    type: "range",
    min: "0",
    step: "any",
    disabled: true,
  });
  const bones = element("button", {
    textContent: "Bones",
    title: "B: show the skeleton",
  });
  const label = element("span", { className: "status" });
  const hlod = message.hlod;
  const levels = element("select", { title: "HLOD level of detail" });
  const hiddenToggle = element("button", {
    textContent: "Show hidden",
    title: "Draw the meshes marked hidden",
  });
  const boxesToggle = element("button", {
    textContent: "Show boxes",
    title: "Draw the collision boxes as wireframes",
  });
  const lists = element("p");
  const hiddenCount = meshes.filter((mesh) => mesh.hidden).length;

  select.append(new Option(skeleton ? "Bind pose" : "No skeleton", ""));
  if (skeleton) {
    controls.append(select, play, slider, bones, label);
  }

  if (hlod && hlod.lods.length) {
    hlod.lods.forEach((lod, at) => {
      levels.append(
        new Option(
          `LOD ${at}: ${lod.meshes.length} meshes, ${
            lod.maxScreenSize === undefined
              ? "finest"
              : `max screen size ${lod.maxScreenSize}`
          }`,
          String(at),
        ),
      );
    });
    levels.value = String(hlod.lods.length - 1);
    controls.append(levels);
    lists.textContent = [
      `aggregates: ${hlod.aggregates.join(", ") || "none"}`,
      `proxies: ${hlod.proxies.join(", ") || "none"}`,
    ].join(" · ");
    main.append(lists);
  }
  if (hiddenCount) {
    controls.append(hiddenToggle);
  }
  if (message.boxes.length) {
    controls.append(boxesToggle);
  }

  const showFrame = () => {
    if (skeleton) {
      player.pose = poseAt(skeleton, player.animation, player.frame);
      renderer.setPose(player.pose);
    }
    slider.value = String(player.frame);
    label.textContent = player.animation
      ? `${player.animation.name} · frame ${player.frame.toFixed(1)} / ${player.animation.frameCount} · ${player.animation.frameRate} fps`
      : "";
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
    play.textContent = player.playing ? "Pause" : "Play";
    player.last = 0;
    if (player.playing) {
      requestAnimationFrame(tick);
    }
  };

  const toggleBones = () => {
    player.showBones = !player.showBones;
    bones.setAttribute("aria-pressed", String(player.showBones));
    label.textContent = `bones ${player.showBones ? "shown" : "hidden"}`;
    draw();
  };

  bones.setAttribute("aria-pressed", String(player.showBones));
  hiddenToggle.setAttribute("aria-pressed", "false");
  boxesToggle.setAttribute("aria-pressed", "false");
  levels.onchange = () => {
    player.lod = Number(levels.value);
    label.textContent = `LOD ${player.lod}`;
    draw();
  };
  hiddenToggle.onclick = () => {
    player.showHidden = !player.showHidden;
    hiddenToggle.setAttribute("aria-pressed", String(player.showHidden));
    label.textContent = `hidden meshes ${player.showHidden ? "shown" : "not drawn"} (${hiddenCount})`;
    draw();
  };
  boxesToggle.onclick = () => {
    player.showBoxes = !player.showBoxes;
    boxesToggle.setAttribute("aria-pressed", String(player.showBoxes));
    label.textContent = `boxes ${player.showBoxes ? "shown" : "hidden"} (${message.boxes.length})`;
    draw();
  };
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
      post({ kind: "animation", file: select.value });
    }
  };
  document.addEventListener("keydown", (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }
    if (event.key.toLowerCase() === "b" && skeleton) {
      toggleBones();
    } else if (event.key === " ") {
      event.preventDefault();
      setPlaying(!player.playing);
    }
  });
  window.addEventListener("resize", draw);

  const control: ModelControl = {
    setAnimations: (names) =>
      select.append(
        ...names.map((name) => new Option(name.replace(/\.w3d$/i, ""), name)),
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
    setUses: (uses) => {
      usedIn.replaceChildren(
        uses.length
          ? "Used in: "
          : "No INI file the index holds uses this file",
        ...uses.flatMap((use, at) => {
          const link = element("a", {
            href: "#",
            textContent: `${use.owner ?? use.uri.slice(use.uri.lastIndexOf("/") + 1)} (${use.field}, line ${use.line + 1})`,
          });

          link.onclick = (event) => {
            event.preventDefault();
            post({ kind: "reveal", uri: use.uri, line: use.line });
          };
          return at ? [" · ", link] : [link];
        }),
      );
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
