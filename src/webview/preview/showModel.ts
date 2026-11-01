import {
  describeForeignClip,
  isOwnClip,
  poseAt,
} from "../../formats/w3d/w3dPose";
import type { Pose, Vec3 } from "../../formats/w3d/w3dPose";
import type { W3dAnimation } from "../../formats/w3d/w3dAnimation";
import type { ForeignClip } from "../../formats/w3d/w3dModelFinder";
import { isSurfaceAnimated } from "../../formats/w3d/w3dMaterial";
import { findHidingSources, getMeshVisibility } from "../../formats/w3d/w3dScene";
import type { SceneSkeleton } from "../../formats/w3d/w3dScene";
import { createModelRenderer } from "../shared/modelRenderer";
import { createOrbit } from "../shared/orbit";
import type { FileUse, ModelMessage } from "./protocol";

/**
 * The W3D viewer's model view: the model textured and skinned, one clock for
 * its skeleton's animations and its animated materials, which Play and Pause
 * stop together, its bones as a toggle (B), off
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
  /** Adds the skeleton's own animation files to the list, then a group of other skeletons' */
  setAnimations(own: string[], foreign: ForeignClip[]): void;
  /** Plays an animation on the skeleton, saying so when it was made for another */
  play(message: {
    file: string;
    animation: W3dAnimation;
    skeleton?: SceneSkeleton;
  }): void;
  /** Shows a short message in the status line */
  showNotice(text: string): void;
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
  const clipNotice = element("p");
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
  main.replaceChildren(controls, canvas, clipNotice, info, usedIn);

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
    /** A frame is on its way to `tick` */
    ticking: false,
    /** The clock of the animated materials */
    seconds: 0,
    showBones: !meshes.length,
    showHidden: false,
    partOverrides: new Map<number, boolean>(),
    showBoxes: false,
    // The last level the header counts, the finest
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
      partOverrides: player.partOverrides,
      showBoxes: player.showBoxes,
      seconds: player.seconds,
      camera: orbit.camera(),
    });
  };
  const orbit = createOrbit(canvas, centre, radius, draw);

  renderer.setModel(message);

  const select = element("select");
  const animatesMaterials = meshes.some((mesh) =>
    mesh.draws?.some((each) => isSurfaceAnimated(each.surface)),
  );
  const play = element("button", { textContent: "Play", disabled: !animatesMaterials });
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
  const parts = element("details");
  const partsSummary = element("summary");
  const partRows = element("div");
  const hiding = findHidingSources(meshes);

  const renderParts = () => {
    const drawn = getMeshVisibility(message, {
      lod: player.lod,
      showHidden: player.showHidden,
      partOverrides: player.partOverrides,
    }).filter(Boolean).length;

    partsSummary.textContent = [
      `Parts: ${drawn} of ${meshes.length} drawn`,
      ...(hiddenCount && !player.showHidden
        ? [`${hiddenCount} off by the W3D HIDDEN flag`]
        : []),
    ].join(" · ");
    partRows.replaceChildren(
      ...meshes.map((mesh, at) => {
        const box = element("input", {
          type: "checkbox",
          checked:
            player.partOverrides.get(at) ?? (player.showHidden || !hiding[at]),
        });
        const row = element("label");
        const line = element("div");

        box.onchange = () => {
          player.partOverrides.set(at, box.checked);
          renderParts();
          draw();
        };
        row.append(box, ` ${mesh.name}${hiding[at] ? ` (off by ${hiding[at]})` : ""}`);
        line.append(row);
        return line;
      }),
    );
  };

  if (meshes.length) {
    parts.append(
      partsSummary,
      element("p", {
        textContent:
          "A .w3d alone knows only its own HIDDEN flags. The game hides more from the object's INI and scripts: use Preview object on its INI to see those.",
      }),
      partRows,
    );
    main.append(parts);
    renderParts();
  }

  select.append(new Option(skeleton ? "Bind pose" : "No skeleton", ""));
  if (skeleton) {
    controls.append(select, play, slider, bones, label);
  } else if (animatesMaterials) {
    controls.append(play);
  }

  if (hlod && hlod.lods.length) {
    // One level, as in every retail model, leaves nothing to pick
    if (hlod.lods.length > 1) {
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
    }
    lists.textContent = [
      `${hlod.lods.length} level${hlod.lods.length === 1 ? "" : "s"} of detail`,
      ...(hlod.skippedLodCount
        ? [`${hlod.skippedLodCount} more LOD array${hlod.skippedLodCount === 1 ? "" : "s"} in the file past the header's count, which the game does not read`]
        : []),
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

    if (!player.playing || !canvas.isConnected) {
      player.ticking = false;
      return;
    }

    const elapsed = player.last ? (time - player.last) / 1000 : 0;

    player.last = time;
    player.seconds += elapsed;
    if (animation) {
      player.frame =
        (player.frame + elapsed * animation.frameRate) %
        Math.max(1, animation.frameCount - 1);
      showFrame();
    } else {
      draw();
    }
    requestAnimationFrame(tick);
  };

  const setPlaying = (playing: boolean) => {
    player.playing = playing && (!!player.animation || animatesMaterials);
    play.textContent = player.playing ? "Pause" : "Play";
    player.last = 0;
    if (player.playing && !player.ticking) {
      player.ticking = true;
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
    renderParts();
    draw();
  };
  hiddenToggle.onclick = () => {
    player.showHidden = !player.showHidden;
    hiddenToggle.setAttribute("aria-pressed", String(player.showHidden));
    label.textContent = `hidden meshes ${player.showHidden ? "shown" : "not drawn"} (${hiddenCount})`;
    renderParts();
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

    const frame = Number(slider.value);

    // Scrubbing moves the materials by as much as it moves the clip
    player.seconds += (frame - player.frame) / (player.animation?.frameRate || 1);
    player.frame = frame;
    showFrame();
  };
  bones.onclick = toggleBones;
  select.onchange = () => {
    if (!select.value) {
      player.animation = undefined;
      clipNotice.textContent = "";
      setPlaying(animatesMaterials);
      slider.disabled = true;
      play.disabled = !animatesMaterials;
      player.frame = 0;
      showFrame();
    } else if (select.value === OWN && message.animation) {
      control.play({
        file: OWN,
        animation: message.animation,
        skeleton: message.animationSkeleton,
      });
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
    setAnimations: (own, foreign) => {
      select.append(
        ...own.map((name) => new Option(name.replace(/\.w3d$/i, ""), name)),
      );
      if (foreign.length) {
        const others = element("optgroup", { label: "Made for other skeletons" });

        others.append(
          ...foreign.map(
            ({ file, hierarchyName }) =>
              new Option(`${file.replace(/\.w3d$/i, "")} (${hierarchyName})`, file),
          ),
        );
        select.append(others);
      }
    },
    play: ({ file, animation, skeleton: clipSkeleton }) => {
      if (!skeleton) {
        return;
      }

      clipNotice.textContent = isOwnClip(skeleton, animation, clipSkeleton)
        ? ""
        : describeForeignClip(animation);
      player.animation = animation;
      player.frame = 0;
      select.value = file;
      play.disabled = slider.disabled = false;
      slider.max = String(Math.max(0, animation.frameCount - 1));
      showFrame();
      setPlaying(true);
    },
    showNotice: (text) => {
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
    showFrame();
    control.play({
      file: OWN,
      animation: message.animation,
      skeleton: message.animationSkeleton,
    });
  } else {
    showFrame();
    setPlaying(true);
  }
  return control;
};
