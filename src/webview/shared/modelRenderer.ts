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
import type { ModelScene, SceneMesh } from "../../formats/w3d/w3dScene";
import type { SceneDraw } from "../../formats/w3d/w3dSceneDraws";
import { DEFAULT_SURFACE } from "../../formats/w3d/w3dMaterialTypes";
import type { W3dBlend, W3dSurface } from "../../formats/w3d/w3dMaterialTypes";
import { parseUvMapper, sampleBumpMatrix, UV_MAPPER } from "../../formats/w3d/w3dUvMapper";
import { DEFAULT_HOUSE_COLOUR } from "../../formats/w3d/w3dHouseColour";
import { applyBlend } from "./applyBlend";
import { applyMapper, DETAIL_UV_UNIFORMS, UV_UNIFORMS } from "./applyMapper";
import { applySurface } from "./applySurface";
import { bindAttribute } from "./bindAttribute";
import { bindColors } from "./bindColors";
import { drawModelLines } from "./drawModelLines";
import type { BoneLines } from "./drawModelLines";
import type { ModelAttributes } from "./modelLocations";
import { buildFragmentShader, VERTEX_SHADER } from "./modelShaders";
import { orderDraws } from "./orderDraws";
import { uploadTextures } from "./uploadTextures";

/**
 * Draws a W3D model with WebGL: every material draw of every mesh textured
 * and lit from the camera, grey where its texture is missing, skinned on the
 * CPU to the pose it is given, its bones and collision boxes as lines when asked, one
 * level of detail at a time and without the meshes marked hidden. One
 * renderer serves the W3D viewer and the particle preview, so a model looks
 * the same in both. WebGL 1, which the particle preview draws with.
 */

/** What a draw shows in place of a texture that was not found */
const MISSING_TEXTURE = [0.7, 0.7, 0.7, 1];
/** What a draw that names no texture shows: its lit colour alone */
const NO_TEXTURE = [1, 1, 1, 1];

/** Settings for one `ModelRenderer.draw` call: where the model stands, the light, and what to show */
export interface DrawOptions {
  /** Where the model stands */
  offset?: Vec3;
  /** Unit vector towards the light, usually towards the camera */
  light: Vec3;
  /** Draws by white ambient light alone, as the game lights a `View3D` surface */
  unlit?: boolean;
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
  /** The preview's clock: where animated materials stand. Stopping it pauses them */
  seconds?: number;
  /** The camera, for environment-mapped materials; they see a fixed one when absent */
  camera?: ModelCamera;
  /** The colour house-coloured parts take, 0 to 1 a channel */
  houseColour?: Vec3;
}

/** Where the camera stands, for materials whose coordinates depend on it */
export interface ModelCamera {
  eye: Vec3;
  /** World to camera rotation, three columns of three */
  rotation: number[];
}

/** The camera of a draw that gives none: far along the light, axes as the world's */
const DEFAULT_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const FAR_EYE = 1e5;

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
  /** The draw names a texture, found or not; without one found it shows grey */
  namesTexture: boolean;
  detailTexture?: WebGLTexture;
  houseMask?: WebGLTexture;
  normalMap?: WebGLTexture;
  uv?: WebGLBuffer;
  detailUv?: WebGLBuffer;
  color?: WebGLBuffer;
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

const NO_MAPPER = parseUvMapper(UV_MAPPER.UV);

/** The material's own opacity reaches only an alpha blend taking its alpha from the material: mint's `material_alpha` */
const getMaterialAlpha = ({ blend, opacity, vertexColour }: W3dSurface) =>
  blend === "alpha" && !vertexColour?.diffuse ? opacity : 1;

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

/** Creates a model renderer on a WebGL 1 context that other programs may share */
export const createModelRenderer = (
  gl: WebGLRenderingContext,
): ModelRenderer => {
  const program = gl.createProgram()!;

  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(
    program,
    compile(
      gl,
      gl.FRAGMENT_SHADER,
      buildFragmentShader(!!gl.getExtension("OES_standard_derivatives")),
    ),
  );
  gl.linkProgram(program);

  const wideIndices = !!gl.getExtension("OES_element_index_uint");
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!uniforms.has(name)) {
      uniforms.set(name, gl.getUniformLocation(program, name));
    }
    return uniforms.get(name)!;
  };
  const attributes: ModelAttributes = {
    position: gl.getAttribLocation(program, "position"),
    normal: gl.getAttribLocation(program, "normal"),
    uv: gl.getAttribLocation(program, "uv"),
    detailUv: gl.getAttribLocation(program, "detailUv"),
    color: gl.getAttribLocation(program, "color"),
  };
  const boneBuffer = gl.createBuffer()!;
  const boxBuffer = gl.createBuffer()!;
  let boxVertices = 0;

  let scene: ModelScene | undefined;
  let drawables: Drawable[] = [];
  let textures: WebGLTexture[] = [];
  let pose: Pose | undefined;
  let buffers = new Set<WebGLBuffer>();
  let arrayBuffers = new Map<ArrayBufferLike, Map<string, WebGLBuffer>>();

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

  // A message hands every reference to an array over as a view of its own, so
  // the same bytes are found by where they lie rather than by which view
  // names them
  /** Uploads an array the first time a draw uses it: a mesh's passes often share one */
  const uploadOnce = (data: Float32Array | Uint8Array) => {
    const key = `${data.byteOffset}:${data.byteLength}`;
    const known = arrayBuffers.get(data.buffer) ?? new Map<string, WebGLBuffer>();
    let made = known.get(key);

    if (!made) {
      made = uploadBuffer(gl.ARRAY_BUFFER, data);
      known.set(key, made);
      arrayBuffers.set(data.buffer, known);
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

    textures = uploadTextures(gl, next);

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
      const uploadIndices = (indices: Uint32Array) =>
        uploadBuffer(
          gl.ELEMENT_ARRAY_BUFFER,
          narrow ? Uint16Array.from(indices) : indices,
        );
      let wholeMeshIndex: WebGLBuffer | undefined;
      const getIndexBuffer = (indices?: Uint32Array) => {
        if (indices) {
          return uploadIndices(indices);
        }
        wholeMeshIndex ??= uploadIndices(mesh.indices);
        return wholeMeshIndex;
      };

      return [
        {
          mesh: at,
          hasNormals: !!mesh.normals,
          position: uploadBuffer(gl.ARRAY_BUFFER, mesh.positions, usage),
          normal: mesh.normals && uploadBuffer(gl.ARRAY_BUFFER, mesh.normals, usage),
          parts: getDraws(mesh).map((draw): DrawablePart => ({
            count: (draw.indices ?? mesh.indices).length,
            surface: draw.surface,
            indexType: narrow ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
            texture:
              draw.uvs && draw.texture !== undefined
                ? textures[draw.texture]
                : undefined,
            detailTexture:
              draw.detailUvs && draw.detailTexture !== undefined
                ? textures[draw.detailTexture]
                : undefined,
            houseMask:
              draw.uvs && draw.houseMask !== undefined ? textures[draw.houseMask] : undefined,
            normalMap:
              draw.uvs && draw.normalMap !== undefined ? textures[draw.normalMap] : undefined,
            uv: draw.uvs && uploadOnce(draw.uvs),
            detailUv: draw.detailUvs && uploadOnce(draw.detailUvs),
            color: draw.colors && uploadOnce(draw.colors),
            index: getIndexBuffer(draw.indices),
            namesTexture: draw.textured,
          })),
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

  const bindTexture = (texture: WebGLTexture | undefined, name: string, unit: number) => {
    if (texture) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniform(name), unit);
    }
  };

  const draw = (
    viewProjection: Float32Array | number[],
    {
      offset = [0, 0, 0],
      light,
      unlit,
      showBones,
      showMeshes = true,
      lod,
      showHidden,
      subObjectRules,
      partOverrides,
      showBoxes,
      seconds = 0,
      camera,
      houseColour = DEFAULT_HOUSE_COLOUR,
    }: DrawOptions,
  ) => {
    if (!scene) {
      return;
    }
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniform("viewProjection"), false, viewProjection);
    gl.uniform3fv(uniform("offset"), offset);
    gl.uniform3fv(uniform("lightDirection"), light);
    gl.uniform3fv(uniform("houseColour"), houseColour);
    gl.uniform3fv(uniform("eye"), camera?.eye ?? light.map((axis) => axis * FAR_EYE));
    gl.uniformMatrix3fv(
      uniform("viewRotation"),
      false,
      camera?.rotation ?? DEFAULT_ROTATION,
    );
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
    const blendOf = (drawable: Drawable, { surface }: DrawablePart): W3dBlend =>
      surface.blend === "opaque" && opacityOf(drawable) < 1 ? "alpha" : surface.blend;
    const shown = showMeshes
      ? drawables
          .filter(
            (each) =>
              visible[each.mesh] && (!pose || isMeshShown(meshes[each.mesh], pose)),
          )
          .flatMap((drawable) =>
            drawable.parts.map((part) => ({
              drawable,
              part,
              blend: blendOf(drawable, part),
              sortLevel: part.surface.sortLevel,
            })),
          )
      : [];

    for (const { drawable, part, blend } of orderDraws(shown)) {
      applyBlend(
        gl,
        blend,
        blend === "opaque" || (part.surface.blend !== "opaque" && part.surface.depthWrite),
      );
      applySurface(gl, uniform, part.surface);
      applyMapper(gl, uniform, UV_UNIFORMS, part.surface.mappers?.[0], seconds, drawable.hasNormals);
      applyMapper(
        gl,
        uniform,
        DETAIL_UV_UNIFORMS,
        part.surface.mappers?.[1],
        seconds,
        drawable.hasNormals,
      );
      gl.uniform4fv(
        uniform("bumpMatrix"),
        sampleBumpMatrix(part.surface.mappers?.[0] ?? NO_MAPPER, seconds),
      );
      gl.uniform1f(uniform("opacity"), opacityOf(drawable));
      gl.uniform1i(uniform("fadesColour"), blend === "alpha" ? 0 : 1);
      gl.uniform1i(uniform("writesOpaque"), blend === "opaque" ? 1 : 0);
      gl.uniform1f(uniform("materialAlpha"), getMaterialAlpha(part.surface));
      gl.uniform1f(
        uniform("alphaCutoff"),
        part.surface.alphaTest ? ALPHA_CUTOFF : -1,
      );
      gl.uniform1i(uniform("hasTexture"), part.texture ? 1 : 0);
      gl.uniform4fv(
        uniform("untextured"),
        part.namesTexture ? MISSING_TEXTURE : NO_TEXTURE,
      );
      gl.uniform1i(uniform("hasNormals"), drawable.hasNormals && !unlit ? 1 : 0);
      bindTexture(part.texture, "tex", 0);
      bindAttribute(gl, attributes.position, drawable.position, 3);
      bindAttribute(gl, attributes.normal, drawable.normal, 3);
      // The mask replaces the mesh's own second stage
      const detail = part.houseMask ? undefined : part.detailTexture;

      gl.uniform1i(uniform("hasDetail"), detail ? 1 : 0);
      bindTexture(detail, "detailTex", 1);
      gl.uniform1i(uniform("hasHouseMask"), part.houseMask ? 1 : 0);
      bindTexture(part.houseMask, "houseMaskTex", 2);
      gl.uniform1i(uniform("hasNormalMap"), part.normalMap && drawable.hasNormals ? 1 : 0);
      bindTexture(part.normalMap, "normalTex", 3);
      bindAttribute(gl, attributes.uv, part.uv, 2);
      bindAttribute(gl, attributes.detailUv, part.detailUv ?? part.uv, 2);
      bindColors(gl, attributes.color, part.color);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.index);
      gl.drawElements(gl.TRIANGLES, part.count, part.indexType, 0);
    }

    applyBlend(gl, "opaque", true);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);

    const skeleton = scene.skeleton;
    const boneVertices =
      showBones && skeleton
        ? buildBoneLines(skeleton, pose ?? poseAtBind(skeleton))
        : [];
    const bones: BoneLines = { buffer: boneBuffer, vertices: boneVertices };

    drawModelLines(
      gl,
      { uniform, attributes },
      showBoxes ? { buffer: boxBuffer, vertexCount: boxVertices } : undefined,
      bones,
    );
    // The other programs on this context set their own attributes
    for (const location of Object.values(attributes)) {
      if (location >= 0) {
        gl.disableVertexAttribArray(location);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  };

  return { setModel, setPose, draw };
};
