import {
  buildBoneLines,
  getMeshOpacity,
  isMeshShown,
  poseAt,
  skin,
} from "../../formats/w3d/w3dPose";
import type { Pose, Vec3 } from "../../formats/w3d/w3dPose";
import { getMeshVisibility } from "../../formats/w3d/w3dScene";
import type { VisibilityOptions } from "../../formats/w3d/w3dScene";
import type { ModelScene, SceneDraw, SceneMesh } from "../../formats/w3d/w3dScene";
import { DEFAULT_SURFACE } from "../../formats/w3d/w3dMaterial";
import type { W3dBlend, W3dSurface } from "../../formats/w3d/w3dMaterial";

/**
 * Draws a W3D model with WebGL: every material draw of every mesh textured
 * and lit from the camera, grey where its texture is missing, skinned on the
 * CPU to the pose it is given, its bones and collision boxes as lines when asked, one
 * level of detail at a time and without the meshes marked hidden. One
 * renderer serves the W3D viewer and the particle preview, so a model looks
 * the same in both. WebGL 1, which the particle preview draws with.
 */

const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 offset;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = normal;
  vUv = uv;
  gl_Position = viewProjection * vec4(position + offset, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec2 vUv;
uniform sampler2D tex;
uniform bool hasTexture;
uniform bool hasNormals;
uniform vec3 lightDirection;
uniform float alphaCutoff;
uniform bool useSolid;
uniform vec4 solid;
uniform float opacity;
uniform bool fadesColour;
uniform vec4 untextured;
void main() {
  if (useSolid) { gl_FragColor = solid; return; }
  vec4 base = hasTexture ? texture2D(tex, vUv) : untextured;
  if (base.a < alphaCutoff) discard;
  float light = hasNormals ? abs(dot(normalize(vNormal), lightDirection)) : 1.0;
  vec3 lit = base.rgb * (0.35 + 0.65 * light);
  gl_FragColor = fadesColour
    ? vec4(lit * opacity, base.a)
    : vec4(lit, base.a * opacity);
}`;

const BONE_COLOUR = [1, 0.75, 0.2, 1];
/** What a draw shows in place of a texture that was not found */
const MISSING_TEXTURE = [0.7, 0.7, 0.7, 1];
/** What a draw that names no texture shows: its lit colour alone */
const NO_TEXTURE = [1, 1, 1, 1];
const BOX_COLOUR = [0.3, 0.9, 0.5, 1];

/** Settings for one `ModelRenderer.draw` call: where the model stands, the light, and what to show */
export interface DrawOptions {
  /** Where the model stands */
  offset?: Vec3;
  /** Unit vector towards the light, usually towards the camera */
  light: Vec3;
  showBones: boolean;
  /** False draws the bones alone */
  showMeshes?: boolean;
  /** HLOD level to draw, an index into `hlod.lods`; the finest when absent */
  lod?: number;
  /** Draws the meshes marked HIDDEN or hidden by `subObjectRules` too */
  showHidden?: boolean;
  subObjectRules?: VisibilityOptions["subObjectRules"];
  partOverrides?: VisibilityOptions["partOverrides"];
  /** Draws the collision boxes as wireframes */
  showBoxes?: boolean;
}

/** WebGL renderer for one W3D model at a time, shared by the W3D viewer and the particle preview */
export interface ModelRenderer {
  /** Replaces the model, or clears it */
  setModel(scene: ModelScene | undefined): void;
  /** Skins the model to a pose; the bind pose when none */
  setPose(pose: Pose | undefined): void;
  /** Draws the model; does nothing until a model is set */
  draw(viewProjection: Float32Array | number[], options: DrawOptions): void;
}

/** Where a cutout material drops a texel: mint's `ALPHA_CUTOFF` */
const ALPHA_CUTOFF = 96 / 255;

/** One material draw of a mesh, uploaded */
interface DrawablePart {
  count: number;
  surface: W3dSurface;
  indexType: number;
  texture?: WebGLTexture;
  /** The draw names a texture that was not found */
  missingTexture: boolean;
  uv?: WebGLBuffer;
  index: WebGLBuffer;
}

/** A mesh's vertices, uploaded, and the parts that draw them */
interface Drawable {
  /** Index into `ModelScene.meshes` */
  mesh: number;
  hasNormals: boolean;
  position: WebGLBuffer;
  normal?: WebGLBuffer;
  parts: DrawablePart[];
  posed?: { positions: Float32Array; normals?: Float32Array };
}

/** The factors of each blended operation, source then destination */
const BLEND_FACTORS = (
  gl: WebGLRenderingContext,
): Record<Exclude<W3dBlend, "opaque">, [number, number]> => ({
  alpha: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
  additive: [gl.ONE, gl.ONE],
  multiply: [gl.ZERO, gl.SRC_COLOR],
  addScaledByAlpha: [gl.ONE, gl.SRC_ALPHA],
  addScaledByColor: [gl.ONE, gl.SRC_COLOR],
  addInverseScaledByColor: [gl.ONE, gl.ONE_MINUS_SRC_COLOR],
});

/** The draws of a mesh a scene gave none: one over all of it, from the mesh's own fields */
const getDraws = (mesh: SceneMesh): SceneDraw[] =>
  mesh.draws ?? [
    {
      pass: 0,
      surface: {
        ...DEFAULT_SURFACE,
        blend: mesh.blend,
        alphaTest: mesh.alphaTest,
        twoSided: true,
      },
      texture: mesh.texture,
      textured: mesh.texture !== undefined,
      uvs: mesh.uvs,
    },
  ];

const compile = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)!;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  }
  return shader;
};

/** The bind pose, cached by skeleton, for bones drawn before any pose is set */
const bindPoses = new WeakMap<object, Pose>();
const poseAtBind = (skeleton: NonNullable<ModelScene["skeleton"]>): Pose => {
  let pose = bindPoses.get(skeleton);

  if (!pose) {
    pose = poseAt(skeleton);
    bindPoses.set(skeleton, pose);
  }
  return pose;
};

const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0;

/** Creates a model renderer on a WebGL 1 context that other programs may share */
export const createModelRenderer = (
  gl: WebGLRenderingContext,
): ModelRenderer => {
  const program = gl.createProgram()!;

  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);

  const wideIndices = !!gl.getExtension("OES_element_index_uint");
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!uniforms.has(name)) {
      uniforms.set(name, gl.getUniformLocation(program, name));
    }
    return uniforms.get(name)!;
  };
  const attributes = {
    position: gl.getAttribLocation(program, "position"),
    normal: gl.getAttribLocation(program, "normal"),
    uv: gl.getAttribLocation(program, "uv"),
  };
  const boneBuffer = gl.createBuffer()!;
  const boxBuffer = gl.createBuffer()!;
  let boxVertices = 0;

  let scene: ModelScene | undefined;
  let drawables: Drawable[] = [];
  let textures: WebGLTexture[] = [];
  let pose: Pose | undefined;
  let buffers = new Set<WebGLBuffer>();
  let arrayBuffers = new Map<Float32Array, WebGLBuffer>();

  const uploadBuffer = (
    target: number,
    data: ArrayBufferView,
    usage: number = gl.STATIC_DRAW,
  ) => {
    const made = gl.createBuffer()!;

    gl.bindBuffer(target, made);
    // Messages from the extension never carry shared buffers
    gl.bufferData(target, data as BufferSource, usage);
    buffers.add(made);
    return made;
  };

  const release = () => {
    for (const buffer of buffers) {
      gl.deleteBuffer(buffer);
    }
    textures.forEach((texture) => gl.deleteTexture(texture));
    buffers = new Set();
    arrayBuffers = new Map();
    drawables = [];
    textures = [];
  };

  /** Uploads an array the first time a draw uses it: a mesh's passes often share one */
  const uploadOnce = (data: Float32Array) => {
    let made = arrayBuffers.get(data);

    if (!made) {
      made = uploadBuffer(gl.ARRAY_BUFFER, data);
      arrayBuffers.set(data, made);
    }
    return made;
  };

  const setModel = (next: ModelScene | undefined) => {
    release();
    scene = next;
    pose = undefined;
    if (!next) {
      return;
    }

    textures = next.textures.map(({ width, height, pixels }) => {
      const texture = gl.createTexture()!;
      const tiles = isPowerOfTwo(width) && isPowerOfTwo(height);

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      );
      if (tiles) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        tiles ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
      );
      const wrap = tiles ? gl.REPEAT : gl.CLAMP_TO_EDGE;

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return texture;
    });

    const boxLines = Float32Array.from(
      next.boxes.flatMap((box) => Array.from(box.lines)),
    );

    boxVertices = boxLines.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, boxLines, gl.STATIC_DRAW);

    drawables = next.meshes.flatMap((mesh, at): Drawable[] => {
      const vertices = mesh.positions.length / 3;
      const narrow = vertices <= 0x10000;

      if (!narrow && !wideIndices) {
        return [];
      }

      const usage = mesh.local ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;

      return [
        {
          mesh: at,
          hasNormals: !!mesh.normals,
          position: uploadBuffer(gl.ARRAY_BUFFER, mesh.positions, usage),
          normal: mesh.normals && uploadBuffer(gl.ARRAY_BUFFER, mesh.normals, usage),
          parts: getDraws(mesh).map((draw): DrawablePart => {
            const indices = draw.indices ?? mesh.indices;

            return {
              count: indices.length,
              surface: draw.surface,
              indexType: narrow ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
              texture:
                draw.uvs && draw.texture !== undefined
                  ? textures[draw.texture]
                  : undefined,
              uv: draw.uvs && uploadOnce(draw.uvs),
              index: uploadBuffer(
                gl.ELEMENT_ARRAY_BUFFER,
                narrow ? Uint16Array.from(indices) : indices,
              ),
              missingTexture: draw.textured,
            };
          }),
          posed: mesh.local && {
            positions: new Float32Array(mesh.positions.length),
            normals: mesh.normals && new Float32Array(mesh.normals.length),
          },
        },
      ];
    });
  };

  const setPose = (next: Pose | undefined) => {
    pose = next;
    if (!scene) {
      return;
    }
    for (const drawable of drawables) {
      const mesh = scene.meshes[drawable.mesh];

      if (!drawable.posed) {
        continue;
      }
      if (next) {
        skin(mesh, next, drawable.posed.positions, drawable.posed.normals);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, drawable.position);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        next ? drawable.posed.positions : mesh.positions,
      );
      if (drawable.normal && mesh.normals) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawable.normal);
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          (next && drawable.posed.normals) || mesh.normals,
        );
      }
    }
  };

  const bindAttribute = (
    location: number,
    data: WebGLBuffer | undefined,
    size: number,
  ) => {
    if (location < 0) {
      return;
    }
    if (!data) {
      gl.disableVertexAttribArray(location);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, data);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  const blendFactors = BLEND_FACTORS(gl);

  // Blended materials test against the depth buffer but do not write to it,
  // and the page behind the canvas keeps out of them
  const applyBlend = (blend: W3dBlend) => {
    gl.depthMask(blend === "opaque");
    if (blend === "opaque") {
      gl.disable(gl.BLEND);
      return;
    }

    const [source, destination] = blendFactors[blend];

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(source, destination, gl.ZERO, gl.ONE);
  };

  const applySurface = ({ depthCompare, twoSided }: W3dSurface) => {
    gl.depthFunc(gl.NEVER + depthCompare);
    if (twoSided) {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
    }
  };

  const draw = (
    viewProjection: Float32Array | number[],
    {
      offset = [0, 0, 0],
      light,
      showBones,
      showMeshes = true,
      lod,
      showHidden,
      subObjectRules,
      partOverrides,
      showBoxes,
    }: DrawOptions,
  ) => {
    if (!scene) {
      return;
    }
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniform("viewProjection"), false, viewProjection);
    gl.uniform3fv(uniform("offset"), offset);
    gl.uniform3fv(uniform("lightDirection"), light);
    gl.uniform1i(uniform("useSolid"), 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    const { meshes } = scene;
    const visible = getMeshVisibility(scene, {
      lod,
      showHidden,
      subObjectRules,
      partOverrides,
    });
    const opacityOf = (each: Drawable) =>
      pose ? getMeshOpacity(meshes[each.mesh], pose) : 1;
    // WW3D's mesh alpha override, mint's `faded`: below 1 an opaque mesh draws
    // blended, and a mesh that ignores its own alpha fades by its colour
    const blendOf = (drawable: Drawable, { surface }: DrawablePart) =>
      surface.blend === "opaque" && opacityOf(drawable) < 1 ? "alpha" : surface.blend;
    const shown = showMeshes
      ? drawables
          .filter(
            (each) =>
              visible[each.mesh] && (!pose || isMeshShown(meshes[each.mesh], pose)),
          )
          .flatMap((drawable) => drawable.parts.map((part) => ({ drawable, part })))
      : [];
    // Opaque first, so what blends over it finds it in the depth buffer
    const ordered = [
      ...shown.filter((each) => blendOf(each.drawable, each.part) === "opaque"),
      ...shown
        .filter((each) => blendOf(each.drawable, each.part) !== "opaque")
        .sort((a, b) => a.part.surface.sortLevel - b.part.surface.sortLevel),
    ];

    for (const { drawable, part } of ordered) {
      const blend = blendOf(drawable, part);

      applyBlend(blend);
      applySurface(part.surface);
      gl.uniform1f(uniform("opacity"), opacityOf(drawable));
      gl.uniform1i(uniform("fadesColour"), blend === "alpha" ? 0 : 1);
      gl.uniform1f(
        uniform("alphaCutoff"),
        part.surface.alphaTest ? ALPHA_CUTOFF : -1,
      );
      gl.uniform1i(uniform("hasTexture"), part.texture ? 1 : 0);
      gl.uniform4fv(
        uniform("untextured"),
        part.missingTexture ? MISSING_TEXTURE : NO_TEXTURE,
      );
      gl.uniform1i(uniform("hasNormals"), drawable.hasNormals ? 1 : 0);
      if (part.texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, part.texture);
        gl.uniform1i(uniform("tex"), 0);
      }
      bindAttribute(attributes.position, drawable.position, 3);
      bindAttribute(attributes.normal, drawable.normal, 3);
      bindAttribute(attributes.uv, part.uv, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.index);
      gl.drawElements(gl.TRIANGLES, part.count, part.indexType, 0);
    }

    applyBlend("opaque");
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);

    if (showBoxes && boxVertices) {
      gl.uniform1i(uniform("useSolid"), 1);
      gl.uniform4fv(uniform("solid"), BOX_COLOUR);
      bindAttribute(attributes.normal, undefined, 3);
      bindAttribute(attributes.uv, undefined, 2);
      bindAttribute(attributes.position, boxBuffer, 3);
      gl.drawArrays(gl.LINES, 0, boxVertices);
    }

    const skeleton = scene.skeleton;
    const lines =
      showBones && skeleton
        ? buildBoneLines(skeleton, pose ?? poseAtBind(skeleton))
        : [];

    if (lines.length) {
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1i(uniform("useSolid"), 1);
      gl.uniform4fv(uniform("solid"), BONE_COLOUR);
      gl.bindBuffer(gl.ARRAY_BUFFER, boneBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
      bindAttribute(attributes.normal, undefined, 3);
      bindAttribute(attributes.uv, undefined, 2);
      bindAttribute(attributes.position, boneBuffer, 3);
      gl.drawArrays(gl.LINES, 0, lines.length / 3);
      gl.drawArrays(gl.POINTS, 0, lines.length / 3);
      gl.enable(gl.DEPTH_TEST);
    }
    // The other programs on this context set their own attributes
    for (const location of Object.values(attributes)) {
      if (location >= 0) {
        gl.disableVertexAttribArray(location);
      }
    }
  };

  return { setModel, setPose, draw };
};
